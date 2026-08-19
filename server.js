const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

// chess.js modül yüklemesi
const chessModule = require('chess.js');
const Chess = chessModule.Chess || chessModule;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Statik dosyaları (index.html vb.) sun
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Aktif oyun odaları
const rooms = {};

io.on('connection', (socket) => {
  console.log('Bir kullanıcı bağlandı:', socket.id);

  socket.on('joinGame', (roomId) => {
    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = {
        game: new Chess(),
        players: [],
        restartRequests: new Set()
      };
    }

    const room = rooms[roomId];

    if (room.players.length < 2 && !room.players.includes(socket.id)) {
      room.players.push(socket.id);
    }

    const color = room.players[0] === socket.id ? 'w' : 'b';

    socket.emit('init', {
      fen: room.game.fen(),
      color: color,
      turn: room.game.turn()
    });

    socket.on('move', (moveData) => {
      try {
        const move = room.game.move(moveData);
        if (move) {
          io.to(roomId).emit('move', {
            move: move,
            fen: room.game.fen(),
            turn: room.game.turn(),
            isCheckmate: room.game.in_checkmate(),
            isDraw: room.game.in_draw()
          });
        }
      } catch (err) {
        socket.emit('invalidMove', err.message);
      }
    });

    socket.on('requestRestart', () => {
      room.restartRequests.add(socket.id);
      if (room.restartRequests.size >= 2) {
        room.game.reset();
        room.restartRequests.clear();
        io.to(roomId).emit('restartGame', {
          fen: room.game.fen(),
          turn: room.game.turn()
        });
      } else {
        socket.to(roomId).emit('opponentRequestedRestart');
      }
    });

    socket.on('disconnect', () => {
      console.log('Kullanıcı ayrıldı:', socket.id);
      if (room) {
        room.players = room.players.filter(id => id !== socket.id);
        room.restartRequests.delete(socket.id);
      }
    });
  });
});

// Render için dinamik port kullanımı (SABİT 3000 YERİNE)
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});