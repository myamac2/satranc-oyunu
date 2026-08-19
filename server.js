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

// Statik dosyaları sun
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Aktif oyun odaları
const rooms = {};

io.on('connection', (socket) => {
  console.log('Bir kullanıcı bağlandı:', socket.id);

  socket.on('joinGame', (roomId) => {
    // Önceki odalardan temizle
    if (socket.roomId) {
      socket.leave(socket.roomId);
    }

    socket.roomId = roomId;
    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = {
        game: new Chess(),
        players: [],
        restartRequests: new Set()
      };
    }

    const room = rooms[roomId];

    // Oyuncuyu odaya ekle (Maksimum 2 oyuncu)
    if (!room.players.includes(socket.id) && room.players.length < 2) {
      room.players.push(socket.id);
    }

    // Oyuncunun taş rengini belirle
    const playerIndex = room.players.indexOf(socket.id);
    const color = playerIndex === 0 ? 'w' : (playerIndex === 1 ? 'b' : 's'); // 's' izleyici/spectator

    // Oyuncuya kendi rengini ve mevcut tahtayı gönder
    socket.emit('init', {
      fen: room.game.fen(),
      color: color,
      turn: room.game.turn(),
      playerCount: room.players.length
    });

    // Eğer odaya 2 kişi ulaştıysa iki tarafa da oyunun başladığını haber ver
    if (room.players.length === 2) {
      io.to(roomId).emit('gameStart', {
        fen: room.game.fen(),
        turn: room.game.turn()
      });
    }

    // Hamle Yapma
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

    // Yeniden Başlatma İsteği ve Onay Mekanizması
    socket.on('requestRestart', () => {
      room.restartRequests.add(socket.id);

      if (room.restartRequests.size >= 2) {
        // İki taraf da onay verdi, tahtayı sıfırla
        room.game.reset();
        room.restartRequests.clear();
        io.to(roomId).emit('restartGame', {
          fen: room.game.fen(),
          turn: room.game.turn()
        });
      } else {
        // Karşı tarafa onay isteği bildir
        socket.to(roomId).emit('opponentRequestedRestart');
      }
    });

    // Kullanıcı Ayrıldığında
    socket.on('disconnect', () => {
      console.log('Kullanıcı ayrıldı:', socket.id);
      if (room) {
        room.players = room.players.filter(id => id !== socket.id);
        room.restartRequests.delete(socket.id);
        io.to(roomId).emit('playerLeft');
      }
    });
  });
});

// Port Tanımlaması
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});