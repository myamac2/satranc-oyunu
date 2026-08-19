const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const chessModule = require('chess.js');
const Chess = chessModule.Chess || chessModule;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const Chess = chessModule.Chess || chessModule;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const rooms = {};

function startRoomTimer(roomId) {
  const room = rooms[roomId];
  if (!room || room.timerInterval) return;

  room.timerInterval = setInterval(() => {
    if (room.game.game_over()) {
      clearInterval(room.timerInterval);
      room.timerInterval = null;
      return;
    }

    const turn = room.game.turn();
    if (turn === 'w') {
      room.whiteTime--;
      if (room.whiteTime <= 0) {
        room.whiteTime = 0;
        clearInterval(room.timerInterval);
        room.timerInterval = null;
        io.to(roomId).emit('gameOver', 'Süre Bitti! Siyah Kazandı.');
      }
    } else {
      room.blackTime--;
      if (room.blackTime <= 0) {
        room.blackTime = 0;
        clearInterval(room.timerInterval);
        room.timerInterval = null;
        io.to(roomId).emit('gameOver', 'Süre Bitti! Beyaz Kazandı.');
      }
    }

    io.to(roomId).emit('timerUpdate', {
      whiteTime: room.whiteTime,
      blackTime: room.blackTime,
      turn: turn
    });
  }, 1000);
}

function resetRoomState(room) {
  if (room.timerInterval) {
    clearInterval(room.timerInterval);
    room.timerInterval = null;
  }
  room.game = new Chess();
  room.whiteTime = 600;
  room.blackTime = 600;
  room.lastMove = null;
}

io.on('connection', (socket) => {
  socket.on('joinRoom', (roomId) => {
    if (!rooms[roomId]) {
      rooms[roomId] = {
        game: new Chess(),
        players: {},
        whiteTime: 600,
        blackTime: 600,
        timerInterval: null,
        lastMove: null
      };
    }

    const room = rooms[roomId];
    socket.roomId = roomId;
    socket.join(roomId);

    const playerColors = Object.values(room.players);
    if (!playerColors.includes('w')) {
      room.players[socket.id] = 'w';
      socket.emit('playerRole', 'w');
    } else if (!playerColors.includes('b')) {
      room.players[socket.id] = 'b';
      socket.emit('playerRole', 'b');
      startRoomTimer(roomId);
    } else {
      socket.emit('spectatorRole');
    }

    const playerCount = Object.keys(room.players).length;
    let statusMsg = '';
    if (playerCount === 1) statusMsg = 'Rakip bekleniyor...';
    else if (playerCount >= 2) statusMsg = 'Oyun Başladı!';

    io.to(roomId).emit('gameStatus', statusMsg);

    socket.emit('boardState', {
      fen: room.game.fen(),
      whiteTime: room.whiteTime,
      blackTime: room.blackTime,
      lastMove: room.lastMove
    });
  });

  socket.on('move', (moveData) => {
    const room = rooms[socket.roomId];
    if (!room) return;

    const playerColor = room.players[socket.id];
    if (!playerColor || playerColor !== room.game.turn()) return;

    try {
      const move = room.game.move(moveData);
      if (move) {
        room.lastMove = { from: move.from, to: move.to, captured: move.captured };
        io.to(socket.roomId).emit('boardState', {
          fen: room.game.fen(),
          whiteTime: room.whiteTime,
          blackTime: room.blackTime,
          lastMove: room.lastMove
        });

        if (room.game.in_checkmate()) {
          io.to(socket.roomId).emit('gameOver', `Şah Mat! Kazanan: ${playerColor === 'w' ? 'Beyaz' : 'Siyah'}`);
        } else if (room.game.in_draw()) {
          io.to(socket.roomId).emit('gameOver', 'Oyun Berabere!');
        }
      }
    } catch (e) {
      console.log('Geçersiz hamle');
    }
  });

  // YENİDEN BAŞLATMA İSTEĞİ
  socket.on('requestRestart', () => {
    const room = rooms[socket.roomId];
    if (!room) return;

    // İstek atan dışındaki diğer oyuncuya onay penceresi gönder
    socket.to(socket.roomId).emit('restartRequested');
  });

  // İSTEK KABUL EDİLDİ
  socket.on('acceptRestart', () => {
    const room = rooms[socket.roomId];
    if (!room) return;

    resetRoomState(room);
    if (Object.keys(room.players).length >= 2) {
      startRoomTimer(socket.roomId);
    }

    io.to(socket.roomId).emit('boardState', {
      fen: room.game.fen(),
      whiteTime: room.whiteTime,
      blackTime: room.blackTime,
      lastMove: null
    });
    io.to(socket.roomId).emit('gameStatus', 'Oyun yeniden başlatıldı!');
  });

  // İSTEK REDDEDİLDİ
  socket.on('declineRestart', () => {
    socket.to(socket.roomId).emit('restartDeclined');
  });

  socket.on('resign', () => {
    const room = rooms[socket.roomId];
    if (!room) return;
    const playerColor = room.players[socket.id];
    if (playerColor) {
      const winner = playerColor === 'w' ? 'Siyah' : 'Beyaz';
      io.to(socket.roomId).emit('gameOver', `${playerColor === 'w' ? 'Beyaz' : 'Siyah'} pes etti! Kazanan: ${winner}`);
    }
  });

  socket.on('disconnect', () => {
    const room = rooms[socket.roomId];
    if (room) {
      delete room.players[socket.id];
      if (Object.keys(room.players).length === 0) {
        if (room.timerInterval) clearInterval(room.timerInterval);
        delete rooms[socket.roomId];
      } else {
        io.to(socket.roomId).emit('gameStatus', 'Rakip ayrıldı.');
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Sunucu ${PORT} portunda çalışıyor...`));