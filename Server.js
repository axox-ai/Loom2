const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

// In-memory storage for rooms
const rooms = new Map(); // roomId → { messages: [{text, timestamp}], users: Set<socket.id> }

app.get('/', (req, res) => {
  const roomId = Math.floor(100 + Math.random() * 900); // 100–999
  res.redirect(`/${roomId}`);
});

app.get('/:room', (req, res) => {
  const roomId = req.params.room.padStart(3, '0'); // Ensure 3 digits
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Hayden Meet • Room ${roomId}</title>
  <style>
    body {
      margin: 0;
      font-family: Arial, sans-serif;
      background: #0d1117;
      color: #c9d1d9;
    }
    header {
      background: #161b22;
      padding: 12px 20px;
      text-align: center;
      border-bottom: 1px solid #30363d;
    }
    h1 {
      margin: 0;
      font-size: 1.5rem;
      color: #58a6ff;
    }
    #room-info {
      margin: 10px 0;
      font-size: 1.1rem;
    }
    #controls {
      text-align: center;
      padding: 12px;
      background: #161b22;
    }
    button {
      background: #238636;
      color: white;
      border: none;
      padding: 8px 16px;
      margin: 0 6px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.95rem;
    }
    button:hover { background: #2ea043; }
    #video-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 12px;
      padding: 20px;
    }
    video {
      width: 100%;
      background: black;
      border: 2px solid #30363d;
      border-radius: 8px;
    }
    #chat {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: #161b22;
      border-top: 1px solid #30363d;
      padding: 12px 20px;
    }
    #messages {
      height: 180px;
      overflow-y: auto;
      margin-bottom: 10px;
      padding: 8px;
      background: #0d1117;
      border-radius: 6px;
    }
    #messages p {
      margin: 6px 0;
      font-size: 0.9rem;
    }
    #chat-input-area {
      display: flex;
    }
    #message {
      flex: 1;
      padding: 10px;
      border: 1px solid #30363d;
      border-radius: 6px 0 0 6px;
      background: #0d1117;
      color: #c9d1d9;
    }
    #send-btn {
      border-radius: 0 6px 6px 0;
    }
    #status {
      text-align: center;
      padding: 10px;
      color: #f85149;
      font-weight: bold;
    }
  </style>
