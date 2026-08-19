const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const chessModule = require('chess.js');

const Chess = chessModule.Chess || chessModule;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// Oyun Odası Verisi
let game = new Chess();
let players = { white: null, black: null };
let whiteTime = 600;
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
        io.to('gameRoom').emit('gameOver', 'Süre Bitti! Siyah Kazandı.');
      }
    } else {
      blackTime--;
      if (blackTime <= 0) {
        clearInterval(timerInterval);
        io.to('gameRoom').emit('gameOver', 'Süre Bitti! Beyaz Kazandı.');
      }
    }

    io.to('gameRoom').emit('timerUpdate', { whiteTime, blackTime, turn: game.turn() });
  }, 1000);
}

io.on('connection', (socket) => {
  // Her bağlanan oyuncuyu aynı odaya al
  socket.join('gameRoom');

  // Oyuncu rollerini atama
  if (!players.white) {
    players.white = socket.id;
    socket.emit('playerRole', 'w');
  } else if (!players.black) {
    players.black = socket.id;
    socket.emit('playerRole', 'b');
    startTimer(); // İkinci oyuncu girince sayacı başlat
  } else {
    socket.emit('spectatorRole');
  }

  // Anlık tahta durumunu o an bağlanan kişiye gönder
  socket.emit('boardState', { fen: game.fen(), whiteTime, blackTime });

  // Hamle alma
  socket.on('move', (moveData) => {
    const turn = game.turn();

    // Sıra kontrolü
    if ((turn === 'w' && socket.id !== players.white) || 
        (turn === 'b' && socket.id !== players.black)) {
      socket.emit('boardState', { fen: game.fen(), whiteTime, blackTime });
      return;
    }

    try {
      const result = game.move(moveData);
      if (result) {
        // Hamle geçerliyse odadaki HERKESE bildir
        io.to('gameRoom').emit('boardState', { fen: game.fen(), whiteTime, blackTime });
      } else {
        socket.emit('boardState', { fen: game.fen(), whiteTime, blackTime });
      }
    } catch (err) {
      socket.emit('boardState', { fen: game.fen(), whiteTime, blackTime });
    }
  });

  socket.on('disconnect', () => {
    if (socket.id === players.white) players.white = null;
    if (socket.id === players.black) players.black = null;

    if (!players.white && !players.black) {
      game = new Chess();
      whiteTime = 600;
      blackTime = 600;
      if (timerInterval) clearInterval(timerInterval);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});