from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room, leave_room
import secrets
import time


app = Flask(__name__)
app.config["SECRET_KEY"] = "your_secret_key"
CORS(app, resources={r"/*": {"origins": ["http://localhost:8080", "http://tictactoe.hrschmllr"]}}, supports_credentials=True)

# Eventlet/gevent will be used automatically if installed.
socketio = SocketIO(app, cors_allowed_origins="*")

# In-memory game state per room code
# code -> {
#   "board":[...], "next":"X"/"O", "status":"waiting/playing/over",
#   "players": {sid:"X"/"O"}, "moves": int, "rematch_votes": set(),
#   "spectators": set(), "names": {sid: name}
# }
rooms = {}

WIN = [{0,1,2},{3,4,5},{6,7,8},{0,3,6},{1,4,7},{2,5,8},{0,4,8},{2,4,6}]

def fresh_state():
    return {
        "board": [None]*9,
        "next": "X",
        "status": "waiting",
        "players": {},           # sid -> "X"/"O"
        "moves": 0,
        "rematch_votes": set(),  # sids that voted for rematch
        "spectators": set(),     # spectator sids
        "names": {}              # sid -> name
    }

def winner(board):
    filled = {i for i, v in enumerate(board) if v}
    for combo in WIN:
        if combo <= filled:
            a, b, c = tuple(combo)
            if board[a] == board[b] == board[c]:
                return board[a]
    return None

def spectator_count(st):
    return len(st.get("spectators", []))

def players_info(st):
    # st["players"]: sid -> "X"/"O"
    # st["names"]:   sid -> name
    info = {"X": None, "O": None}
    for sid, sym in st.get("players", {}).items():
        info[sym] = st["names"].get(sid) or f"Player {sym}"
    return info

def emit_audience(code, st):
    socketio.emit("audience", {"spectatorCount": spectator_count(st)}, room=code)

def emit_players(code, st):
    socketio.emit("players", {"players": players_info(st)}, room=code)

@app.route("/")
def index():
    return "Flask backend is running"

@app.route("/health")
def health_check():
    return jsonify({"status": "healthy"}), 200

@app.post("/games")
def create_game():
    code = "".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(6))
    rooms.setdefault(code, fresh_state())
    return jsonify({"code": code})

@socketio.on("join")
def on_join_game(data):
    code = (data or {}).get("code")
    name = (data or {}).get("name") or "Guest"
    want_spectator = bool((data or {}).get("spectator"))

    if not code or code not in rooms:
        return emit("error", {"message": "invalid_code"})
    st = rooms[code]

    # Save name (max. 24 chars)
    st["names"][request.sid] = str(name)[:24]

    lobby_full = len(st["players"]) >= 2
    if lobby_full or want_spectator:
        st["spectators"].add(request.sid)
        join_room(code)

        payload = {
            "board": st["board"],
            "next": st["next"],
            "status": st["status"],
            "spectatorCount": spectator_count(st),
            "players": players_info(st),
        }

        win = winner(st["board"])
        if st["status"] == "over":
            payload["winner"] = win
            payload["draw"] = (st["moves"] == 9 and not win)

        emit("spectator", payload)
        emit_players(code, st)
        emit_audience(code, st)
        return

    # Player join
    symbol = "X" if "X" not in st["players"].values() else "O"
    st["players"][request.sid] = symbol
    join_room(code)

    emit("assign", {"symbol": symbol})
    emit_players(code, st)

    if len(st["players"]) == 2:
        st["status"] = "playing"
        st["rematch_votes"] = set()
        socketio.emit(
            "start",
            {
                "next": st["next"],
                "board": st["board"],
                "spectatorCount": spectator_count(st),
                "players": players_info(st),
            },
            room=code
        )
    else:
        emit(
            "waiting",
            {
                "message": "waiting_for_opponent",
                "spectatorCount": spectator_count(st),
                "players": players_info(st),
            }
        )

