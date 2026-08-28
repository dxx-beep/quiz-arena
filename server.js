const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Load Questions
const questionsPath = path.join(__dirname, 'data', 'questions.json');
let allQuestions = [];
try {
  allQuestions = JSON.parse(fs.readFileSync(questionsPath, 'utf8'));
} catch (err) {
  console.error('Error loading questions:', err);
}

// Helper: Shuffle array
function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Helper: Get randomized questions
function getQuestions(category = 'all', count = 10) {
  let pool = allQuestions;
  if (category && category !== 'all') {
    pool = allQuestions.filter(q => q.category === category);
  }
  if (pool.length === 0) pool = allQuestions;
  
  const shuffled = shuffle(pool);
  const targetCount = Math.min(Number(count) || 10, shuffled.length);
  return shuffled.slice(0, targetCount);
}

// REST API Endpoints
app.get('/api/categories', (req, res) => {
  const categoriesMap = {
    all: { id: 'all', name: 'Усі категорії', count: allQuestions.length, icon: '🌟' }
  };

  allQuestions.forEach(q => {
    if (!categoriesMap[q.category]) {
      let icon = '📚';
      if (q.category === 'it') icon = '💻';
      if (q.category === 'history') icon = '🏛️';
      if (q.category === 'science') icon = '🔬';
      if (q.category === 'geography') icon = '🌍';
      if (q.category === 'cinema') icon = '🎬';
      if (q.category === 'general') icon = '🧠';

      categoriesMap[q.category] = {
        id: q.category,
        name: q.categoryName || q.category,
        count: 0,
        icon
      };
    }
    categoriesMap[q.category].count++;
  });

  res.json(Object.values(categoriesMap));
});

app.get('/api/questions/solo', (req, res) => {
  const { category, count } = req.query;
  const questions = getQuestions(category, count);
  res.json(questions);
});

// Rooms Management
// Room structure:
// {
//   code: string,
//   name: string,
//   hostId: string,
//   hostName: string,
//   category: string,
//   categoryName: string,
//   questionCount: number,
//   timePerQuestion: number,
//   isPrivate: boolean,
//   maxPlayers: number,
//   status: 'waiting' | 'playing' | 'ended',
//   players: { [socketId]: { id, name, avatar, isHost, isReady, score, streak, correctCount } },
//   questions: [],
//   currentQuestionIndex: 0,
//   answers: { [socketId]: { optionIndex, timeRemaining, isCorrect, points } },
//   timer: null,
//   roundTimeout: null
// }
const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `Q-${code}`;
}

function getPublicLobbies() {
  const list = [];
  rooms.forEach((room) => {
    if (!room.isPrivate) {
      list.push({
        code: room.code,
        name: room.name,
        hostName: room.hostName,
        playerCount: Object.keys(room.players).length,
        maxPlayers: room.maxPlayers,
        questionCount: room.questionCount,
        category: room.category,
        categoryName: room.categoryName,
        timePerQuestion: room.timePerQuestion,
        status: room.status
      });
    }
  });
  return list;
}

function broadcastLobbies() {
  io.emit('lobbies_update', getPublicLobbies());
}

app.get('/api/lobbies', (req, res) => {
  res.json(getPublicLobbies());
});

