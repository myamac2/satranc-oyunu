const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const chessModule = require('chess.js');
const Chess = typeof chessModule === 'function' ? chessModule : (chessModule.Chess || chessModule.default);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// Tüm odaları tutan nesne
const rooms = {};

function createRoomState() {
  return {
    game: new Chess(),
    players: { white: null, black: null },
    whiteTime: 600,
    blackTime: 600,
    timerInterval: null
  };
}

function startTimer(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  if (room.timerInterval) clearInterval(room.timerInterval);

  room.timerInterval = setInterval(() => {
    if (!rooms[roomId]) {
      clearInterval(room.timerInterval);
      return;
    }

    if (room.game.game_over && room.game.game_over()) {
      clearInterval(room.timerInterval);
      return;
    }

    if (room.game.turn() === 'w') {
      room.whiteTime--;
      if (room.whiteTime <= 0) {
        clearInterval(room.timerInterval);
        io.to(roomId).emit('gameOver', 'Süre Bitti! Siyah Kazandı.');
      }
    } else {
      room.blackTime--;
      if (room.blackTime <= 0) {
        clearInterval(room.timerInterval);
        io.to(roomId).emit('gameOver', 'Süre Bitti! Beyaz Kazandı.');
      }
    }

    io.to(roomId).emit('timerUpdate', { whiteTime: room.whiteTime, blackTime: room.blackTime, turn: room.game.turn() });
  }, 1000);
}

io.on('connection', (socket) => {
  let currentRoomId = null;

  // Oyuncu bir odaya katıldığında
  socket.on('joinRoom', (roomId) => {
    currentRoomId = roomId;
    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = createRoomState();
    }

    const room = rooms[roomId];

    if (!room.players.white) {
      room.players.white = socket.id;
      socket.emit('playerRole', 'w');
    } else if (!room.players.black) {
      room.players.black = socket.id;
      socket.emit('playerRole', 'b');
      startTimer(roomId);
    } else {
      socket.emit('spectatorRole');
    }

    socket.emit('boardState', { fen: room.game.fen(), whiteTime: room.whiteTime, blackTime: room.blackTime });
  });

  // Hamle yapıldığında
  socket.on('move', (moveData) => {
    if (!currentRoomId || !rooms[currentRoomId]) return;
    const room = rooms[currentRoomId];
    const turn = room.game.turn();

    if ((turn === 'w' && socket.id !== room.players.white) || 
        (turn === 'b' && socket.id !== room.players.black)) {
      socket.emit('boardState', { fen: room.game.fen(), whiteTime: room.whiteTime, blackTime: room.blackTime });
      return;
    }

    try {
      const result = room.game.move(moveData);
      if (result) {
        io.to(currentRoomId).emit('boardState', { fen: room.game.fen(), whiteTime: room.whiteTime, blackTime: room.blackTime });
      } else {
        socket.emit('boardState', { fen: room.game.fen(), whiteTime: room.whiteTime, blackTime: room.blackTime });
      }
    } catch (err) {
      socket.emit('boardState', { fen: room.game.fen(), whiteTime: room.whiteTime, blackTime: room.blackTime });
    }
  });

  // Bağlantı koptuğunda
  socket.on('disconnect', () => {
    if (!currentRoomId || !rooms[currentRoomId]) return;
    const room = rooms[currentRoomId];

    if (socket.id === room.players.white) room.players.white = null;
    if (socket.id === room.players.black) room.players.black = null;

    if (!room.players.white && !room.players.black) {
      if (room.timerInterval) clearInterval(room.timerInterval);
      delete rooms[currentRoomId];
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});