const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Chess } = require('chess.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const rooms = {};

// Taş değerleri (Bot değerlendirme algoritması için)
const pieceValues = {
  p: 10,
  n: 30,
  b: 30,
  r: 50,
  q: 90,
  k: 900
};

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
        
        if (move.color === 'w') room.timers.w += room.increment;
        if (move.color === 'b') room.timers.b += room.increment;

        sendBoardState(currentRoom);

        const isGameOver = typeof game.isGameOver === 'function' ? game.isGameOver() : game.game_over();
        
        if (isGameOver) {
          clearInterval(room.timerInterval);
          let reason = 'Oyun Bitti!';
          const isCheckmate = typeof game.isCheckmate === 'function' ? game.isCheckmate() : game.in_checkmate();
          const isDraw = typeof game.isDraw === 'function' ? game.isDraw() : game.in_draw();

          if (isCheckmate) reason = `Şah Mat! Kazanan: ${game.turn() === 'w' ? 'Siyah' : 'Beyaz'}`;
          else if (isDraw) reason = 'Oyun Berabere!';
          
          io.to(currentRoom).emit('gameOver', reason);
          return;
        }

        // Akıllı Bot Hamlesi
        if (room.isVsAi && game.turn() === 'b' && !isGameOver) {
          setTimeout(() => makeSmartAiMove(currentRoom), 500);
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
      
      room.spectators = room.spectators.filter(id => id !== socket.id);

      if (!room.white && !room.black && room.spectators.length === 0) {
        clearInterval(room.timerInterval);
        delete rooms[currentRoom];
      }
    }
  });
});

// Akıllı Yapay Zeka (Minimax Değerlendirmeli)
function makeSmartAiMove(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  const game = room.game;
  const moves = game.moves({ verbose: true });
  if (moves.length === 0) return;

  let bestMove = null;
  let bestValue = -9999;

  for (let i = 0; i < moves.length; i++) {
    const move = moves[i];
    game.move(move);

    // Tahta durumunu değerlendir
    let boardValue = evaluateBoard(game, 'b');

    // Eğer hamle mat ediyorsa doğrudan seç
    const isCheckmate = typeof game.isCheckmate === 'function' ? game.isCheckmate() : game.in_checkmate();
    if (isCheckmate) boardValue += 10000;

    game.undo();

    if (boardValue > bestValue) {
      bestValue = boardValue;
      bestMove = move;
    }
  }

  // Değerler eşitse rastgelelik kat
  if (!bestMove) {
    bestMove = moves[Math.floor(Math.random() * moves.length)];
  }

  const executedMove = game.move(bestMove);
  if (executedMove) {
    room.lastMove = executedMove;
    room.timers.b += room.increment;
    sendBoardState(roomId);

    const isGameOver = typeof game.isGameOver === 'function' ? game.isGameOver() : game.game_over();
    if (isGameOver) {
      clearInterval(room.timerInterval);
      let reason = 'Oyun Bitti!';
      const isCheckmate = typeof game.isCheckmate === 'function' ? game.isCheckmate() : game.in_checkmate();
      const isDraw = typeof game.isDraw === 'function' ? game.isDraw() : game.in_draw();

      if (isCheckmate) reason = 'Şah Mat! Kazanan: Siyah (BOT)';
      else if (isDraw) reason = 'Oyun Berabere!';
      
      io.to(roomId).emit('gameOver', reason);
    }
  }
}

function evaluateBoard(game, botColor) {
  let totalEvaluation = 0;
  const board = game.board();

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row][col];
      if (piece) {
        const val = pieceValues[piece.type] || 0;
        if (piece.color === botColor) {
          totalEvaluation += val;
        } else {
          totalEvaluation -= val;
        }
      }
    }
  }
  return totalEvaluation;
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