// Socket.io Real-Time Handler
io.on('connection', (socket) => {
  let currentRoomCode = null;

  // Send current lobbies on connect
  socket.emit('lobbies_update', getPublicLobbies());

  // 1. Create Lobby
  socket.on('create_lobby', (data) => {
    try {
      const {
        roomName,
        playerName,
        avatar = '🦊',
        questionCount = 10,
        category = 'all',
        categoryName = 'Усі категорії',
        timePerQuestion = 15,
        isPrivate = false,
        maxPlayers = 8
      } = data;

      const code = generateRoomCode();
      currentRoomCode = code;

      const newRoom = {
        code,
        name: roomName || `Лобі гравця ${playerName}`,
        hostId: socket.id,
        hostName: playerName,
        category,
        categoryName,
        questionCount: Number(questionCount) || 10,
        timePerQuestion: Number(timePerQuestion) || 15,
        isPrivate: !!isPrivate,
        maxPlayers: Number(maxPlayers) || 8,
        status: 'waiting',
        players: {
          [socket.id]: {
            id: socket.id,
            name: playerName,
            avatar,
            isHost: true,
            isReady: true,
            score: 0,
            streak: 0,
            correctCount: 0
          }
        },
        questions: [],
        currentQuestionIndex: 0,
        answers: {},
        roundTimer: null
      };

      rooms.set(code, newRoom);
      socket.join(code);

      socket.emit('lobby_created', {
        room: sanitizeRoomForClient(newRoom),
        yourId: socket.id
      });

      broadcastLobbies();
    } catch (err) {
      socket.emit('error_msg', { message: 'Помилка створення лобі: ' + err.message });
    }
  });

  // 2. Join Lobby
  socket.on('join_lobby', (data) => {
    try {
      const { code, playerName, avatar = '🐼' } = data;
      const normalizedCode = (code || '').trim().toUpperCase();
      const room = rooms.get(normalizedCode);

      if (!room) {
        return socket.emit('error_msg', { message: 'Лобі з таким кодом не знайдено!' });
      }

      if (room.status !== 'waiting') {
        return socket.emit('error_msg', { message: 'Гра в цьому лобі вже розпочалася!' });
      }

      const currentPlayersCount = Object.keys(room.players).length;
      if (currentPlayersCount >= room.maxPlayers) {
        return socket.emit('error_msg', { message: 'Лобі заповнене!' });
      }

      currentRoomCode = normalizedCode;
      socket.join(normalizedCode);

      room.players[socket.id] = {
        id: socket.id,
        name: playerName,
        avatar,
        isHost: false,
        isReady: false,
        score: 0,
        streak: 0,
        correctCount: 0
      };

      socket.emit('lobby_joined', {
        room: sanitizeRoomForClient(room),
        yourId: socket.id
      });

      // Notify others in room
      io.to(normalizedCode).emit('room_updated', sanitizeRoomForClient(room));
      broadcastLobbies();
    } catch (err) {
      socket.emit('error_msg', { message: 'Помилка приєднання до лобі: ' + err.message });
    }
  });

  // 3. Toggle Ready Status
  socket.on('toggle_ready', () => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room || !room.players[socket.id]) return;

    room.players[socket.id].isReady = !room.players[socket.id].isReady;
    io.to(currentRoomCode).emit('room_updated', sanitizeRoomForClient(room));
  });

  // 4. Send Room Chat Message
  socket.on('send_chat', (data) => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room || !room.players[socket.id]) return;

    const player = room.players[socket.id];
    io.to(currentRoomCode).emit('chat_message', {
      sender: player.name,
      avatar: player.avatar,
      text: (data.text || '').slice(0, 200),
      time: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })
    });
  });

  // 5. Start Game (Host only)
  socket.on('start_game', () => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room || room.hostId !== socket.id) return;
    if (room.status !== 'waiting') return;

    // Prepare questions
    room.questions = getQuestions(room.category, room.questionCount);
    room.status = 'playing';
    room.currentQuestionIndex = 0;
    room.answers = {};

    // Reset player scores
    Object.values(room.players).forEach(p => {
      p.score = 0;
      p.streak = 0;
      p.correctCount = 0;
    });

    io.to(currentRoomCode).emit('game_started', {
      totalQuestions: room.questions.length,
      timePerQuestion: room.timePerQuestion,
      categoryName: room.categoryName
    });

    broadcastLobbies();

    // Start 3-second countdown before 1st question
    let countdown = 3;
    const countInterval = setInterval(() => {
      io.to(currentRoomCode).emit('start_countdown', { count: countdown });
      countdown--;
      if (countdown < 0) {
        clearInterval(countInterval);
        sendNextQuestion(room);
      }
    }, 1000);
  });

  // 6. Submit Answer
  socket.on('submit_answer', (data) => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room || room.status !== 'playing') return;

    const { questionIndex, selectedOption, timeRemaining } = data;
    if (questionIndex !== room.currentQuestionIndex) return;
    if (room.answers[socket.id]) return; // already answered

    const currentQ = room.questions[room.currentQuestionIndex];
    const isCorrect = selectedOption === currentQ.correctIndex;
    const player = room.players[socket.id];

    let points = 0;
    if (isCorrect) {
      player.streak = (player.streak || 0) + 1;
      player.correctCount = (player.correctCount || 0) + 1;
      
      // Speed bonus
      const basePoints = 100;
      const speedRatio = Math.max(0, timeRemaining / room.timePerQuestion);
      const speedBonus = Math.round(speedRatio * 50);
      const streakBonus = Math.min(player.streak * 10, 50);
      
      points = basePoints + speedBonus + streakBonus;
      player.score += points;
    } else {
      player.streak = 0;
    }

    room.answers[socket.id] = {
      optionIndex: selectedOption,
      timeRemaining,
      isCorrect,
      points
    };

    // Notify room that this player answered (without revealing correctness yet)
    io.to(currentRoomCode).emit('player_answered', {
      playerId: socket.id,
      answeredCount: Object.keys(room.answers).length,
      totalPlayers: Object.keys(room.players).length
    });

    // If all players in the room answered, trigger round end early!
    const totalConnected = Object.keys(room.players).length;
    if (Object.keys(room.answers).length >= totalConnected) {
      if (room.roundTimer) clearTimeout(room.roundTimer);
      finishRound(room);
    }
  });

  // 7. Leave Lobby
  socket.on('leave_lobby', () => {
    handlePlayerLeave(socket, currentRoomCode);
    currentRoomCode = null;
  });

  // 8. Play Again (Host resets room)
  socket.on('play_again', () => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room || room.hostId !== socket.id) return;

    room.status = 'waiting';
    room.currentQuestionIndex = 0;
    room.answers = {};
    Object.values(room.players).forEach(p => {
      p.score = 0;
      p.streak = 0;
      p.correctCount = 0;
      p.isReady = p.isHost;
    });

    io.to(currentRoomCode).emit('room_reset', sanitizeRoomForClient(room));
    broadcastLobbies();
  });

  // Disconnect
  socket.on('disconnect', () => {
    if (currentRoomCode) {
      handlePlayerLeave(socket, currentRoomCode);
    }
  });
});

