// QuizArena - Real P2P WebRTC Multiplayer & Solo Engine via PeerJS
document.addEventListener('DOMContentLoaded', () => {
  // App State
  const state = {
    user: {
      id: 'usr_' + Math.random().toString(36).substr(2, 9),
      name: localStorage.getItem('qa_player_name') || `Гравець_${Math.floor(Math.random() * 900 + 100)}`,
      avatar: localStorage.getItem('qa_player_avatar') || '🦊',
      theme: localStorage.getItem('qa_theme') || 'light'
    },
    currentView: 'screenHome',
    
    // Solo State
    solo: {
      count: 10,
      timeLimit: 15,
      questions: [],
      currentIndex: 0,
      score: 0,
      streak: 0,
      correctCount: 0,
      userAnswers: [],
      timerInterval: null,
      timeRemaining: 15
    },

    // Real Multiplayer State (P2P via PeerJS)
    multi: {
      peer: null,
      peerId: null,
      isHost: false,
      hostConn: null,       // Guest's connection to host
      guestConns: new Map(),// Host's connections to guests { peerId: conn }
      room: null,
      timeRemaining: 15,
      timerInterval: null,
      hasAnsweredCurrent: false,
      publicLobbies: []
    }
  };

  // DOM Elements
  const screens = {
    home: document.getElementById('screenHome'),
    soloSetup: document.getElementById('screenSoloSetup'),
    lobbies: document.getElementById('screenLobbies'),
    lobbyRoom: document.getElementById('screenLobbyRoom'),
    game: document.getElementById('screenGame'),
    results: document.getElementById('screenResults')
  };

  const headerPlayerName = document.getElementById('headerPlayerName');
  const headerPlayerAvatar = document.getElementById('headerPlayerAvatar');
  const btnToggleTheme = document.getElementById('btnToggleTheme');
  const btnToggleSound = document.getElementById('btnToggleSound');
  const btnLogoHome = document.getElementById('btnLogoHome');
  const btnOpenProfile = document.getElementById('btnOpenProfile');

  const modalCreateLobby = document.getElementById('modalCreateLobby');
  const modalProfile = document.getElementById('modalProfile');
  const countdownOverlay = document.getElementById('countdownOverlay');
  const countdownNum = document.getElementById('countdownNum');
  const toastContainer = document.getElementById('toastContainer');

  // Broadcast channel for multi-tab sync & public lobby list discovery
  const broadcast = window.BroadcastChannel ? new BroadcastChannel('quiz_arena_p2p_channel') : null;
  if (broadcast) {
    broadcast.onmessage = (e) => {
      handleBroadcastMessage(e.data);
    };
  }

  // -------------------------------------------------------------
  // INITIALIZATION & THEME & AUDIO
  // -------------------------------------------------------------
  function initUser() {
    document.documentElement.setAttribute('data-theme', state.user.theme);
    btnToggleTheme.textContent = state.user.theme === 'dark' ? '☀️' : '🌙';
    headerPlayerName.textContent = state.user.name;
    headerPlayerAvatar.textContent = state.user.avatar;
    document.getElementById('inputProfileName').value = state.user.name;
  }

  btnToggleTheme.addEventListener('click', () => {
    state.user.theme = state.user.theme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', state.user.theme);
    localStorage.setItem('qa_theme', state.user.theme);
    btnToggleTheme.textContent = state.user.theme === 'dark' ? '☀️' : '🌙';
    window.soundController.playClick();
  });

  btnToggleSound.addEventListener('click', () => {
    const isEnabled = window.soundController.toggle();
    btnToggleSound.textContent = isEnabled ? '🔊' : '🔇';
    showToast(isEnabled ? 'Звук увімкнено' : 'Звук вимкнено', 'info');
  });

  btnLogoHome.addEventListener('click', () => {
    window.soundController.playClick();
    if (state.multi.room) {
      if (confirm('Ви дійсно хочете вийти з поточної кімнати?')) {
        leaveCurrentLobby();
        showScreen('screenHome');
      }
    } else {
      showScreen('screenHome');
    }
  });

  // Profile Modal Handlers
  btnOpenProfile.addEventListener('click', () => {
    modalProfile.style.display = 'flex';
    document.querySelectorAll('#avatarGrid .avatar-option').forEach(el => {
      el.classList.toggle('selected', el.getAttribute('data-avatar') === state.user.avatar);
    });
    window.soundController.playClick();
  });

  document.getElementById('btnCloseProfileModal').addEventListener('click', () => {
    modalProfile.style.display = 'none';
  });

  document.querySelectorAll('#avatarGrid .avatar-option').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('#avatarGrid .avatar-option').forEach(el => el.classList.remove('selected'));
      opt.classList.add('selected');
      window.soundController.playClick();
    });
  });

  document.getElementById('formProfile').addEventListener('submit', (e) => {
    e.preventDefault();
    const newName = document.getElementById('inputProfileName').value.trim();
    const selectedAvatar = document.querySelector('#avatarGrid .avatar-option.selected')?.getAttribute('data-avatar') || '🦊';
    if (newName) {
      state.user.name = newName;
      state.user.avatar = selectedAvatar;
      localStorage.setItem('qa_player_name', newName);
      localStorage.setItem('qa_player_avatar', selectedAvatar);
      headerPlayerName.textContent = newName;
      headerPlayerAvatar.textContent = selectedAvatar;
      modalProfile.style.display = 'none';
      showToast('Профіль оновлено!', 'success');
      window.soundController.playClick();

      // If currently in lobby, update info
      if (state.multi.room) {
        if (state.multi.isHost) {
          state.multi.room.players[state.user.id].name = newName;
          state.multi.room.players[state.user.id].avatar = selectedAvatar;
          broadcastToRoom({ type: 'ROOM_UPDATED', room: state.multi.room });
          renderWaitingRoom();
        } else if (state.multi.hostConn) {
          state.multi.hostConn.send({
            type: 'UPDATE_PROFILE',
            name: newName,
            avatar: selectedAvatar
          });
        }
      }
    }
  });

  function showScreen(screenId) {
    Object.values(screens).forEach(scr => scr.classList.remove('active'));
    if (screens[screenId.replace('screen', '').toLowerCase()]) {
      screens[screenId.replace('screen', '').toLowerCase()].classList.add('active');
    } else if (document.getElementById(screenId)) {
      document.getElementById(screenId).classList.add('active');
    }
    state.currentView = screenId;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = 'toast';
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '⚠️';
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 250);
    }, 3000);
  }

  function shuffle(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // -------------------------------------------------------------
  // HOME ACTIONS
  // -------------------------------------------------------------
  document.getElementById('btnGoSolo').addEventListener('click', () => {
    window.soundController.playClick();
    showScreen('screenSoloSetup');
  });

  document.getElementById('btnCardSolo').addEventListener('click', () => {
    window.soundController.playClick();
    showScreen('screenSoloSetup');
  });

  document.getElementById('btnSoloBackHome').addEventListener('click', () => {
    window.soundController.playClick();
    showScreen('screenHome');
  });

  document.getElementById('btnGoLobbies').addEventListener('click', () => {
    window.soundController.playClick();
    showScreen('screenLobbies');
    refreshPublicLobbies();
  });

  document.getElementById('btnLobbiesBackHome').addEventListener('click', () => {
    window.soundController.playClick();
    showScreen('screenHome');
  });

  document.getElementById('btnJoinByCodeHome').addEventListener('click', () => {
    const code = document.getElementById('inputJoinCodeHome').value.trim();
    if (!code) {
      return showToast('Будь ласка, введіть код кімнати!', 'error');
    }
    joinLobbyByCode(code);
  });

  // -------------------------------------------------------------
  // SOLO QUIZ SETUP & GAMEPLAY
  // -------------------------------------------------------------
  document.querySelectorAll('#soloCountSelectors .chip-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#soloCountSelectors .chip-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.solo.count = Number(btn.getAttribute('data-count'));
      window.soundController.playClick();
    });
  });

  document.querySelectorAll('#soloTimerSelectors .chip-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#soloTimerSelectors .chip-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.solo.timeLimit = Number(btn.getAttribute('data-time'));
      window.soundController.playClick();
    });
  });

  document.getElementById('btnStartSoloGame').addEventListener('click', () => {
    window.soundController.playClick();
    const pool = window.QUIZ_QUESTIONS || [];
    const count = Math.min(state.solo.count, pool.length);
    const shuffled = shuffle(pool);

    state.solo.questions = shuffled.slice(0, count);
    state.solo.currentIndex = 0;
    state.solo.score = 0;
    state.solo.streak = 0;
    state.solo.correctCount = 0;
    state.solo.userAnswers = [];

    startSoloQuestion();
  });

  function startSoloQuestion() {
    showScreen('screenGame');
    document.getElementById('gameLiveIndicator').style.display = 'none';
    document.getElementById('soloNextBtnContainer').style.display = 'block';
    document.getElementById('btnSoloNextQuestion').style.display = 'none';
    document.getElementById('gameExplanationBox').style.display = 'none';

    const q = state.solo.questions[state.solo.currentIndex];
    const total = state.solo.questions.length;

    document.getElementById('gameCategoryBadge').textContent = q.categoryName || 'Логіка';
    document.getElementById('gameCurrentQNum').textContent = state.solo.currentIndex + 1;
    document.getElementById('gameTotalQNum').textContent = total;
    document.getElementById('gameScoreBadge').textContent = `🏆 ${state.solo.score} очок`;
    document.getElementById('gameQuestionText').textContent = q.question;

    const optContainer = document.getElementById('gameOptionsContainer');
    optContainer.innerHTML = '';
    const letters = ['A', 'B', 'C', 'D'];

    q.options.forEach((optText, optIdx) => {
      const btn = document.createElement('button');
      btn.className = 'option-btn';
      btn.innerHTML = `
        <span class="opt-letter">${letters[optIdx]}</span>
        <span>${optText}</span>
      `;
      btn.addEventListener('click', () => {
        handleSoloAnswer(optIdx, btn);
      });
      optContainer.appendChild(btn);
    });

    if (state.solo.timerInterval) clearInterval(state.solo.timerInterval);
    const timerBar = document.getElementById('gameTimerBar');

    if (state.solo.timeLimit > 0) {
      state.solo.timeRemaining = state.solo.timeLimit;
      timerBar.style.width = '100%';
      timerBar.style.background = 'linear-gradient(90deg, var(--primary), var(--secondary))';

      const totalTime = state.solo.timeLimit;
      const stepMs = 100;
      let elapsed = 0;

      state.solo.timerInterval = setInterval(() => {
        elapsed += stepMs;
        const remaining = Math.max(0, totalTime - elapsed / 1000);
        state.solo.timeRemaining = remaining;

        const pct = (remaining / totalTime) * 100;
        timerBar.style.width = `${pct}%`;

        if (pct < 30) {
          timerBar.style.background = 'var(--danger)';
        }

        if (remaining <= 0) {
          clearInterval(state.solo.timerInterval);
          handleSoloTimeout();
        }
      }, stepMs);
    } else {
      timerBar.style.width = '100%';
    }
  }

  function handleSoloAnswer(selectedIdx, btnElement) {
    if (state.solo.timerInterval) clearInterval(state.solo.timerInterval);

    const q = state.solo.questions[state.solo.currentIndex];
    const isCorrect = selectedIdx === q.correctIndex;

    const allBtns = document.querySelectorAll('#gameOptionsContainer .option-btn');
    allBtns.forEach((b, idx) => {
      b.disabled = true;
      if (idx === q.correctIndex) {
        b.classList.add('correct');
      } else if (idx === selectedIdx && !isCorrect) {
        b.classList.add('wrong');
      }
    });

    if (isCorrect) {
      state.solo.streak++;
      state.solo.correctCount++;
      const timeBonus = state.solo.timeLimit > 0 ? Math.round((state.solo.timeRemaining / state.solo.timeLimit) * 50) : 0;
      const streakBonus = Math.min(state.solo.streak * 10, 50);
      const points = 100 + timeBonus + streakBonus;
      state.solo.score += points;
      window.soundController.playCorrect();
      showToast(`+${points} очок! 🔥 Серія: ${state.solo.streak}`, 'success');
    } else {
      state.solo.streak = 0;
      window.soundController.playIncorrect();
    }

    state.solo.userAnswers.push({
      question: q.question,
      options: q.options,
      correctIndex: q.correctIndex,
      selectedIndex: selectedIdx,
      isCorrect,
      explanation: q.explanation
    });

    if (q.explanation) {
      document.getElementById('gameExplanationText').textContent = q.explanation;
      document.getElementById('gameExplanationBox').style.display = 'block';
    }

    document.getElementById('gameScoreBadge').textContent = `🏆 ${state.solo.score} очок`;
    document.getElementById('btnSoloNextQuestion').style.display = 'inline-flex';
  }

  function handleSoloTimeout() {
    const q = state.solo.questions[state.solo.currentIndex];
    const allBtns = document.querySelectorAll('#gameOptionsContainer .option-btn');
    allBtns.forEach((b, idx) => {
      b.disabled = true;
      if (idx === q.correctIndex) {
        b.classList.add('correct');
      }
    });

    state.solo.streak = 0;
    window.soundController.playIncorrect();
    showToast('Час вичерпано!', 'error');

    state.solo.userAnswers.push({
      question: q.question,
      options: q.options,
      correctIndex: q.correctIndex,
      selectedIndex: null,
      isCorrect: false,
      explanation: q.explanation
    });

    if (q.explanation) {
      document.getElementById('gameExplanationText').textContent = q.explanation;
      document.getElementById('gameExplanationBox').style.display = 'block';
    }

    document.getElementById('btnSoloNextQuestion').style.display = 'inline-flex';
  }

  document.getElementById('btnSoloNextQuestion').addEventListener('click', () => {
    window.soundController.playClick();
    state.solo.currentIndex++;
    if (state.solo.currentIndex < state.solo.questions.length) {
      startSoloQuestion();
    } else {
      showSoloResults();
    }
  });

  function showSoloResults() {
    showScreen('screenResults');
    document.getElementById('multiplayerPodium').style.display = 'none';
    document.getElementById('scoreBadgeCircle').style.display = 'flex';

    const total = state.solo.questions.length;
    const correct = state.solo.correctCount;
    const accuracy = Math.round((correct / (total || 1)) * 100);

    document.getElementById('resultsTitle').textContent = accuracy >= 70 ? '🎉 Чудовий результат!' : '📊 Тест завершено!';
    document.getElementById('resScoreValue').textContent = `${accuracy}%`;
    document.getElementById('resTotalScore').textContent = state.solo.score;
    document.getElementById('resCorrectCount').textContent = `${correct} / ${total}`;
    document.getElementById('resAccuracy').textContent = `${accuracy}%`;

    if (accuracy >= 70) {
      window.soundController.playVictory();
      if (typeof confetti === 'function') {
        confetti({ particleCount: 120, spread: 70, origin: { y: 0.6 } });
      }
    }

    const revContainer = document.getElementById('reviewItemsContainer');
    revContainer.innerHTML = '';
    state.solo.userAnswers.forEach((ans, idx) => {
      const item = document.createElement('div');
      item.className = `review-item ${ans.isCorrect ? 'correct' : 'wrong'}`;
      const userChoiceText = ans.selectedIndex !== null ? ans.options[ans.selectedIndex] : 'Немає відповіді (час вийшов)';
      const correctChoiceText = ans.options[ans.correctIndex];

      item.innerHTML = `
        <div class="review-q">${idx + 1}. ${ans.question}</div>
        <div class="review-ans">Ваша відповідь: <strong>${userChoiceText}</strong> ${ans.isCorrect ? '✅' : '❌'}</div>
        ${!ans.isCorrect ? `<div class="review-ans" style="color: var(--success); margin-top: 0.2rem;">Правильна відповідь: <strong>${correctChoiceText}</strong></div>` : ''}
        ${ans.explanation ? `<div class="review-ans" style="margin-top: 0.3rem; font-style: italic;">💡 ${ans.explanation}</div>` : ''}
      `;
      revContainer.appendChild(item);
    });
  }

  document.getElementById('btnPlayAgain').addEventListener('click', () => {
    window.soundController.playClick();
    if (state.multi.room && state.multi.isHost) {
      hostResetRoomForNewGame();
    } else {
      showScreen('screenSoloSetup');
    }
  });

  document.getElementById('btnResultsBackHome').addEventListener('click', () => {
    window.soundController.playClick();
    leaveCurrentLobby();
    showScreen('screenHome');
  });

  // -------------------------------------------------------------
  // REAL MULTIPLAYER VIA PEERJS (WebRTC P2P)
  // -------------------------------------------------------------
  const btnOpenCreateLobbyModal = document.getElementById('btnOpenCreateLobbyModal');
  const btnOpenCreateLobbyFromList = document.getElementById('btnOpenCreateLobbyFromList');
  const btnCloseCreateLobbyModal = document.getElementById('btnCloseCreateLobbyModal');
  const btnCancelCreateLobby = document.getElementById('btnCancelCreateLobby');

  function openCreateLobby() {
    modalCreateLobby.style.display = 'flex';
    document.getElementById('inputLobbyName').value = `Лобі гравця ${state.user.name}`;
    window.soundController.playClick();
  }

  btnOpenCreateLobbyModal.addEventListener('click', openCreateLobby);
  btnOpenCreateLobbyFromList.addEventListener('click', openCreateLobby);
  btnCloseCreateLobbyModal.addEventListener('click', () => modalCreateLobby.style.display = 'none');
  btnCancelCreateLobby.addEventListener('click', () => modalCreateLobby.style.display = 'none');

  let lobbyQuestionCount = 10;
  document.querySelectorAll('#lobbyCountSelectors .chip-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#lobbyCountSelectors .chip-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      lobbyQuestionCount = Number(btn.getAttribute('data-count'));
      window.soundController.playClick();
    });
  });

  // Form Create Lobby
  document.getElementById('formCreateLobby').addEventListener('submit', (e) => {
    e.preventDefault();
    const roomName = document.getElementById('inputLobbyName').value.trim();
    const timePerQuestion = Number(document.getElementById('selectLobbyTime').value);
    const maxPlayers = Number(document.getElementById('selectLobbyMaxPlayers').value);
    const isPrivate = document.getElementById('checkLobbyPrivate').checked;

    modalCreateLobby.style.display = 'none';
    window.soundController.playClick();

    hostCreateRoom({
      name: roomName,
      questionCount: lobbyQuestionCount,
      timePerQuestion,
      maxPlayers,
      isPrivate
    });
  });

  function hostCreateRoom(opts) {
    leaveCurrentLobby();
    showToast('Створення кімнати...', 'info');

    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const roomCode = `Q-${randomSuffix}`;
    const peerRoomId = `quizarena-${roomCode.toLowerCase()}`;

    // Initialize PeerJS Host
    const peer = new Peer(peerRoomId, {
      debug: 1
    });

    state.multi.peer = peer;
    state.multi.isHost = true;

    peer.on('open', (id) => {
      console.log('👑 Peer Host open with ID:', id);
      state.multi.peerId = id;

      const room = {
        code: roomCode,
        peerId: id,
        name: opts.name || `Лобі гравця ${state.user.name}`,
        hostId: state.user.id,
        hostName: state.user.name,
        questionCount: opts.questionCount || 10,
        timePerQuestion: opts.timePerQuestion || 15,
        maxPlayers: opts.maxPlayers || 8,
        isPrivate: opts.isPrivate,
        status: 'waiting',
        players: {
          [state.user.id]: {
            id: state.user.id,
            peerId: id,
            name: state.user.name,
            avatar: state.user.avatar,
            isHost: true,
            isReady: true,
            score: 0,
            streak: 0,
            correctCount: 0
          }
        },
        questions: [],
        currentQuestionIndex: 0,
        answers: {}
      };

      state.multi.room = room;
      renderWaitingRoom();
      showScreen('screenLobbyRoom');
      showToast(`Лобі ${roomCode} створено! Поділіться кодом з друзями`, 'success');

      // Publish lobby announcement
      announceLobby();
    });

    // Handle Incoming Guest Connections
    peer.on('connection', (conn) => {
      conn.on('open', () => {
        console.log('👋 Guest connected via WebRTC:', conn.peer);
      });

      conn.on('data', (data) => {
        handleHostReceivedData(conn, data);
      });

      conn.on('close', () => {
        console.log('🚪 Guest disconnected:', conn.peer);
        removeGuestByConn(conn);
      });

      conn.on('error', (err) => {
        console.error('Guest conn error:', err);
      });
    });

    peer.on('error', (err) => {
      console.error('Peer error:', err);
      if (err.type === 'unavailable-id') {
        showToast('Кімната з таким кодом вже зайнята, генеруємо новий код...', 'error');
        hostCreateRoom(opts);
      } else {
        showToast('Помилка P2P з\'єднання: ' + err.message, 'error');
      }
    });
  }

  function handleHostReceivedData(conn, data) {
    const room = state.multi.room;
    if (!room) return;

    if (data.type === 'JOIN_REQUEST') {
      if (room.status !== 'waiting') {
        conn.send({ type: 'JOIN_ERROR', message: 'Гра в цьому лобі вже розпочалася!' });
        return;
      }
      if (Object.keys(room.players).length >= room.maxPlayers) {
        conn.send({ type: 'JOIN_ERROR', message: 'Лобі заповнене!' });
        return;
      }

      const guestPlayer = {
        id: data.player.id,
        peerId: conn.peer,
        name: data.player.name,
        avatar: data.player.avatar,
        isHost: false,
        isReady: false,
        score: 0,
        streak: 0,
        correctCount: 0
      };

      state.multi.guestConns.set(conn.peer, conn);
      room.players[guestPlayer.id] = guestPlayer;

      // Send confirmation to guest with current room state
      conn.send({
        type: 'JOIN_SUCCESS',
        room: room,
        yourId: guestPlayer.id
      });

      // Broadcast updated room to all
      broadcastToRoom({
        type: 'ROOM_UPDATED',
        room: room
      });

      // Broadcast chat alert
      broadcastToRoom({
        type: 'CHAT_MSG',
        sender: 'Система',
        avatar: '👋',
        text: `Гравець ${guestPlayer.name} приєднався до кімнати!`,
        time: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })
      });

      renderWaitingRoom();
      announceLobby();
    }

    if (data.type === 'TOGGLE_READY') {
      const p = room.players[data.playerId];
      if (p) {
        p.isReady = !p.isReady;
        broadcastToRoom({ type: 'ROOM_UPDATED', room: room });
        renderWaitingRoom();
      }
    }

    if (data.type === 'UPDATE_PROFILE') {
      const p = Object.values(room.players).find(pl => pl.peerId === conn.peer);
      if (p) {
        p.name = data.name;
        p.avatar = data.avatar;
        broadcastToRoom({ type: 'ROOM_UPDATED', room: room });
        renderWaitingRoom();
      }
    }

    if (data.type === 'CHAT_MSG') {
      broadcastToRoom({
        type: 'CHAT_MSG',
        sender: data.sender,
        avatar: data.avatar,
        text: data.text,
        time: data.time
      });
    }

    if (data.type === 'SUBMIT_ANSWER') {
      if (room.status !== 'playing') return;
      if (room.currentQuestionIndex !== data.questionIndex) return;
      if (room.answers[data.playerId]) return; // already answered

      const currentQ = room.questions[room.currentQuestionIndex];
      const isCorrect = data.selectedOption === currentQ.correctIndex;
      const player = room.players[data.playerId];

      let points = 0;
      if (player) {
        if (isCorrect) {
          player.streak++;
          player.correctCount++;
          const timeBonus = Math.round((data.timeRemaining / room.timePerQuestion) * 50);
          const streakBonus = Math.min(player.streak * 10, 50);
          points = 100 + timeBonus + streakBonus;
          player.score += points;
        } else {
          player.streak = 0;
        }
      }

      room.answers[data.playerId] = {
        optionIndex: data.selectedOption,
        isCorrect,
        points
      };

      // Broadcast answer notification count
      broadcastToRoom({
        type: 'PLAYER_ANSWERED_UPDATE',
        answeredCount: Object.keys(room.answers).length,
        totalPlayers: Object.keys(room.players).length
      });

      // If all answered early, finish round
      if (Object.keys(room.answers).length >= Object.keys(room.players).length) {
        hostFinishRound();
      }
    }
  }

  function removeGuestByConn(conn) {
    const room = state.multi.room;
    if (!room) return;

    state.multi.guestConns.delete(conn.peer);
    let removedPlayer = null;

    Object.keys(room.players).forEach(pid => {
      if (room.players[pid].peerId === conn.peer) {
        removedPlayer = room.players[pid];
        delete room.players[pid];
      }
    });

    if (removedPlayer) {
      showToast(`Гравець ${removedPlayer.name} покинув кімнату`, 'info');
      broadcastToRoom({
        type: 'ROOM_UPDATED',
        room: room
      });
      broadcastToRoom({
        type: 'CHAT_MSG',
        sender: 'Система',
        avatar: '🚪',
        text: `Гравець ${removedPlayer.name} вийшов з лобі`,
        time: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })
      });
      renderWaitingRoom();
      announceLobby();
    }
  }

  function broadcastToRoom(msg) {
    // Send to all guests
    state.multi.guestConns.forEach(conn => {
      if (conn.open) {
        conn.send(msg);
      }
    });

    // Handle locally on host
    handleClientReceivedData(msg);
  }

  // Guest: Join Lobby by Code
  function joinLobbyByCode(code) {
    leaveCurrentLobby();
    const cleanCode = code.trim().toUpperCase();
    const peerHostId = `quizarena-${cleanCode.toLowerCase()}`;

    showToast(`Підключення до кімнати ${cleanCode}...`, 'info');

    const peer = new Peer(undefined, { debug: 1 });
    state.multi.peer = peer;
    state.multi.isHost = false;

    peer.on('open', (myPeerId) => {
      console.log('👤 Guest Peer open:', myPeerId);
      state.multi.peerId = myPeerId;

      const conn = peer.connect(peerHostId, {
        reliable: true
      });

      state.multi.hostConn = conn;

      conn.on('open', () => {
        console.log('✅ Connected to Host! Sending join request...');
        conn.send({
          type: 'JOIN_REQUEST',
          player: {
            id: state.user.id,
            name: state.user.name,
            avatar: state.user.avatar
          }
        });
      });

      conn.on('data', (data) => {
        handleClientReceivedData(data);
      });

      conn.on('close', () => {
        showToast('З\'єднання з хостом втрачено', 'error');
        leaveCurrentLobby();
        showScreen('screenLobbies');
      });

      conn.on('error', (err) => {
        showToast('Помилка з\'єднання: ' + err.message, 'error');
      });
    });

    peer.on('error', (err) => {
      console.error('Peer error:', err);
      showToast('Не вдалося знайти кімнату з таким кодом!', 'error');
    });
  }

  // Client Handler for all broadcast messages (used by both host and guests)
  function handleClientReceivedData(data) {
    if (data.type === 'JOIN_SUCCESS') {
      state.multi.room = data.room;
      state.multi.isHost = false;
      renderWaitingRoom();
      showScreen('screenLobbyRoom');
      showToast('Ви успішно приєдналися до кімнати!', 'success');
    }

    if (data.type === 'JOIN_ERROR') {
      showToast(data.message || 'Не вдалося увійти в кімнату', 'error');
      leaveCurrentLobby();
      showScreen('screenLobbies');
    }

    if (data.type === 'ROOM_UPDATED') {
      state.multi.room = data.room;
      renderWaitingRoom();
    }

    if (data.type === 'CHAT_MSG') {
      addChatMessage(data);
    }

    if (data.type === 'START_COUNTDOWN') {
      countdownOverlay.style.display = 'flex';
      countdownNum.textContent = data.count > 0 ? data.count : 'GO!';
      if (data.count > 0) {
        window.soundController.playCountdownTick();
      } else {
        window.soundController.playStartBeep();
      }
    }

    if (data.type === 'GAME_STARTED') {
      countdownOverlay.style.display = 'none';
      showScreen('screenGame');
      document.getElementById('soloNextBtnContainer').style.display = 'none';
      document.getElementById('gameLiveIndicator').style.display = 'flex';
      state.multi.hasAnsweredCurrent = false;
    }

    if (data.type === 'NEW_QUESTION') {
      state.multi.currentQuestionIndex = data.questionIndex;
      state.multi.hasAnsweredCurrent = false;
      document.getElementById('gameExplanationBox').style.display = 'none';

      document.getElementById('gameCategoryBadge').textContent = data.categoryName || 'Логіка';
      document.getElementById('gameCurrentQNum').textContent = data.questionIndex + 1;
      document.getElementById('gameTotalQNum').textContent = data.totalQuestions;
      document.getElementById('gameQuestionText').textContent = data.question;
      document.getElementById('gameAnsweredStatusText').textContent = `Відповіло: 0 / ${Object.keys(state.multi.room?.players || {}).length}`;

      const optContainer = document.getElementById('gameOptionsContainer');
      optContainer.innerHTML = '';
      const letters = ['A', 'B', 'C', 'D'];

      data.options.forEach((optText, optIdx) => {
        const btn = document.createElement('button');
        btn.className = 'option-btn';
        btn.innerHTML = `
          <span class="opt-letter">${letters[optIdx]}</span>
          <span>${optText}</span>
        `;
        btn.addEventListener('click', () => {
          handleMultiplayerAnswer(optIdx, btn, data.questionIndex);
        });
        optContainer.appendChild(btn);
      });

      // Synchronize Timer Bar
      if (state.multi.timerInterval) clearInterval(state.multi.timerInterval);
      const timerBar = document.getElementById('gameTimerBar');
      timerBar.style.width = '100%';
      timerBar.style.background = 'linear-gradient(90deg, var(--primary), var(--secondary))';

      const totalTime = data.timeLimit;
      const stepMs = 100;
      let elapsed = 0;
      state.multi.timeRemaining = totalTime;

      state.multi.timerInterval = setInterval(() => {
        elapsed += stepMs;
        const remaining = Math.max(0, totalTime - elapsed / 1000);
        state.multi.timeRemaining = remaining;

        const pct = (remaining / totalTime) * 100;
        timerBar.style.width = `${pct}%`;

        if (pct < 30) {
          timerBar.style.background = 'var(--danger)';
        }

        if (remaining <= 0) {
          clearInterval(state.multi.timerInterval);
        }
      }, stepMs);
    }

    if (data.type === 'PLAYER_ANSWERED_UPDATE') {
      document.getElementById('gameAnsweredStatusText').textContent = `Відповіло: ${data.answeredCount} / ${data.totalPlayers}`;
    }

    if (data.type === 'QUESTION_RESULT') {
      if (state.multi.timerInterval) clearInterval(state.multi.timerInterval);

      const allBtns = document.querySelectorAll('#gameOptionsContainer .option-btn');
      allBtns.forEach((b, idx) => {
        b.disabled = true;
        if (idx === data.correctIndex) {
          b.classList.add('correct');
        }
      });

      if (data.explanation) {
        document.getElementById('gameExplanationText').textContent = data.explanation;
        document.getElementById('gameExplanationBox').style.display = 'block';
      }

      // Update current user score badge
      const myResult = data.leaderboard.find(p => p.id === state.user.id);
      if (myResult) {
        document.getElementById('gameScoreBadge').textContent = `🏆 ${myResult.currentScore} очок`;
        if (myResult.isCorrect) {
          window.soundController.playCorrect();
        } else {
          window.soundController.playIncorrect();
        }
      }
    }

    if (data.type === 'GAME_OVER') {
      showScreen('screenResults');
      document.getElementById('multiplayerPodium').style.display = 'flex';
      document.getElementById('scoreBadgeCircle').style.display = 'none';

      const leaderboard = data.leaderboard || [];
      const myRankIdx = leaderboard.findIndex(p => p.id === state.user.id);
      const myStats = leaderboard[myRankIdx] || { score: 0, correctCount: 0, accuracy: 0 };

      document.getElementById('resultsTitle').textContent = myRankIdx === 0 ? '👑 Ви перемогли в лобі!' : '🏁 Гра завершена!';
      document.getElementById('resultsSubtitle').textContent = `Ваше місце в таблиці: #${myRankIdx + 1}`;

      if (leaderboard[0]) {
        document.getElementById('podium1').style.display = 'flex';
        document.getElementById('podium1Name').textContent = `${leaderboard[0].avatar} ${leaderboard[0].name} (${leaderboard[0].score})`;
      } else {
        document.getElementById('podium1').style.display = 'none';
      }

      if (leaderboard[1]) {
        document.getElementById('podium2').style.display = 'flex';
        document.getElementById('podium2Name').textContent = `${leaderboard[1].avatar} ${leaderboard[1].name} (${leaderboard[1].score})`;
      } else {
        document.getElementById('podium2').style.display = 'none';
      }

      if (leaderboard[2]) {
        document.getElementById('podium3').style.display = 'flex';
        document.getElementById('podium3Name').textContent = `${leaderboard[2].avatar} ${leaderboard[2].name} (${leaderboard[2].score})`;
      } else {
        document.getElementById('podium3').style.display = 'none';
      }

      document.getElementById('resTotalScore').textContent = myStats.score;
      document.getElementById('resCorrectCount').textContent = `${myStats.correctCount} / ${data.questionCount}`;
      document.getElementById('resAccuracy').textContent = `${myStats.accuracy}%`;

      window.soundController.playVictory();
      if (typeof confetti === 'function') {
        confetti({ particleCount: 150, spread: 80, origin: { y: 0.5 } });
      }

      const revContainer = document.getElementById('reviewItemsContainer');
      revContainer.innerHTML = '<h4>🏆 Турнірна таблиця лобі:</h4>';
      leaderboard.forEach((p, idx) => {
        const row = document.createElement('div');
        row.className = 'review-item';
        row.style.display = 'flex';
        row.style.justifyContent = 'space-between';
        row.style.alignItems = 'center';
        row.innerHTML = `
          <div>
            <strong>#${idx + 1} ${p.avatar} ${p.name} ${p.id === state.user.id ? '(Ви)' : ''}</strong>
            <div style="font-size: 0.8rem; color: var(--text-muted);">Точність: ${p.accuracy}% (${p.correctCount}/${data.questionCount})</div>
          </div>
          <div style="font-size: 1.2rem; font-weight: 800; color: var(--primary);">${p.score} очок</div>
        `;
        revContainer.appendChild(row);
      });

      const btnPlayAgain = document.getElementById('btnPlayAgain');
      if (state.multi.isHost) {
        btnPlayAgain.textContent = '🔄 Грати ще раз (Лобі)';
        btnPlayAgain.style.display = 'inline-flex';
      } else {
        btnPlayAgain.style.display = 'none';
      }
    }

    if (data.type === 'ROOM_RESET') {
      state.multi.room = data.room;
      renderWaitingRoom();
      showScreen('screenLobbyRoom');
      showToast('Хост повернув усіх до лобі!', 'info');
    }
  }

  function handleMultiplayerAnswer(selectedIdx, btnElement, qIndex) {
    if (state.multi.hasAnsweredCurrent) return;
    state.multi.hasAnsweredCurrent = true;

    btnElement.classList.add('selected');
    const allBtns = document.querySelectorAll('#gameOptionsContainer .option-btn');
    allBtns.forEach(b => {
      if (b !== btnElement) b.disabled = true;
    });

    const answerPayload = {
      type: 'SUBMIT_ANSWER',
      playerId: state.user.id,
      questionIndex: qIndex,
      selectedOption: selectedIdx,
      timeRemaining: state.multi.timeRemaining
    };

    if (state.multi.isHost) {
      handleHostReceivedData(null, answerPayload);
    } else if (state.multi.hostConn) {
      state.multi.hostConn.send(answerPayload);
    }

    showToast('Відповідь зафіксовано! Очікуємо завершення раунду...', 'info');
  }

  // Host: Start Multiplayer Game
  document.getElementById('btnHostStartGame').addEventListener('click', () => {
    window.soundController.playClick();
    const room = state.multi.room;
    if (!room || !state.multi.isHost) return;

    const pool = window.QUIZ_QUESTIONS || [];
    room.questions = shuffle(pool).slice(0, Math.min(room.questionCount, pool.length));
    room.status = 'playing';
    room.currentQuestionIndex = 0;
    room.answers = {};

    Object.values(room.players).forEach(p => {
      p.score = 0;
      p.streak = 0;
      p.correctCount = 0;
    });

    // Start 3-second countdown
    let countdown = 3;
    broadcastToRoom({ type: 'START_COUNTDOWN', count: countdown });

    const cInterval = setInterval(() => {
      countdown--;
      if (countdown >= 0) {
        broadcastToRoom({ type: 'START_COUNTDOWN', count: countdown });
      } else {
        clearInterval(cInterval);
        broadcastToRoom({
          type: 'GAME_STARTED',
          totalQuestions: room.questions.length,
          timePerQuestion: room.timePerQuestion
        });
        hostSendNextQuestion();
      }
    }, 1000);

    announceLobby();
  });

  function hostSendNextQuestion() {
    const room = state.multi.room;
    if (!room || room.status !== 'playing') return;

    const currentQ = room.questions[room.currentQuestionIndex];
    if (!currentQ) {
      hostFinishGame();
      return;
    }

    room.answers = {};

    broadcastToRoom({
      type: 'NEW_QUESTION',
      questionIndex: room.currentQuestionIndex,
      totalQuestions: room.questions.length,
      question: currentQ.question,
      options: currentQ.options,
      categoryName: currentQ.categoryName || 'Логіка',
      timeLimit: room.timePerQuestion
    });

    if (state.multi.roundTimeout) clearTimeout(state.multi.roundTimeout);
    state.multi.roundTimeout = setTimeout(() => {
      hostFinishRound();
    }, (room.timePerQuestion + 0.5) * 1000);
  }

  function hostFinishRound() {
    const room = state.multi.room;
    if (!room || room.status !== 'playing') return;
    if (state.multi.roundTimeout) clearTimeout(state.multi.roundTimeout);

    const currentQ = room.questions[room.currentQuestionIndex];
    const roundResults = Object.values(room.players).map(p => {
      const ans = room.answers[p.id];
      return {
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        isCorrect: ans ? ans.isCorrect : false,
        pointsEarned: ans ? ans.points : 0,
        currentScore: p.score,
        streak: p.streak
      };
    }).sort((a, b) => b.currentScore - a.currentScore);

    broadcastToRoom({
      type: 'QUESTION_RESULT',
      questionIndex: room.currentQuestionIndex,
      correctIndex: currentQ.correctIndex,
      explanation: currentQ.explanation,
      leaderboard: roundResults
    });

    setTimeout(() => {
      if (!state.multi.room || state.multi.room.status !== 'playing') return;
      state.multi.room.currentQuestionIndex++;
      if (state.multi.room.currentQuestionIndex < state.multi.room.questions.length) {
        hostSendNextQuestion();
      } else {
        hostFinishGame();
      }
    }, 4500);
  }

  function hostFinishGame() {
    const room = state.multi.room;
    if (!room) return;
    room.status = 'ended';

    const finalLeaderboard = Object.values(room.players).map(p => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      score: p.score,
      correctCount: p.correctCount,
      accuracy: Math.round((p.correctCount / (room.questions.length || 1)) * 100)
    })).sort((a, b) => b.score - a.score);

    broadcastToRoom({
      type: 'GAME_OVER',
      leaderboard: finalLeaderboard,
      questionCount: room.questions.length
    });

    announceLobby();
  }

  function hostResetRoomForNewGame() {
    const room = state.multi.room;
    if (!room) return;

    room.status = 'waiting';
    room.currentQuestionIndex = 0;
    room.answers = {};
    Object.values(room.players).forEach(p => {
      p.score = 0;
      p.streak = 0;
      p.correctCount = 0;
      p.isReady = p.isHost;
    });

    broadcastToRoom({
      type: 'ROOM_RESET',
      room: room
    });

    announceLobby();
  }

  // Toggle ready status
  document.getElementById('btnToggleReady').addEventListener('click', () => {
    window.soundController.playClick();
    if (state.multi.hostConn) {
      state.multi.hostConn.send({
        type: 'TOGGLE_READY',
        playerId: state.user.id
      });
    }
  });

  // Room Chat
  document.getElementById('formRoomChat').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('inputChatMsg');
    const text = input.value.trim();
    if (!text) return;

    const chatPayload = {
      type: 'CHAT_MSG',
      sender: state.user.name,
      avatar: state.user.avatar,
      text,
      time: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })
    };

    if (state.multi.isHost) {
      broadcastToRoom(chatPayload);
    } else if (state.multi.hostConn) {
      state.multi.hostConn.send(chatPayload);
    }

    input.value = '';
  });

  function addChatMessage(msg) {
    const box = document.getElementById('chatMessagesBox');
    const item = document.createElement('div');
    item.className = 'chat-msg-item';
    item.innerHTML = `
      <span class="chat-msg-sender">${msg.avatar} ${msg.sender}:</span>
      <span>${msg.text}</span>
      <span class="chat-msg-time">${msg.time}</span>
    `;
    box.appendChild(item);
    box.scrollTop = box.scrollHeight;
  }

  function renderWaitingRoom() {
    const room = state.multi.room;
    if (!room) return;

    document.getElementById('roomTitleText').textContent = room.name;
    document.getElementById('roomCategoryText').textContent = 'Логічні загадки';
    document.getElementById('roomQuestionCountText').textContent = `${room.questionCount} питань`;
    document.getElementById('roomTimeText').textContent = `${room.timePerQuestion}с`;
    document.getElementById('roomCodeDisplay').textContent = room.code;

    const playersArr = Object.values(room.players || {});
    document.getElementById('roomPlayerCount').textContent = playersArr.length;
    document.getElementById('roomMaxPlayers').textContent = room.maxPlayers;

    const playersList = document.getElementById('roomPlayersList');
    playersList.innerHTML = '';

    playersArr.forEach(p => {
      const isMe = (p.id === state.user.id);
      const card = document.createElement('div');
      card.className = `player-slot-card ${p.isReady ? 'is-ready' : ''}`;
      card.innerHTML = `
        ${p.isHost ? '<span class="host-badge">👑 ХОСТ</span>' : ''}
        <div class="avatar-big">${p.avatar}</div>
        <div class="p-name">${p.name} ${isMe ? '(Ви)' : ''}</div>
        <div class="ready-status ${p.isReady ? 'ready' : 'not-ready'}">
          ${p.isHost ? 'Готовий до старту' : p.isReady ? '✅ Готовий' : '⏳ Не готовий'}
        </div>
      `;
      playersList.appendChild(card);
    });

    const isHost = state.multi.isHost;
    const btnHostStartGame = document.getElementById('btnHostStartGame');
    const btnToggleReady = document.getElementById('btnToggleReady');

    if (isHost) {
      btnHostStartGame.style.display = 'inline-flex';
      btnToggleReady.style.display = 'none';
    } else {
      btnHostStartGame.style.display = 'none';
      btnToggleReady.style.display = 'inline-flex';
      const myPlayer = room.players[state.user.id];
      if (myPlayer && myPlayer.isReady) {
        document.getElementById('readyBtnIcon').textContent = '✅';
        document.getElementById('readyBtnText').textContent = 'Готовий!';
        btnToggleReady.className = 'btn btn-success';
      } else {
        document.getElementById('readyBtnIcon').textContent = '⏳';
        document.getElementById('readyBtnText').textContent = 'Я готовий';
        btnToggleReady.className = 'btn btn-secondary';
      }
    }
  }

  function leaveCurrentLobby() {
    if (state.multi.isHost) {
      broadcastToRoom({
        type: 'CHAT_MSG',
        sender: 'Система',
        avatar: '⚠️',
        text: 'Хост закрив лобі',
        time: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })
      });
      unannounceLobby();
    }

    if (state.multi.hostConn) {
      state.multi.hostConn.close();
      state.multi.hostConn = null;
    }

    state.multi.guestConns.forEach(c => c.close());
    state.multi.guestConns.clear();

    if (state.multi.peer) {
      state.multi.peer.destroy();
      state.multi.peer = null;
    }

    state.multi.room = null;
    state.multi.isHost = false;
  }

  document.getElementById('btnLeaveLobby').addEventListener('click', () => {
    window.soundController.playClick();
    leaveCurrentLobby();
    showScreen('screenLobbies');
    refreshPublicLobbies();
  });

  document.getElementById('btnCopyRoomCode').addEventListener('click', () => {
    if (state.multi.room) {
      const inviteUrl = `${window.location.origin}${window.location.pathname}?join=${state.multi.room.code}`;
      navigator.clipboard.writeText(inviteUrl);
      showToast(`Посилання для запрошення скопійовано!`, 'success');
      window.soundController.playClick();
    }
  });

  // -------------------------------------------------------------
  // LOBBY DISCOVERY & ANNOUNCEMENTS (BROADCASTCHANNEL & STORAGE)
  // -------------------------------------------------------------
  function announceLobby() {
    const room = state.multi.room;
    if (!room || !state.multi.isHost || room.isPrivate) return;

    const lobbyInfo = {
      code: room.code,
      name: room.name,
      hostName: room.hostName,
      playerCount: Object.keys(room.players).length,
      maxPlayers: room.maxPlayers,
      questionCount: room.questionCount,
      timePerQuestion: room.timePerQuestion,
      status: room.status,
      timestamp: Date.now()
    };

    if (broadcast) {
      broadcast.postMessage({ type: 'LOBBY_ANNOUNCE', lobby: lobbyInfo });
    }

    // Also store in localStorage active lobbies cache
    try {
      const lobbies = JSON.parse(localStorage.getItem('qa_active_lobbies') || '{}');
      lobbies[room.code] = lobbyInfo;
      localStorage.setItem('qa_active_lobbies', JSON.stringify(lobbies));
    } catch (e) {}
  }

  function unannounceLobby() {
    const room = state.multi.room;
    if (!room) return;

    if (broadcast) {
      broadcast.postMessage({ type: 'LOBBY_REMOVED', code: room.code });
    }

    try {
      const lobbies = JSON.parse(localStorage.getItem('qa_active_lobbies') || '{}');
      delete lobbies[room.code];
      localStorage.setItem('qa_active_lobbies', JSON.stringify(lobbies));
    } catch (e) {}
  }

  function handleBroadcastMessage(data) {
    if (data.type === 'LOBBY_ANNOUNCE') {
      const existsIdx = state.multi.publicLobbies.findIndex(l => l.code === data.lobby.code);
      if (existsIdx >= 0) {
        state.multi.publicLobbies[existsIdx] = data.lobby;
      } else {
        state.multi.publicLobbies.push(data.lobby);
      }
      if (state.currentView === 'screenLobbies') {
        renderLobbiesList(state.multi.publicLobbies);
      }
    }

    if (data.type === 'LOBBY_REMOVED') {
      state.multi.publicLobbies = state.multi.publicLobbies.filter(l => l.code !== data.code);
      if (state.currentView === 'screenLobbies') {
        renderLobbiesList(state.multi.publicLobbies);
      }
    }
  }

  document.getElementById('btnRefreshLobbies').addEventListener('click', () => {
    window.soundController.playClick();
    refreshPublicLobbies();
  });

  function refreshPublicLobbies() {
    let list = [];
    try {
      const stored = JSON.parse(localStorage.getItem('qa_active_lobbies') || '{}');
      const now = Date.now();
      Object.values(stored).forEach(l => {
        // Keep active within 5 minutes
        if (now - l.timestamp < 5 * 60 * 1000) {
          list.push(l);
        }
      });
    } catch (e) {}

    state.multi.publicLobbies = list;
    renderLobbiesList(list);
  }

  document.getElementById('inputLobbySearch').addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    const filtered = state.multi.publicLobbies.filter(l => 
      l.name.toLowerCase().includes(query) || 
      l.hostName.toLowerCase().includes(query) ||
      l.code.toLowerCase().includes(query)
    );
    renderLobbiesList(filtered);
  });

  function renderLobbiesList(list) {
    const container = document.getElementById('lobbiesContainer');
    container.innerHTML = '';

    if (!list || list.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 3rem; background: var(--bg-card); border: 1px dashed var(--border); border-radius: var(--radius);">
          <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">👥</div>
          <h3>Поки немає відкритих кімнат</h3>
          <p style="color: var(--text-muted); margin: 0.5rem 0 1.25rem;">Створіть нове лобі та запросіть друзів за кодом або посиланням!</p>
          <button class="btn btn-primary" onclick="document.getElementById('btnOpenCreateLobbyModal').click()">➕ Створити кімнату</button>
        </div>
      `;
      return;
    }

    list.forEach(lobby => {
      const card = document.createElement('div');
      card.className = 'lobby-item-card';
      const isFull = lobby.playerCount >= lobby.maxPlayers;
      const isPlaying = lobby.status === 'playing';

      card.innerHTML = `
        <div class="lobby-card-header">
          <span class="lobby-code-badge">${lobby.code}</span>
          <span class="lobby-status-tag ${isPlaying ? 'playing' : 'waiting'}">
            ${isPlaying ? '🎮 В грі' : '🟢 Очікування'}
          </span>
        </div>
        <div class="lobby-name-txt">${lobby.name}</div>
        <div class="lobby-meta-row">
          <span>👑 Хост: <strong>${lobby.hostName}</strong></span>
          <span>👥 Реальні гравці: <strong>${lobby.playerCount}/${lobby.maxPlayers}</strong></span>
          <span>❓ ${lobby.questionCount} пит.</span>
          <span>⏱️ ${lobby.timePerQuestion}с</span>
        </div>
        <div style="margin-top: 0.5rem;">
          <button class="btn ${isFull || isPlaying ? 'btn-secondary' : 'btn-primary'}" style="width: 100%;" ${isFull || isPlaying ? 'disabled' : ''}>
            ${isPlaying ? 'Гра триває' : isFull ? 'Лобі повне' : '🚀 Приєднатися'}
          </button>
        </div>
      `;

      if (!isFull && !isPlaying) {
        card.querySelector('button').addEventListener('click', () => {
          joinLobbyByCode(lobby.code);
        });
      }

      container.appendChild(card);
    });
  }

  // -------------------------------------------------------------
  // AUTO-JOIN VIA URL QUERY PARAMETER (?join=Q-XXXX)
  // -------------------------------------------------------------
  const urlParams = new URLSearchParams(window.location.search);
  const joinParam = urlParams.get('join');
  if (joinParam) {
    setTimeout(() => {
      joinLobbyByCode(joinParam);
    }, 500);
  }

  // Init
  initUser();
  refreshPublicLobbies();
});
