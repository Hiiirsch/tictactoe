from flask import Flask, jsonify, request
from flask_socketio import SocketIO, emit, join_room, leave_room
import secrets

app = Flask(__name__)
app.config["SECRET_KEY"] = "your_secret_key"

# Eventlet/gevent will be used automatically if installed.
socketio = SocketIO(app, cors_allowed_origins="*")

# In-memory game state per code
# code -> {
#   "board":[...], "next":"X"/"O", "status":"waiting/playing/over",
#   "players": {sid:"X"/"O"}, "moves": int, "rematch_votes": set()
# }
rooms = {}

WIN = [{0,1,2},{3,4,5},{6,7,8},{0,3,6},{1,4,7},{2,5,8},{0,4,8},{2,4,6}]

def fresh_state():
    return {
        "board": [None]*9,
        "next": "X",
        "status": "waiting",
        "players": {},         # sid -> "X"/"O"
        "moves": 0,
        "rematch_votes": set() # sids that want a rematch
    }

def winner(board):
    filled = {i for i,v in enumerate(board) if v}
    for combo in WIN:
        if combo <= filled:
            a,b,c = tuple(combo)
            if board[a] == board[b] == board[c]:
                return board[a]
    return None

@app.route("/")
def index():
    return "Flask-Backend is running"

@app.route("/health")
def health_check():
    return jsonify({"status":"healthy"}), 200

@app.post("/games")
def create_game():
    code = "".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(6))
    rooms.setdefault(code, fresh_state())
    return jsonify({"code": code})

@socketio.on("join")
def on_join_game(data):
    code = (data or {}).get("code")
    if not code or code not in rooms:
        return emit("error", {"message":"invalid_code"})
    st = rooms[code]

    # Assign X and O in fixed order
    if len(st["players"]) >= 2:
        return emit("error", {"message":"room_full"})

    symbol = "X" if "X" not in st["players"].values() else "O"
    st["players"][request.sid] = symbol
    join_room(code)

    emit("assign", {"symbol": symbol})
    # If both players are present -> start the game
    if len(st["players"]) == 2:
        st["status"] = "playing"
        st["rematch_votes"] = set()  # reset possible old rematch votes
        socketio.emit("start", {"next": st["next"], "board": st["board"]}, room=code)
    else:
        emit("waiting", {"message":"waiting_for_opponent"})

@socketio.on("move")
def on_move(data):
    code = (data or {}).get("code")
    cell = (data or {}).get("cell")
    if code not in rooms:
        return emit("error", {"message":"invalid_code"})
    st = rooms[code]

    if st["status"] != "playing":
        return emit("error", {"message":"not_playing"})

    symbol = st["players"].get(request.sid)
    if symbol != st["next"]:
        return emit("error", {"message":"not_your_turn"})

    try:
        cell = int(cell)
    except Exception:
        return emit("error", {"message":"bad_cell"})

    if cell < 0 or cell > 8 or st["board"][cell] is not None:
        return emit("error", {"message":"illegal_move"})

    # Once a move is made, old rematch votes are no longer valid
    st["rematch_votes"] = set()

    # Apply move (server-authoritative state)
    st["board"][cell] = symbol
    st["moves"] += 1

    win = winner(st["board"])
    draw = (st["moves"] == 9 and not win)

    if win or draw:
        st["status"] = "over"
        payload = {
            "type":"state","board":st["board"],"next":st["next"],
            "status":st["status"],"last_move":{"cell":cell,"symbol":symbol},
            "winner": win, "draw": draw
        }
        socketio.emit("state", payload, room=code)
        socketio.emit("game_over", {"winner": win, "draw": draw}, room=code)
    else:
        st["next"] = "O" if st["next"] == "X" else "X"
        payload = {
            "type":"state","board":st["board"],"next":st["next"],
            "status":st["status"],"last_move":{"cell":cell,"symbol":symbol}
        }
        socketio.emit("state", payload, room=code)

@socketio.on("resign")
def on_resign(data):
    code = (data or {}).get("code")
    if code not in rooms:
        return
    st = rooms[code]
    symbol = st["players"].get(request.sid)
    if not symbol or st["status"] != "playing":
        return
    winner_symbol = "O" if symbol == "X" else "X"
    st["status"] = "over"
    st["rematch_votes"] = set()  # clear rematch votes after resignation
    socketio.emit("game_over", {"winner": winner_symbol, "draw": False}, room=code)

@socketio.on("rematch")
def on_rematch(data):
    code = (data or {}).get("code")
    if code not in rooms:
        return emit("error", {"message":"invalid_code"})
    st = rooms[code]

    # Optional strict mode: allow only after game over
    # if st["status"] != "over":
    #     return emit("error", {"message":"rematch_only_after_game_over"})

    # Save the requesting player's vote
    st.setdefault("rematch_votes", set())
    st["rematch_votes"].add(request.sid)

    # Notify opponent (single target via room=<sid>)
    others = [sid for sid in st["players"].keys() if sid != request.sid]
    for sid in others:
        socketio.emit(
            "rematch_request",
            {"from": st["players"].get(request.sid)},
            room=sid
        )

    # If both players agreed -> restart
    if len(st["players"]) >= 2 and st["rematch_votes"] >= set(st["players"].keys()):
        # Remember players, completely reset state
        players_copy = dict(st["players"])
        rooms[code] = fresh_state()
        st = rooms[code]
        st["players"] = players_copy
        st["status"] = "playing"
        st["next"] = "X"
        socketio.emit("start", {"next": st["next"], "board": st["board"]}, room=code)
    else:
        # Confirm to requester that their vote was received
        emit("rematch_pending", {"waiting_for": len(st["players"]) - len(st["rematch_votes"])})

@socketio.on("disconnect")
def on_disconnect():
    # Find potential room and clean up
    to_delete = []
    for code, st in rooms.items():
        if request.sid in st["players"]:
            leave_room(code)
            st["players"].pop(request.sid, None)
            st["rematch_votes"] = set()  # clear votes on disconnect
            socketio.emit("opponent_left", {}, room=code)
            # Delete the room if it's completely empty
            if not st["players"]:
                to_delete.append(code)
    for code in to_delete:
        rooms.pop(code, None)

if __name__ == "__main__":
    # With eventlet/gevent, the appropriate server will be used automatically if installed.
    socketio.run(app, host="0.0.0.0", port=5000)