@socketio.on("move")
def on_move(data):
    code = (data or {}).get("code")
    cell = (data or {}).get("cell")
    if code not in rooms:
        return emit("error", {"message": "invalid_code"})
    st = rooms[code]

    if st["status"] != "playing":
        return emit("error", {"message": "not_playing"})

    symbol = st["players"].get(request.sid)
    if symbol != st["next"]:
        return emit("error", {"message": "not_your_turn"})

    try:
        cell = int(cell)
    except Exception:
        return emit("error", {"message": "bad_cell"})

    if cell < 0 or cell > 8 or st["board"][cell] is not None:
        return emit("error", {"message": "illegal_move"})

    # A move invalidates old rematch votes
    st["rematch_votes"] = set()

    # Apply move
    st["board"][cell] = symbol
    st["moves"] += 1

    win = winner(st["board"])
    draw = (st["moves"] == 9 and not win)

    if win or draw:
        st["status"] = "over"
        payload = {
            "type": "state",
            "board": st["board"],
            "next": st["next"],
            "status": st["status"],
            "last_move": {"cell": cell, "symbol": symbol},
            "winner": win,
            "draw": draw,
            "spectatorCount": spectator_count(st),
            "players": players_info(st),
        }
        socketio.emit("state", payload, room=code)
        socketio.emit(
            "game_over",
            {"winner": win, "draw": draw, "spectatorCount": spectator_count(st)},
            room=code
        )
    else:
        st["next"] = "O" if st["next"] == "X" else "X"
        payload = {
            "type": "state",
            "board": st["board"],
            "next": st["next"],
            "status": st["status"],
            "last_move": {"cell": cell, "symbol": symbol},
            "spectatorCount": spectator_count(st),
            "players": players_info(st),
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
    st["rematch_votes"] = set()
    socketio.emit(
        "game_over",
        {"winner": winner_symbol, "draw": False, "spectatorCount": spectator_count(st)},
        room=code
    )
    emit_players(code, st)

@socketio.on("decline_rematch")
def on_decline_rematch(data):
    code = (data or {}).get("code")
    if not code or code not in rooms:
        return
    st = rooms[code]
    # Find the other player (the one who requested rematch)
    others = [sid for sid in st["players"] if sid != request.sid]
    for sid in others:
        socketio.emit("rematch_declined", {}, room=sid)

@socketio.on("new_match")
def on_new_match(data):
    code = (data or {}).get("code")
    if not code or code not in rooms:
        return
    st = rooms[code]
    # Remove player from room
    if request.sid in st["players"]:
        leave_room(code)
        st["players"].pop(request.sid, None)
        st["rematch_votes"] = set()
        # Notify remaining player
        for sid in st["players"]:
            socketio.emit("opponent_left", {}, room=sid)
        # Delete room if empty
        if not st["players"]:
            rooms.pop(code, None)

@socketio.on("rematch")
def on_rematch(data):
    code = (data or {}).get("code")
    if code not in rooms:
        return emit("error", {"message": "invalid_code"})
    st = rooms[code]

    # Optional strict mode:
    # if st["status"] != "over":
    #     return emit("error", {"message":"rematch_only_after_game_over"})

    # Save vote
    st.setdefault("rematch_votes", set())
    st["rematch_votes"].add(request.sid)

    # Inform the other player directly
    others = [sid for sid in st["players"].keys() if sid != request.sid]
    for sid in others:
        socketio.emit(
            "rematch_request",
            {"from": st["players"].get(request.sid)},
            room=sid
        )

    # Both agreed -> restart
    if len(st["players"]) >= 2 and st["rematch_votes"] >= set(st["players"].keys()):
        players_copy = dict(st["players"])
        names_copy = dict(st["names"])  # keep names
        rooms[code] = fresh_state()
        st = rooms[code]
        st["players"] = players_copy
        # only keep names of connected sids
        for sid in players_copy.keys():
            if sid in names_copy:
                st["names"][sid] = names_copy[sid]
        st["status"] = "playing"
        st["next"] = "X"
        socketio.emit(
            "start",
            {
                "next": st["next"],
                "board": st["board"],
                "spectatorCount": spectator_count(st),
                "players": players_info(st),
            },
            room=code
        )
        emit_players(code, st)
    else:
        emit("rematch_pending", {"waiting_for": len(st["players"]) - len(st["rematch_votes"])})

# --- Global Cheer: broadcast to everyone, 10s rate-limit per sid ---
last_cheer_by_sid = {}
CHEER_COOLDOWN = 10  # seconds

@socketio.on("cheer")
def on_cheer(data):
    code = (data or {}).get("code")
    target = (data or {}).get("target")  # "X" or "O"
    if not code or code not in rooms:
        return
    st = rooms[code]

    now = time.time()
    last = last_cheer_by_sid.get(request.sid, 0)
    if now - last < CHEER_COOLDOWN:
        emit("error", {"message": "cheer_rate_limited"})
        return
    last_cheer_by_sid[request.sid] = now

    socketio.emit("cheer", {"target": target}, room=code)

@socketio.on("disconnect")
def on_disconnect():
    to_delete = []
    for code, st in list(rooms.items()):
        changed = False
        if request.sid in st["players"]:
            leave_room(code)
            st["players"].pop(request.sid, None)
            st["rematch_votes"] = set()
            socketio.emit("opponent_left", {}, room=code)
            changed = True
        elif request.sid in st["spectators"]:
            leave_room(code)
            st["spectators"].discard(request.sid)
            changed = True

        st["names"].pop(request.sid, None)

        if changed:
            emit_players(code, st)
            emit_audience(code, st)

        if not st["players"] and not st["spectators"]:
            to_delete.append(code)

    for code in to_delete:
        rooms.pop(code, None)

if __name__ == "__main__":
    # With eventlet/gevent, the appropriate server will be used automatically if installed.
    socketio.run(app, host="0.0.0.0", port=5000)
