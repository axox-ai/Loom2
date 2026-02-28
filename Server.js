const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.get('/', (req, res) => {
  const roomId = Math.floor(100 + Math.random() * 900);
  res.redirect('/' + roomId);
});

app.get('/:room', (req, res) => {
  const roomId = req.params.room;
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>Hayden Meet - Room ${roomId}</title>
  <style>
    body { font-family: Arial; background: #111; color: #ddd; text-align: center; padding: 50px; }
    h1 { color: #0a0; }
    button { padding: 15px 30px; font-size: 18px; background: #0a0; color: white; border: none; border-radius: 8px; cursor: pointer; }
  </style>
</head>
<body>
  <h1>Hayden Meet</h1>
  <h2>Room Code: ${roomId}</h2>
  <button onclick="navigator.clipboard.writeText('${roomId}').then(() => alert('✅ Code copied! Share with friends'))">Copy Room Code</button>
  <p style="margin-top:40px">Server is running perfectly! 🎉</p>
</body>
</html>
  `);
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log('✅ Hayden Meet is LIVE on port ' + PORT);
});
