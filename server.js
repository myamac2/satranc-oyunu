const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Chess } = require('chess.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let game = new Chess();
let players = {};

io.on('connection', (socket) => {
  if (!players.white) {
    players.white = socket.id;
    socket.emit('playerRole', 'w');
  } else if (!players.black) {
    players.black = socket.id;
    socket.emit('playerRole', 'b');
  } else {
    socket.emit('spectatorRole');
  }

  socket.emit('boardState', game.fen());

  socket.on('move', (move) => {
    try {
      if (game.turn() === 'w' && socket.id !== players.white) return;
      if (game.turn() === 'b' && socket.id !== players.black) return;

      const result = game.move(move);
      if (result) {
        io.emit('boardState', game.fen());
      }
    } catch (err) {
      console.log("Geçersiz hamle:", move);
    }
  });

  socket.on('disconnect', () => {
    if (socket.id === players.white) delete players.white;
    if (socket.id === players.black) delete players.black;
  });
});

server.listen(3000, () => {
  console.log('Satranç sunucusu hazır! http://localhost:3000 adresinden girebilirsin.');
});