// Helper: Send next question
function sendNextQuestion(room) {
  if (!room || room.status !== 'playing') return;

  const currentQ = room.questions[room.currentQuestionIndex];
  if (!currentQ) {
    finishGame(room);
    return;
  }

  room.answers = {};

  // Broadcast question (without correctIndex)
  io.to(room.code).emit('new_question', {
    questionIndex: room.currentQuestionIndex,
    totalQuestions: room.questions.length,
    question: currentQ.question,
    options: currentQ.options,
    categoryName: currentQ.categoryName || room.categoryName,
    timeLimit: room.timePerQuestion
  });

  // Set server-side timer for question timeout
  room.roundTimer = setTimeout(() => {
    finishRound(room);
  }, (room.timePerQuestion + 0.5) * 1000);
}

// Helper: Finish Question Round
function finishRound(room) {
  if (!room || room.status !== 'playing') return;
  if (room.roundTimer) clearTimeout(room.roundTimer);

  const currentQ = room.questions[room.currentQuestionIndex];
  const roundResults = [];

  Object.values(room.players).forEach(p => {
    const ans = room.answers[p.id];
    roundResults.push({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      selectedOption: ans ? ans.optionIndex : null,
      isCorrect: ans ? ans.isCorrect : false,
      pointsEarned: ans ? ans.points : 0,
      currentScore: p.score,
      streak: p.streak
    });
  });

  // Sort leaderboard by currentScore
  roundResults.sort((a, b) => b.currentScore - a.currentScore);

  io.to(room.code).emit('question_result', {
    questionIndex: room.currentQuestionIndex,
    correctIndex: currentQ.correctIndex,
    explanation: currentQ.explanation,
    leaderboard: roundResults
  });

  // Schedule next question or end of game after 4.5s
  setTimeout(() => {
    if (!rooms.has(room.code)) return;
    room.currentQuestionIndex++;
    if (room.currentQuestionIndex < room.questions.length) {
      sendNextQuestion(room);
    } else {
      finishGame(room);
    }
  }, 4500);
}

// Helper: Finish Game
function finishGame(room) {
  if (!room) return;
  room.status = 'ended';

  const finalLeaderboard = Object.values(room.players).map(p => ({
    id: p.id,
    name: p.name,
    avatar: p.avatar,
    score: p.score,
    correctCount: p.correctCount,
    totalQuestions: room.questions.length,
    accuracy: Math.round((p.correctCount / (room.questions.length || 1)) * 100)
  })).sort((a, b) => b.score - a.score);

  io.to(room.code).emit('game_over', {
    leaderboard: finalLeaderboard,
    questionCount: room.questions.length
  });

  broadcastLobbies();
}

// Helper: Leave handling
function handlePlayerLeave(socket, roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  delete room.players[socket.id];
  socket.leave(roomCode);

  const remainingPlayerIds = Object.keys(room.players);

  if (remainingPlayerIds.length === 0) {
    if (room.roundTimer) clearTimeout(room.roundTimer);
    rooms.delete(roomCode);
    broadcastLobbies();
    return;
  }

  // If host left, appoint new host
  if (room.hostId === socket.id) {
    const nextHostId = remainingPlayerIds[0];
    room.hostId = nextHostId;
    room.hostName = room.players[nextHostId].name;
    room.players[nextHostId].isHost = true;
    room.players[nextHostId].isReady = true;
  }

  io.to(roomCode).emit('room_updated', sanitizeRoomForClient(room));
  broadcastLobbies();
}

// Helper: Sanitize Room for clients
function sanitizeRoomForClient(room) {
  return {
    code: room.code,
    name: room.name,
    hostId: room.hostId,
    hostName: room.hostName,
    category: room.category,
    categoryName: room.categoryName,
    questionCount: room.questionCount,
    timePerQuestion: room.timePerQuestion,
    isPrivate: room.isPrivate,
    maxPlayers: room.maxPlayers,
    status: room.status,
    players: room.players
  };
}

server.listen(PORT, () => {
  console.log(`🚀 QuizArena server running on http://localhost:${PORT}`);
});