</head>
<body>
  <header>
    <h1>Hayden Meet</h1>
    <div id="room-info">Room: <strong>${roomId}</strong> • <button onclick="copyRoom()">Copy Code</button></div>
    <div id="user-count">(1 person here)</div>
  </header>

  <div id="video-grid">
    <video id="localVideo" autoplay playsinline muted></video>
  </div>

  <div id="controls">
    <button id="toggleVideo">Mute Video</button>
    <button id="toggleAudio">Mute Mic</button>
  </div>

  <div id="chat">
    <div id="messages"></div>
    <div id="chat-input-area">
      <input id="message" placeholder="Type a message..." autocomplete="off"/>
      <button id="send-btn">Send</button>
    </div>
  </div>

  <div id="status">Waiting for camera & mic...</div>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    const ROOM_ID = "${roomId}";
    const localVideo = document.getElementById('localVideo');
    let localStream;
    const peers = {};
    let videoEnabled = true;
    let audioEnabled = true;

    const config = {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "turn:openrelay.metered.ca:80" },
        { urls: "turn:openrelay.metered.ca:443" },
        { urls: "turn:openrelay.metered.ca:443?transport=tcp" }
      ]
    };

    // Start camera & mic
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(stream => {
        localStream = stream;
        localVideo.srcObject = stream;
        socket.emit('join-room', ROOM_ID);
        document.getElementById('status').textContent = 'Connected! Invite others with the room code.';
      })
      .catch(err => {
        document.getElementById('status').textContent = 'Error: ' + err.message;
      });

    socket.on('user-connected', userId => {
      createPeerConnection(userId, true);
    });

    socket.on('user-disconnected', userId => {
      if (peers[userId]) {
        peers[userId].close();
        delete peers[userId];
        const v = document.getElementById('remote-' + userId);
        if (v) v.remove();
      }
    });

    socket.on('user-count', count => {
      document.getElementById('user-count').textContent = \`(\${count} person\${count === 1 ? '' : 's'} here)\`;
    });

    socket.on('chat-history', msgs => {
      msgs.forEach(m => addChatMessage(m.text, m.time));
    });

    socket.on('chat-message', ({text, time}) => {
      addChatMessage(text, time);
    });

    function createPeerConnection(userId, initiator) {
      const pc = new RTCPeerConnection(config);
      peers[userId] = pc;

      localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

      pc.ontrack = e => {
        let video = document.getElementById('remote-' + userId);
        if (!video) {
          video = document.createElement('video');
          video.id = 'remote-' + userId;
          video.autoplay = true;
          video.playsinline = true;
          document.getElementById('video-grid').appendChild(video);
        }
        video.srcObject = e.streams[0];
      };

      pc.onicecandidate = e => {
        if (e.candidate) {
          socket.emit('ice-candidate', ROOM_ID, userId, e.candidate);
        }
      };

      if (initiator) {
        pc.createOffer()
          .then(offer => pc.setLocalDescription(offer))
          .then(() => socket.emit('offer', ROOM_ID, userId, pc.localDescription));
      }
    }

    socket.on('offer', (fromId, offer) => {
      createPeerConnection(fromId, false);
      const pc = peers[fromId];
      pc.setRemoteDescription(new RTCSessionDescription(offer))
        .then(() => pc.createAnswer())
        .then(answer => pc.setLocalDescription(answer))
        .then(() => socket.emit('answer', ROOM_ID, fromId, pc.localDescription));
    });

    socket.on('answer', (fromId, answer) => {
      peers[fromId].setRemoteDescription(new RTCSessionDescription(answer));
    });

    socket.on('ice-candidate', (fromId, candidate) => {
      peers[fromId].addIceCandidate(new RTCIceCandidate(candidate));
    });

    // Chat
    function addChatMessage(text, time) {
      const p = document.createElement('p');
      p.innerHTML = \`<small>[\${time}]</small> \${text}\`;
      document.getElementById('messages').appendChild(p);
      document.getElementById('messages').scrollTop = document.getElementById('messages').scrollHeight;
    }

    function sendMessage() {
      const input = document.getElementById('message');
      const text = input.value.trim();
      if (text) {
        socket.emit('chat-message', ROOM_ID, text);
        input.value = '';
      }
    }

    document.getElementById('message').addEventListener('keypress', e => {
      if (e.key === 'Enter') sendMessage();
    });

    document.getElementById('send-btn').onclick = sendMessage;

    // Mute controls
    document.getElementById('toggleVideo').onclick = () => {
      videoEnabled = !videoEnabled;
      localStream.getVideoTracks()[0].enabled = videoEnabled;
      document.getElementById('toggleVideo').textContent = videoEnabled ? 'Mute Video' : 'Unmute Video';
    };

    document.getElementById('toggleAudio').onclick = () => {
      audioEnabled = !audioEnabled;
      localStream.getAudioTracks()[0].enabled = audioEnabled;
      document.getElementById('toggleAudio').textContent = audioEnabled ? 'Mute Mic' : 'Unmute Mic';
    };

    function copyRoom() {
      navigator.clipboard.writeText(ROOM_ID).then(() => alert('Room code copied!'));
    }
  </script>
</body>
</html>
  `);
});

// Socket.IO logic
io.on('connection', socket => {
  socket.on('join-room', roomId => {
    socket.join(roomId);

    if (!rooms.has(roomId)) {
      rooms.set(roomId, { messages: [], users: new Set() });
    }

    const room = rooms.get(roomId);
    room.users.add(socket.id);

    // Notify others
    socket.to(roomId).emit('user-connected', socket.id);
    io.to(roomId).emit('user-count', Array.from(room.users));

    // Send chat history to new user
    socket.emit('chat-history', room.messages);

    socket.on('chat-message', (roomId, text) => {
      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const msg = { text, time };
      room.messages.push(msg);
      io.to(roomId).emit('chat-message', msg);
    });

    socket.on('disconnect', () => {
      room.users.delete(socket.id);
      socket.to(roomId).emit('user-disconnected', socket.id);
      io.to(roomId).emit('user-count', Array.from(room.users));
      if (room.users.size === 0) rooms.delete(roomId);
    });
  });

  socket.on('offer', (roomId, targetId, offer) => {
    io.to(targetId).emit('offer', socket.id, offer);
  });

  socket.on('answer', (roomId, targetId, answer) => {
    io.to(targetId).emit('answer', socket.id, answer);
  });

  socket.on('ice-candidate', (roomId, targetId, candidate) => {
    io.to(targetId).emit('ice-candidate', socket.id, candidate);
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(\`Server running on port \${PORT}\`);
});
