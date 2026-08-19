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
  // Oyuncu rollerini belirle
  if (!players.white) {
    players.white = socket.id;
    socket.emit('playerRole', 'w');
  } else if (!players.black) {
    players.black = socket.id;
    socket.emit('playerRole', 'b');
  } else {
    socket.emit('spectatorRole');
  }

  // Mevcut tahta durumunu gönder
  socket.emit('boardState', game.fen());

  socket.on('move', (moveData) => {
    // Sıra hamle yapan oyuncuda mı kontrol et
    const turn = game.turn();
    if ((turn === 'w' && socket.id !== players.white) || 
        (turn === 'b' && socket.id !== players.black)) {
      socket.emit('boardState', game.fen());
      return;
    }

    try {
      const result = game.move(moveData);
      if (result) {
        // Geçerli hamle: Tüm oyunculara yeni tahta durumunu ilet
        io.emit('boardState', game.fen());
      } else {
        // Geçersiz hamle: Tahtayı eski haline sıfırla
        socket.emit('boardState', game.fen());
      }
    } catch (err) {
      // Hata durumunda tahtayı senkronize et
      socket.emit('boardState', game.fen());
    }
  });

  socket.on('disconnect', () => {
    if (socket.id === players.white) delete players.white;
    if (socket.id === players.black) delete players.black;
    // Biri ayrılırsa oyunu sıfırla
    if (!players.white && !players.black) {
      game = new Chess();
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});