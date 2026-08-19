const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Chess } = require('chess.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const rooms = {};

io.on('connection', (socket) => {
  let currentRoom = null;
  let userRole = null;

  socket.on('joinRoom', ({ roomId, timeConfig, isVsAi }) => {
    currentRoom = roomId;

    if (!rooms[roomId]) {
      const initialTime = timeConfig ? timeConfig.time * 60 : 600;
      const increment = timeConfig ? timeConfig.inc : 0;

      rooms[roomId] = {
        game: new Chess(),
        white: null,
        black: null,
        spectators: [],
        timers: { w: initialTime, b: initialTime },
        increment: increment,
        initialTime: initialTime,
        timerInterval: null,
        lastMove: null,
        isVsAi: !!isVsAi,
        drawOffers: { w: false, b: false }
      };
    }

    const room = rooms[roomId];

    if (!room.white) {
      room.white = socket.id;
      userRole = 'w';
      socket.emit('playerRole', 'w');
    } else if (!room.black && !room.isVsAi) {
      room.black = socket.id;
      userRole = 'b';
      socket.emit('playerRole', 'b');
      io.to(roomId).emit('gameStatus', 'Oyun Başladı!');
      startTimer(roomId);
    } else if (room.isVsAi && !room.black) {
      room.black = 'BOT';
      userRole = 'w';
      socket.emit('playerRole', 'w');
      io.to(roomId).emit('gameStatus', 'Yapay Zekaya Karşı Oyun Başladı!');
      startTimer(roomId);
    } else {
      userRole = 's';
      room.spectators.push(socket.id);
      socket.emit('spectatorRole');
    }

    socket.join(roomId);
    sendBoardState(roomId);
  });

  socket.on('move', (moveData) => {
    const room = rooms[currentRoom];
    if (!room) return;

    const game = room.game;
    if ((game.turn() === 'w' && userRole !== 'w') || (game.turn() === 'b' && userRole !== 'b')) return;

    try {
      const move = game.move(moveData);
      if (move) {
        room.lastMove = move;
        
        // Increment ekle
        if (move.color === 'w') room.timers.w += room.increment;
        if (move.color === 'b') room.timers.b += room.increment;

        sendBoardState(currentRoom);

        if (game.game_over()) {
          clearInterval(room.timerInterval);
          let reason = 'Oyun Bitti!';
          if (game.in_checkmate()) reason = `Şah Mat! Kazanan: ${game.turn() === 'w' ? 'Siyah' : 'Beyaz'}`;
          else if (game.in_draw()) reason = 'Oyun Berabere!';
          io.to(currentRoom).emit('gameOver', reason);
          return;
        }

        // Bot Hamlesi
        if (room.isVsAi && game.turn() === 'b' && !game.game_over()) {
          setTimeout(() => makeAiMove(currentRoom), 600);
        }
      }
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('sendMessage', (msg) => {
    if (!currentRoom) return;
    io.to(currentRoom).emit('chatMessage', {
      sender: userRole === 'w' ? 'Beyaz' : userRole === 'b' ? 'Siyah' : 'İzleyici',
      role: userRole,
      text: msg
    });
  });

  socket.on('offerDraw', () => {
    const room = rooms[currentRoom];
    if (!room || userRole === 's') return;
    
    if (userRole === 'w') room.drawOffers.w = true;
    if (userRole === 'b') room.drawOffers.b = true;

    if (room.drawOffers.w && room.drawOffers.b) {
      clearInterval(room.timerInterval);
      io.to(currentRoom).emit('gameOver', 'Anlaşmalı Beraberlik!');
    } else {
      socket.to(currentRoom).emit('drawOffered');
    }
  });

  socket.on('acceptDraw', () => {
    const room = rooms[currentRoom];
    if (!room) return;
    clearInterval(room.timerInterval);
    io.to(currentRoom).emit('gameOver', 'Anlaşmalı Beraberlik!');
  });

  socket.on('resign', () => {
    const room = rooms[currentRoom];
    if (!room || userRole === 's') return;
    clearInterval(room.timerInterval);
    const winner = userRole === 'w' ? 'Siyah' : 'Beyaz';
    io.to(currentRoom).emit('gameOver', `${userRole === 'w' ? 'Beyaz' : 'Siyah'} pes etti. Kazanan: ${winner}`);
  });

  socket.on('requestRestart', () => {
    if (currentRoom) socket.to(currentRoom).emit('restartRequested');
  });

  socket.on('acceptRestart', () => {
    const room = rooms[currentRoom];
    if (!room) return;
    room.game.reset();
    room.timers = { w: room.initialTime, b: room.initialTime };
    room.lastMove = null;
    room.drawOffers = { w: false, b: false };
    sendBoardState(currentRoom);
    startTimer(currentRoom);
    io.to(currentRoom).emit('gameStatus', 'Oyun yeniden başlatıldı!');
  });

  socket.on('disconnect', () => {
    if (currentRoom && rooms[currentRoom]) {
      const room = rooms[currentRoom];
      if (socket.id === room.white) room.white = null;
      if (socket.id === room.black) room.black = null;
    }
  });
});

function makeAiMove(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  const game = room.game;
  const moves = game.moves({ verbose: true });
  if (moves.length === 0) return;

  // Basit Bot Yapay Zekası: Taş alma hamlelerine öncelik verir
  const captureMoves = moves.filter(m => m.captured);
  const selectedMove = captureMoves.length > 0 
    ? captureMoves[Math.floor(Math.random() * captureMoves.length)]
    : moves[Math.floor(Math.random() * moves.length)];

  const move = game.move(selectedMove);
  if (move) {
    room.lastMove = move;
    room.timers.b += room.increment;
    sendBoardState(roomId);

    if (game.game_over()) {
      clearInterval(room.timerInterval);
      let reason = 'Oyun Bitti!';
      if (game.in_checkmate()) reason = 'Şah Mat! Kazanan: Siyah (BOT)';
      else if (game.in_draw()) reason = 'Oyun Berabere!';
      io.to(roomId).emit('gameOver', reason);
    }
  }
}

function startTimer(roomId) {
  const room = rooms[roomId];
  if (!room || room.timerInterval) return;

  room.timerInterval = setInterval(() => {
    const turn = room.game.turn();
    if (turn === 'w') room.timers.w--;
    else room.timers.b--;

    io.to(roomId).emit('timerUpdate', {
      whiteTime: room.timers.w,
      blackTime: room.timers.b,
      turn: turn
    });

    if (room.timers.w <= 0 || room.timers.b <= 0) {
      clearInterval(room.timerInterval);
      const winner = room.timers.w <= 0 ? 'Siyah' : 'Beyaz';
      io.to(roomId).emit('gameOver', `Zaman Bitti! Kazanan: ${winner}`);
    }
  }, 1000);
}

function sendBoardState(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  io.to(roomId).emit('boardState', {
    fen: room.game.fen(),
    pgn: room.game.pgn(),
    lastMove: room.lastMove,
    whiteTime: room.timers.w,
    blackTime: room.timers.b
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server ${PORT} portunda yayında.`));