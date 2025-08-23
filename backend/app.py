from flask import Flask
from flask_socketio import SocketIO, emit, join_room, leave_room
import random

app = Flask(__name__)
app.config['SECRET_KEY'] = 'your_secret_key'
socketio = SocketIO(app)

# CORS for local development
socketio = SocketIO(app, cors_allowed_origins="*")

# In-memory-DataStructure for active rooms
rooms = {}

@app.route('/')
def index():
    return "Flask-Backend ist running"

@app.route('/health')
def health_check():
    return {"status": "healthy"}, 200


if __name__ == '__main__':
    # Start the SocketIO server
    socketio.run(app, host='0.0.0.0', port=5000)

