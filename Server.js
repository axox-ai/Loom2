const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

// Store rooms (messages stay until app restarts)
const rooms = new Map();

app.get('/', (req, res) => {
  const roomId = Math.floor(100 + Math.random() * 900); // random 3-digit
  res.redirect(`/${roomId}`);
});

app.get('/:room', (req, res) => {
  const roomId = req.params.room;
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hayden Meet - Room ${roomId}</title>
  <style>
    body { margin:0; font-family:Arial; background:#0d1117; color:#c9d1d9; }
    header { background:#161b22; padding:15px; text-align:center; }
    #video-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:15px; padding:20px; }
    video { width:100%; background:#000; border:2px solid #30363d; border-radius:8px; }
    #controls { text-align:center; padding:10px; background:#161b22; }
    button { background:#238636; color:white; border:none; padding:10px 20px; margin:5px; border-radius:6px; cursor:pointer; }
    button:hover { background:#2ea043; }
    #chat { position:fixed; bottom:0; left:0; right:0; background:#161b22; padding:15px; border-top:1px solid #30363d; }
    #messages { height:180px; overflow-y:auto; background:#0d1117; padding:10px; border-radius:6px; margin-bottom:10px; }
    input { flex:1; padding:10px; background:#0d1117; border:1px solid #30363d; border-radius:6px; color:#c9d1d9; }
  </style>
</head>
<body>
  <header>
    <h1>Hayden Meet</h1>
    <div>Room Code: <strong>${roomId}</strong> <button onclick="navigator.clipboard.writeText('${roomId}').then(()=>alert('Code copied! Share it.'))">Copy Code</button></div>
    <div id="users">(1 online)</div>
  </header>
  <div id="video-grid">
    <video id="local" autoplay playsinline muted></video>
  </div>
  <div id="controls">
    <button id="vidBtn">Mute Video</button>
    <button id="audBtn">Mute Mic</button>
  </div>
  <div id="chat">
    <div id="messages"></div>
    <div style="display:flex"><input id="msg" placeholder="Type message..."><button onclick="sendMsg()">Send</button></div>
  </div>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    const ROOM = "${roomId}";
    let localStream, peers = {}, videoOn = true, audioOn = true;
    const config = { iceServers: [{urls:"stun:stun.l.google.com:19302"},{urls:"turn:openrelay.metered.ca:80"},{urls:"turn:openrelay.metered.ca:443"},{urls:"turn:openrelay.metered.ca:443?transport=tcp"}] };
    const localVid = document.getElementById('local');

    navigator.mediaDevices.getUserMedia({video:true,audio:true}).then(s => {
      localStream = s;
      localVid.srcObject = s;
      socket.emit('join-room', ROOM);
    }).catch(e => console.error(e));

    socket.on('user-connected', id => createPeer(id, true));
    socket.on('user-disconnected', id => { if(peers[id]){peers[id].close(); delete peers[id]; document.getElementById('v'+id)?.remove(); }});
    socket.on('user-count', n => document.getElementById('users').textContent = `(${n} online)`);

    function createPeer(id, initiator) {
      const pc = new RTCPeerConnection(config);
      peers[id] = pc;
      localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
      pc.ontrack = e => {
        let v = document.getElementById('v'+id);
        if (!v) {
          v = document.createElement('video');
          v.id = 'v'+id;
          v.autoplay = true;
          document.getElementById('video-grid').appendChild(v);
        }
        v.srcObject = e.streams[0];
      };
      pc.onicecandidate = e => e.candidate && socket.emit('candidate', ROOM, id, e.candidate);
      if (initiator) pc.createOffer().then(o => pc.setLocalDescription(o)).then(() => socket.emit('offer', ROOM, id, pc.localDescription));
    }

    socket.on('offer', (from, offer) => {
      createPeer(from, false);
      const pc = peers[from];
      pc.setRemoteDescription(offer).then(() => pc.createAnswer()).then(a => pc.setLocalDescription(a)).then(() => socket.emit('answer', ROOM, from, pc.localDescription));
    });
    socket.on('answer', (from, ans) => peers[from].setRemoteDescription(ans));
    socket.on('candidate', (from, cand) => peers[from].addIceCandidate(cand));

    function sendMsg() {
      const input = document.getElementById('msg');
      if (input.value.trim()) {
        socket.emit('chat', ROOM, input.value.trim());
        input.value = '';
      }
    }
    document.getElementById('msg').addEventListener('keypress', e => { if(e.key==='Enter') sendMsg(); });

    document.getElementById('vidBtn').onclick = () => { videoOn = !videoOn; localStream.getVideoTracks()[0].enabled = videoOn; document.getElementById('vidBtn').textContent = videoOn ? 'Mute Video' : 'Unmute Video'; };
    document.getElementById('audBtn').onclick = () => { audioOn = !audioOn; localStream.getAudioTracks()[0].enabled = audioOn; document.getElementById('audBtn').textContent = audioOn ? 'Mute Mic' : 'Unmute Mic'; };
  </script>
</body>
</html>
  `);
});

// Socket.io backend
io.on('connection', socket => {
  socket.on('join-room', room => {
    socket.join(room);
    if (!rooms.has(room)) rooms.set(room, {users: new Set()});
    const r = rooms.get(room);
    r.users.add(socket.id);
    io.to(room).emit('user-count', r.users.size);
    socket.to(room).emit('user-connected', socket.id);

    socket.on('chat', (room, msg) => io.to(room).emit('chat', msg));

    socket.on('offer', (room, to, offer) => socket.to(to).emit('offer', socket.id, offer));
    socket.on('answer', (room, to, answer) => socket.to(to).emit('answer', socket.id, answer));
    socket.on('candidate', (room, to, cand) => socket.to(to).emit('candidate', socket.id, cand));

    socket.on('disconnect', () => {
      r.users.delete(socket.id);
      io.to(room).emit('user-count', r.users.size);
      socket.to(room).emit('user-disconnected', socket.id);
      if (r.users.size === 0) rooms.delete(room);
    });
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log('Hayden Meet running on port', PORT));
