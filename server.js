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
let whiteTime = 600; // 10 dakika (saniye cinsinden)
let blackTime = 600;
let timerInterval = null;

function startTimer() {
  if (timerInterval) clearInterval(timerInterval);
  
  timerInterval = setInterval(() => {
    if (game.game_over()) {
      clearInterval(timerInterval);
      return;
    }

    if (game.turn() === 'w') {
      whiteTime--;
      if (whiteTime <= 0) {
        clearInterval(timerInterval);
        io.emit('gameOver', 'Süre Bitti! Siyah Kazandı.');
      }
    } else {
      blackTime--;
      if (blackTime <= 0) {
        clearInterval(timerInterval);
        io.emit('gameOver', 'Süre Bitti! Beyaz Kazandı.');
      }
    }

    io.emit('timerUpdate', { whiteTime, blackTime, turn: game.turn() });
  }, 1000);
}

io.on('connection', (socket) => {
  if (!players.white) {
    players.white = socket.id;
    socket.emit('playerRole', 'w');
  } else if (!players.black) {
    players.black = socket.id;
    socket.emit('playerRole', 'b');
    startTimer(); // İkinci oyuncu girince 10dk sayacı başlat
  } else {
    socket.emit('spectatorRole');
  }

  socket.emit('boardState', { fen: game.fen(), whiteTime, blackTime });

  socket.on('move', (moveData) => {
    const turn = game.turn();
    if ((turn === 'w' && socket.id !== players.white) || 
        (turn === 'b' && socket.id !== players.black)) {
      return;
    }

    try {
      const result = game.move(moveData);
      if (result) {
        io.emit('boardState', { fen: game.fen(), whiteTime, blackTime });
      }
    } catch (err) {
      socket.emit('boardState', { fen: game.fen(), whiteTime, blackTime });
    }
  });

  socket.on('disconnect', () => {
    if (socket.id === players.white) delete players.white;
    if (socket.id === players.black) delete players.black;
    if (!players.white && !players.black) {
      game = new Chess();
      whiteTime = 600;
      blackTime = 600;
      clearInterval(timerInterval);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});