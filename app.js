// QuizArena - 100% Reliable Multiplayer via Fast Global WebSockets (MQTT)
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
      difficulty: 'all',
      questions: [],
      currentIndex: 0,
      score: 0,
      streak: 0,
      correctCount: 0,
      userAnswers: [],
      timerInterval: null,
      timeRemaining: 15
    },

    // Multiplayer State (Rock-solid WebSockets over MQTT)
    multi: {
      isHost: false,
      currentRoomCode: null,
      roomTopic: null,
      room: null,
      myQuestions: [],
      currentIndex: 0,
      score: 0,
      streak: 0,
      correctCount: 0,
      userAnswers: [],
      timeRemaining: 15,
      timerInterval: null,
      isFinished: false,
      publicLobbies: new Map(),
      announceInterval: null,
      playerHeartbeatInterval: null,
      lastHostSeen: 0,
      joinTimeout: null
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

  // -------------------------------------------------------------
  // GLOBAL WEBSOCKET MQTT BROKER (100% Guaranteed Connection)
  // -------------------------------------------------------------
  let mqttClient = null;
  const PRESENCE_TOPIC = 'quizarena/ua/lobbies/presence_v2';
  const ROOM_TOPIC_PREFIX = 'quizarena/ua/rooms_v2/';

  const localBroadcast = window.BroadcastChannel ? new BroadcastChannel('quiz_arena_local_broadcast') : null;
  if (localBroadcast) {
    localBroadcast.onmessage = (e) => {
      const msg = e.data;
      if (msg.channel === 'presence') {
        handlePresenceMessage(msg.data);
      } else if (msg.channel === 'room' && state.multi.currentRoomCode === msg.roomCode) {
        handleRoomMessage(msg.data);
      }
    };
  }

  function initMqtt() {
    const brokerUrls = [
      'wss://broker.emqx.io:8084/mqtt',
      'wss://broker.hivemq.com:8884/mqtt'
    ];
    let brokerIdx = 0;

    function connectBroker() {
      try {
        if (typeof mqtt === 'undefined') {
          console.warn('MQTT script not loaded yet, retrying in 500ms...');
          setTimeout(connectBroker, 500);
          return;
        }

        mqttClient = mqtt.connect(brokerUrls[brokerIdx], {
          clientId: 'qa_' + state.user.id + '_' + Math.random().toString(36).substr(2, 5),
          clean: true,
          connectTimeout: 8000,
          reconnectPeriod: 4000
        });

        mqttClient.on('connect', () => {
          console.log('⚡ Connected to Real-time WebSockets Broker:', brokerUrls[brokerIdx]);
          mqttClient.subscribe(PRESENCE_TOPIC);
          if (state.multi.roomTopic) {
            mqttClient.subscribe(state.multi.roomTopic);
          }
        });

        mqttClient.on('message', (topic, payload) => {
          try {
            const data = JSON.parse(payload.toString());
            if (topic === PRESENCE_TOPIC) {
              handlePresenceMessage(data);
            } else if (topic.startsWith(ROOM_TOPIC_PREFIX)) {
              handleRoomMessage(data);
            }
          } catch (e) {
            console.error('MQTT parse error:', e);
          }
        });

        mqttClient.on('error', (err) => {
          console.warn('MQTT Error on', brokerUrls[brokerIdx], err);
          brokerIdx = (brokerIdx + 1) % brokerUrls.length;
        });
      } catch (e) {
        console.error('MQTT Connect exception:', e);
      }
    }

    connectBroker();
  }

  function publishRoomMessage(data) {
    if (!state.multi.currentRoomCode) return;
    const topic = ROOM_TOPIC_PREFIX + state.multi.currentRoomCode;
    const payload = JSON.stringify(data);

    if (mqttClient && mqttClient.connected) {
      mqttClient.publish(topic, payload);
    }
    if (localBroadcast) {
      localBroadcast.postMessage({ channel: 'room', roomCode: state.multi.currentRoomCode, data });
    }
  }

  function publishPresenceMessage(data) {
    const payload = JSON.stringify(data);
    if (mqttClient && mqttClient.connected) {
      mqttClient.publish(PRESENCE_TOPIC, payload);
    }
    if (localBroadcast) {
      localBroadcast.postMessage({ channel: 'presence', data });
    }
  }

  // Handle Global Public Lobbies Presence
  function handlePresenceMessage(data) {
    const now = Date.now();
    if (data.type === 'LOBBY_PING') {
      state.multi.publicLobbies.set(data.lobby.code, {
        ...data.lobby,
        lastSeen: now
      });
      if (state.currentView === 'screenLobbies') {
        renderLobbiesList();
      }
    } else if (data.type === 'LOBBY_CLOSED') {
      state.multi.publicLobbies.delete(data.code);
      if (state.currentView === 'screenLobbies') {
        renderLobbiesList();
      }
    }
  }

  // Cleanup old public lobbies (> 10s without ping)
  setInterval(() => {
    const now = Date.now();
    let changed = false;
    state.multi.publicLobbies.forEach((lobby, code) => {
      if (now - lobby.lastSeen > 10000) {
        state.multi.publicLobbies.delete(code);
        changed = true;
      }
    });
    if (changed && state.currentView === 'screenLobbies') {
      renderLobbiesList();
    }
  }, 3000);

  // -------------------------------------------------------------
  // USER PROFILE & THEME & AUDIO
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

      if (state.multi.room) {
        publishRoomMessage({
          type: 'UPDATE_PROFILE',
          playerId: state.user.id,
          name: newName,
          avatar: selectedAvatar
        });
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

  function getDifficultyInfo(diff) {
    if (diff === 'easy') return { label: '🟢 Легке', badgeClass: 'diff-badge-easy', basePoints: 100 };
    if (diff === 'medium') return { label: '🟡 Середнє', badgeClass: 'diff-badge-medium', basePoints: 150 };
    if (diff === 'hard') return { label: '🔴 Складне', badgeClass: 'diff-badge-hard', basePoints: 250 };
    return { label: '🎲 Логіка', badgeClass: '', basePoints: 100 };
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
    renderLobbiesList();
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
  // SOLO SETUP & GAMEPLAY
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

  document.querySelectorAll('#soloDiffSelectors .chip-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#soloDiffSelectors .chip-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.solo.difficulty = btn.getAttribute('data-diff');
      window.soundController.playClick();
    });
  });

  document.getElementById('btnStartSoloGame').addEventListener('click', () => {
    window.soundController.playClick();
    const pool = window.QUIZ_QUESTIONS || [];
    
    let filtered = pool;
    if (state.solo.difficulty !== 'all') {
      filtered = pool.filter(q => q.difficulty === state.solo.difficulty);
    }

    const count = Math.min(state.solo.count, filtered.length);
    const shuffled = shuffle(filtered);

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
    document.getElementById('gameLiveRaceBoard').style.display = 'none';
    document.getElementById('soloNextBtnContainer').style.display = 'block';
    document.getElementById('btnSoloNextQuestion').style.display = 'none';
    document.getElementById('gameExplanationBox').style.display = 'none';

    const q = state.solo.questions[state.solo.currentIndex];
    const total = state.solo.questions.length;
    const diffInfo = getDifficultyInfo(q.difficulty);

    const badge = document.getElementById('gameCategoryBadge');
    badge.textContent = `${diffInfo.label} • +${diffInfo.basePoints} балів`;
    badge.className = `category-badge ${diffInfo.badgeClass}`;

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

    let typewriterTimeout = null;

    function typewriteQuestionText(fullText, onComplete) {
      if (typewriterTimeout) clearTimeout(typewriterTimeout);
      const container = document.getElementById('gameQuestionText');
      const optContainer = document.getElementById('gameOptionsContainer');
      
      container.innerHTML = '<span class="typewriter-content"></span><span class="typewriter-cursor"></span>';
      const contentSpan = container.querySelector('.typewriter-content');
      const cursorSpan = container.querySelector('.typewriter-cursor');
      
      optContainer.classList.add('locked-typing');

      let charIdx = 0;
      const speed = 25; // ms per char: fast, crisp reading stream

      function typeNext() {
        if (charIdx < fullText.length) {
          contentSpan.textContent += fullText[charIdx];
          charIdx++;
          typewriterTimeout = setTimeout(typeNext, speed);
        } else {
          if (cursorSpan) cursorSpan.remove();
          optContainer.classList.remove('locked-typing');
          if (onComplete) onComplete();
        }
      }

      typeNext();
    }

    // Start timer & options activation once text finishes streaming (or simultaneously)
    if (state.solo.timerInterval) clearInterval(state.solo.timerInterval);
    const timerBar = document.getElementById('gameTimerBar');

    typewriteQuestionText(q.question, () => {
      // Options unlocked!
    });

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
    const diffInfo = getDifficultyInfo(q.difficulty);

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
      const points = diffInfo.basePoints + timeBonus + streakBonus;
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
    if (state.multi.room) {
      state.multi.currentIndex++;
      if (state.multi.currentIndex < state.multi.myQuestions.length) {
        startMultiplayerIndividualQuestion();
      } else {
        finishMyMultiplayerQuiz();
      }
    } else {
      state.solo.currentIndex++;
      if (state.solo.currentIndex < state.solo.questions.length) {
        startSoloQuestion();
      } else {
        showSoloResults();
      }
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
  // MULTIPLAYER LOBBY PROTOCOL (ROCK-SOLID WEBSOCKETS OVER MQTT)
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

  let lobbyDifficulty = 'all';
  document.querySelectorAll('#lobbyDiffSelectors .chip-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#lobbyDiffSelectors .chip-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      lobbyDifficulty = btn.getAttribute('data-diff');
      window.soundController.playClick();
    });
  });

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
      difficulty: lobbyDifficulty,
      timePerQuestion,
      maxPlayers,
      isPrivate
    });
  });

  // Host: Create Room
  function hostCreateRoom(opts) {
    leaveCurrentLobby();
    showToast('Створення кімнати...', 'info');

    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const roomCode = `Q-${randomSuffix}`;

    state.multi.isHost = true;
    state.multi.currentRoomCode = roomCode;
    state.multi.roomTopic = ROOM_TOPIC_PREFIX + roomCode;

    if (mqttClient && mqttClient.connected) {
      mqttClient.subscribe(state.multi.roomTopic);
    }

    const room = {
      code: roomCode,
      name: opts.name || `Лобі гравця ${state.user.name}`,
      hostId: state.user.id,
      hostName: state.user.name,
      questionCount: opts.questionCount || 10,
      difficulty: opts.difficulty || 'all',
      timePerQuestion: opts.timePerQuestion || 15,
      maxPlayers: opts.maxPlayers || 8,
      isPrivate: opts.isPrivate,
      status: 'waiting',
      players: {
        [state.user.id]: {
          id: state.user.id,
          name: state.user.name,
          avatar: state.user.avatar,
          isHost: true,
          isReady: true,
          score: 0,
          streak: 0,
          correctCount: 0,
          progress: 0,
          finished: false,
          lastSeen: Date.now()
        }
      }
    };

    state.multi.room = room;
    renderWaitingRoom();
    showScreen('screenLobbyRoom');
    showToast(`Лобі ${roomCode} створено! Скопіюйте код для друзів`, 'success');

    // Start lobby presence announcements
    startLobbyPresenceHeartbeat();
    startPlayerHeartbeat();
  }

  function startLobbyPresenceHeartbeat() {
    stopLobbyPresenceHeartbeat();
    sendLobbyPresence();
    state.multi.announceInterval = setInterval(sendLobbyPresence, 2500);
  }

  function stopLobbyPresenceHeartbeat() {
    if (state.multi.announceInterval) {
      clearInterval(state.multi.announceInterval);
      state.multi.announceInterval = null;
    }
  }

  function sendLobbyPresence() {
    const room = state.multi.room;
    if (!room || !state.multi.isHost || room.isPrivate) return;

    publishPresenceMessage({
      type: 'LOBBY_PING',
      lobby: {
        code: room.code,
        name: room.name,
        hostName: room.hostName,
        playerCount: Object.keys(room.players).length,
        maxPlayers: room.maxPlayers,
        questionCount: room.questionCount,
        difficulty: room.difficulty || 'all',
        timePerQuestion: room.timePerQuestion,
        status: room.status
      }
    });
  }

  function startPlayerHeartbeat() {
    if (state.multi.playerHeartbeatInterval) clearInterval(state.multi.playerHeartbeatInterval);
    state.multi.playerHeartbeatInterval = setInterval(() => {
      if (state.multi.currentRoomCode && state.multi.room) {
        publishRoomMessage({
          type: 'PLAYER_PING',
          playerId: state.user.id,
          isHost: state.multi.isHost
        });

        // Host checks guest timeouts (> 12s)
        if (state.multi.isHost) {
          const now = Date.now();
          let playerRemoved = false;
          Object.values(state.multi.room.players).forEach(p => {
            if (!p.isHost && p.lastSeen && (now - p.lastSeen > 12000)) {
              delete state.multi.room.players[p.id];
              playerRemoved = true;
              showToast(`Гравець ${p.name} від'єднався через неактивність`, 'info');
              publishRoomMessage({
                type: 'CHAT_MSG',
                sender: 'Система',
                avatar: '🚪',
                text: `Гравець ${p.name} від'єднався`,
                time: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })
              });
            }
          });

          if (playerRemoved) {
            publishRoomMessage({ type: 'ROOM_UPDATED', room: state.multi.room });
            renderWaitingRoom();
            sendLobbyPresence();
            if (state.multi.room.status === 'playing') {
              const allDone = Object.values(state.multi.room.players).every(p => p.finished);
              if (allDone) hostFinishGame();
            }
          }
        }
      }
    }, 3000);
  }

  // Guest: Join Lobby by Code
  function joinLobbyByCode(code) {
    leaveCurrentLobby();
    const cleanCode = code.trim().toUpperCase();
    showToast(`Підключення до ${cleanCode}...`, 'info');

    state.multi.isHost = false;
    state.multi.currentRoomCode = cleanCode;
    state.multi.roomTopic = ROOM_TOPIC_PREFIX + cleanCode;

    if (mqttClient && mqttClient.connected) {
      mqttClient.subscribe(state.multi.roomTopic);
    }

    // Send Join Request with retries
    let attempts = 0;
    const sendJoin = () => {
      if (state.multi.room) return; // Already joined!
      attempts++;
      publishRoomMessage({
        type: 'JOIN_REQUEST',
        targetRoomCode: cleanCode,
        fromId: state.user.id,
        player: {
          id: state.user.id,
          name: state.user.name,
          avatar: state.user.avatar
        }
      });

      if (attempts < 5 && !state.multi.room) {
        state.multi.joinTimeout = setTimeout(sendJoin, 1000);
      } else if (attempts >= 5 && !state.multi.room) {
        showToast('Не вдалося знайти кімнату або хост не відповідає!', 'error');
        leaveCurrentLobby();
        showScreen('screenLobbies');
      }
    };

    setTimeout(sendJoin, 300);
  }

  // -------------------------------------------------------------
  // CENTRAL ROOM MESSAGE DISPATCHER
  // -------------------------------------------------------------
  function handleRoomMessage(data) {
    const room = state.multi.room;

    // HOST HANDLERS
    if (state.multi.isHost && room) {
      if (data.type === 'JOIN_REQUEST') {
        if (room.status !== 'waiting') {
          publishRoomMessage({
            type: 'JOIN_ERROR',
            targetId: data.fromId,
            message: 'Гра в цьому лобі вже розпочалася!'
          });
          return;
        }

        if (Object.keys(room.players).length >= room.maxPlayers) {
          publishRoomMessage({
            type: 'JOIN_ERROR',
            targetId: data.fromId,
            message: 'Лобі вже заповнене!'
          });
          return;
        }

        const newPlayer = {
          id: data.player.id,
          name: data.player.name,
          avatar: data.player.avatar,
          isHost: false,
          isReady: false,
          score: 0,
          streak: 0,
          correctCount: 0,
          progress: 0,
          finished: false,
          lastSeen: Date.now()
        };

        room.players[newPlayer.id] = newPlayer;

        publishRoomMessage({
          type: 'JOIN_SUCCESS',
          targetId: newPlayer.id,
          room: room
        });

        publishRoomMessage({
          type: 'ROOM_UPDATED',
          room: room
        });

        publishRoomMessage({
          type: 'CHAT_MSG',
          sender: 'Система',
          avatar: '👋',
          text: `Гравець ${newPlayer.name} приєднався до кімнати!`,
          time: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })
        });

        renderWaitingRoom();
        sendLobbyPresence();
      }

      if (data.type === 'TOGGLE_READY') {
        const p = room.players[data.playerId];
        if (p) {
          p.isReady = !p.isReady;
          publishRoomMessage({ type: 'ROOM_UPDATED', room: room });
          renderWaitingRoom();
        }
      }

      if (data.type === 'PLAYER_PROGRESS_UPDATE') {
        const p = room.players[data.playerId];
        if (p) {
          p.score = data.score;
          p.streak = data.streak;
          p.correctCount = data.correctCount;
          p.progress = data.progress;
          p.finished = data.finished;
          p.lastSeen = Date.now();
        }

        publishRoomMessage({
          type: 'RACE_BOARD_UPDATE',
          players: Object.values(room.players)
        });

        const allFinished = Object.values(room.players).every(pl => pl.finished);
        if (allFinished) {
          hostFinishGame();
        }
      }
    }

    // ALL CLIENTS HANDLERS (Host + Guests)
    if (data.type === 'PLAYER_PING') {
      if (room && room.players[data.playerId]) {
        room.players[data.playerId].lastSeen = Date.now();
      }
    }

    if (data.type === 'PLAYER_PROGRESS_UPDATE') {
      if (room && room.players[data.playerId]) {
        room.players[data.playerId].score = data.score;
        room.players[data.playerId].streak = data.streak;
        room.players[data.playerId].correctCount = data.correctCount;
        room.players[data.playerId].progress = data.progress;
        room.players[data.playerId].finished = data.finished;
        room.players[data.playerId].lastSeen = Date.now();
        renderRaceBoard(Object.values(room.players));
      }

      // Host checks if everyone finished to trigger game over
      if (state.multi.isHost && room && room.status === 'playing') {
        const allFinished = Object.values(room.players).every(pl => pl.finished);
        if (allFinished) {
          hostFinishGame();
        }
      }
    }

    if (data.type === 'JOIN_SUCCESS' && data.targetId === state.user.id) {
      if (state.multi.joinTimeout) clearTimeout(state.multi.joinTimeout);
      state.multi.room = data.room;
      state.multi.isHost = false;
      renderWaitingRoom();
      showScreen('screenLobbyRoom');
      showToast('Ви успішно увійшли в лобі!', 'success');
      startPlayerHeartbeat();
    }

    if (data.type === 'JOIN_ERROR' && data.targetId === state.user.id) {
      if (state.multi.joinTimeout) clearTimeout(state.multi.joinTimeout);
      showToast(data.message || 'Помилка входу в кімнату', 'error');
      leaveCurrentLobby();
      showScreen('screenLobbies');
    }

    if (data.type === 'KICKED' && data.targetId === state.user.id) {
      showToast(data.message || 'Вас було виключено з кімнати хостом', 'error');
      leaveCurrentLobby();
      showScreen('screenLobbies');
      renderLobbiesList();
    }

    if (data.type === 'ROOM_UPDATED') {
      state.multi.room = data.room;
      renderWaitingRoom();
    }

    if (data.type === 'UPDATE_PROFILE') {
      if (room && room.players[data.playerId]) {
        room.players[data.playerId].name = data.name;
        room.players[data.playerId].avatar = data.avatar;
        renderWaitingRoom();
      }
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
        setTimeout(() => {
          countdownOverlay.style.display = 'none';
        }, 750);
      }
    }

    if (data.type === 'GAME_STARTED_FOR_PLAYER' && data.targetId === state.user.id) {
      countdownOverlay.style.display = 'none';
      showScreen('screenGame');
      document.getElementById('gameLiveRaceBoard').style.display = 'block';
      document.getElementById('soloNextBtnContainer').style.display = 'block';
      document.getElementById('btnSoloNextQuestion').style.display = 'none';

      state.multi.myQuestions = data.questions;
      state.multi.currentIndex = 0;
      state.multi.score = 0;
      state.multi.streak = 0;
      state.multi.correctCount = 0;
      state.multi.userAnswers = [];
      state.multi.isFinished = false;

      // Reset all players stats in local room state & render initial board
      if (state.multi.room) {
        Object.values(state.multi.room.players).forEach(p => {
          p.score = 0;
          p.progress = 0;
          p.finished = false;
        });
        renderRaceBoard(Object.values(state.multi.room.players));
      }

      startMultiplayerIndividualQuestion();
    }

    if (data.type === 'RACE_BOARD_UPDATE') {
      renderRaceBoard(data.players);
    }

    if (data.type === 'GAME_OVER') {
      showScreen('screenResults');
      document.getElementById('multiplayerPodium').style.display = 'flex';
      document.getElementById('scoreBadgeCircle').style.display = 'none';

      const leaderboard = data.leaderboard || [];
      const myRankIdx = leaderboard.findIndex(p => p.id === state.user.id);
      const myStats = leaderboard[myRankIdx] || { score: 0, correctCount: 0, accuracy: 0 };

      document.getElementById('resultsTitle').textContent = myRankIdx === 0 ? '👑 Ви перемогли в лобі!' : '🏁 Мультиплеєр завершено!';
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
      document.getElementById('resCorrectCount').textContent = `${myStats.correctCount} / ${state.multi.room?.questionCount || 10}`;
      document.getElementById('resAccuracy').textContent = `${myStats.accuracy}%`;

      window.soundController.playVictory();
      if (typeof confetti === 'function') {
        confetti({ particleCount: 150, spread: 80, origin: { y: 0.5 } });
      }

      const revContainer = document.getElementById('reviewItemsContainer');
      revContainer.innerHTML = '<h4>🏆 Реальна турнірна таблиця:</h4>';
      leaderboard.forEach((p, idx) => {
        const row = document.createElement('div');
        row.className = 'review-item';
        row.style.display = 'flex';
        row.style.justifyContent = 'space-between';
        row.style.alignItems = 'center';
        row.innerHTML = `
          <div>
            <strong>#${idx + 1} ${p.avatar} ${p.name} ${p.id === state.user.id ? '(Ви)' : ''}</strong>
            <div style="font-size: 0.8rem; color: var(--text-muted);">Точність: ${p.accuracy}% (${p.correctCount}/${state.multi.room?.questionCount || 10})</div>
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
      showToast('Хост повернув усіх до лобі для нової гри!', 'info');
    }
  }

  // -------------------------------------------------------------
  // INDIVIDUAL MULTIPLAYER GAMEPLAY
  // -------------------------------------------------------------
  function startMultiplayerIndividualQuestion() {
    const q = state.multi.myQuestions[state.multi.currentIndex];
    const total = state.multi.myQuestions.length;
    const diffInfo = getDifficultyInfo(q.difficulty);

    document.getElementById('gameExplanationBox').style.display = 'none';
    document.getElementById('btnSoloNextQuestion').style.display = 'none';
    
    const badge = document.getElementById('gameCategoryBadge');
    badge.textContent = `${diffInfo.label} • +${diffInfo.basePoints} балів`;
    badge.className = `category-badge ${diffInfo.badgeClass}`;

    document.getElementById('gameCurrentQNum').textContent = state.multi.currentIndex + 1;
    document.getElementById('gameTotalQNum').textContent = total;
    document.getElementById('gameScoreBadge').textContent = `🏆 ${state.multi.score} очок`;
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
        handleMultiplayerAnswerIndividual(optIdx, btn);
      });
      optContainer.appendChild(btn);
    });

    let multiTypewriterTimeout = null;

    function typewriteMultiQuestionText(fullText, onComplete) {
      if (multiTypewriterTimeout) clearTimeout(multiTypewriterTimeout);
      const container = document.getElementById('gameQuestionText');
      const optContainer = document.getElementById('gameOptionsContainer');
      
      container.innerHTML = '<span class="typewriter-content"></span><span class="typewriter-cursor"></span>';
      const contentSpan = container.querySelector('.typewriter-content');
      const cursorSpan = container.querySelector('.typewriter-cursor');
      
      optContainer.classList.add('locked-typing');

      let charIdx = 0;
      const speed = 25; // ms per char: quick dynamic reading stream

      function typeNext() {
        if (charIdx < fullText.length) {
          contentSpan.textContent += fullText[charIdx];
          charIdx++;
          multiTypewriterTimeout = setTimeout(typeNext, speed);
        } else {
          if (cursorSpan) cursorSpan.remove();
          optContainer.classList.remove('locked-typing');
          if (onComplete) onComplete();
        }
      }

      typeNext();
    }

    if (state.multi.timerInterval) clearInterval(state.multi.timerInterval);
    const timerBar = document.getElementById('gameTimerBar');

    typewriteMultiQuestionText(q.question, () => {
      // Options unlocked!
    });

    const timeLimit = state.multi.room?.timePerQuestion || 15;
    state.multi.timeRemaining = timeLimit;
    timerBar.style.width = '100%';
    timerBar.style.background = 'linear-gradient(90deg, var(--primary), var(--secondary))';

    const stepMs = 100;
    let elapsed = 0;

    state.multi.timerInterval = setInterval(() => {
      elapsed += stepMs;
      const remaining = Math.max(0, timeLimit - elapsed / 1000);
      state.multi.timeRemaining = remaining;

      const pct = (remaining / timeLimit) * 100;
      timerBar.style.width = `${pct}%`;

      if (pct < 30) {
        timerBar.style.background = 'var(--danger)';
      }

      if (remaining <= 0) {
        clearInterval(state.multi.timerInterval);
        handleMultiplayerTimeoutIndividual();
      }
    }, stepMs);
  }

  function handleMultiplayerAnswerIndividual(selectedIdx, btnElement) {
    if (state.multi.timerInterval) clearInterval(state.multi.timerInterval);

    const q = state.multi.myQuestions[state.multi.currentIndex];
    const isCorrect = selectedIdx === q.correctIndex;
    const diffInfo = getDifficultyInfo(q.difficulty);

    const allBtns = document.querySelectorAll('#gameOptionsContainer .option-btn');
    allBtns.forEach((b, idx) => {
      b.disabled = true;
      if (idx === q.correctIndex) {
        b.classList.add('correct');
      } else if (idx === selectedIdx && !isCorrect) {
        b.classList.add('wrong');
      }
    });

    const timeLimit = state.multi.room?.timePerQuestion || 15;
    if (isCorrect) {
      state.multi.streak++;
      state.multi.correctCount++;
      const timeBonus = Math.round((state.multi.timeRemaining / timeLimit) * 50);
      const streakBonus = Math.min(state.multi.streak * 10, 50);
      const points = diffInfo.basePoints + timeBonus + streakBonus;
      state.multi.score += points;
      window.soundController.playCorrect();
      showToast(`+${points} очок! 🔥 Серія: ${state.multi.streak}`, 'success');
    } else {
      state.multi.streak = 0;
      window.soundController.playIncorrect();
    }

    state.multi.userAnswers.push({
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

    document.getElementById('gameScoreBadge').textContent = `🏆 ${state.multi.score} очок`;
    document.getElementById('btnSoloNextQuestion').style.display = 'inline-flex';

    sendMyProgressUpdate();
  }

  function handleMultiplayerTimeoutIndividual() {
    const q = state.multi.myQuestions[state.multi.currentIndex];
    const allBtns = document.querySelectorAll('#gameOptionsContainer .option-btn');
    allBtns.forEach((b, idx) => {
      b.disabled = true;
      if (idx === q.correctIndex) {
        b.classList.add('correct');
      }
    });

    state.multi.streak = 0;
    window.soundController.playIncorrect();
    showToast('Час вичерпано!', 'error');

    state.multi.userAnswers.push({
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
    sendMyProgressUpdate();
  }

  function sendMyProgressUpdate() {
    const total = state.multi.myQuestions.length || (state.multi.room?.questionCount || 10);
    const answeredCount = state.multi.userAnswers.length;
    const isFinished = (answeredCount >= total) || state.multi.isFinished;

    const myProgressData = {
      score: state.multi.score,
      streak: state.multi.streak,
      correctCount: state.multi.correctCount,
      progress: Math.min(answeredCount, total),
      finished: isFinished
    };

    // Update local state immediately for zero latency
    if (state.multi.room && state.multi.room.players[state.user.id]) {
      Object.assign(state.multi.room.players[state.user.id], myProgressData);
      renderRaceBoard(Object.values(state.multi.room.players));
    }

    publishRoomMessage({
      type: 'PLAYER_PROGRESS_UPDATE',
      playerId: state.user.id,
      ...myProgressData
    });
  }

  function finishMyMultiplayerQuiz() {
    state.multi.isFinished = true;
    sendMyProgressUpdate();

    document.getElementById('gameQuestionText').textContent = '🏁 Ви відповіли на всі свої запитання! Очікуємо фінішу інших гравців...';
    document.getElementById('gameOptionsContainer').innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 2rem; background: var(--bg-card-hover); border-radius: var(--radius-sm);">
        <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">⏳</div>
        <h3>Ваш результат: ${state.multi.score} очок</h3>
        <p style="color: var(--text-muted);">Правильних відповідей: ${state.multi.correctCount} / ${state.multi.myQuestions.length}</p>
        <p style="margin-top: 0.75rem; font-size: 0.9rem;">Слідкуйте за живим прогресом інших гравців нижче ⬇️</p>
      </div>
    `;
    document.getElementById('soloNextBtnContainer').style.display = 'none';
    document.getElementById('gameExplanationBox').style.display = 'none';
  }

  function renderRaceBoard(playersList) {
    const list = playersList || (state.multi.room ? Object.values(state.multi.room.players) : []);
    const totalQ = state.multi.room?.questionCount || 10;
    const totalPlayers = list.length;
    const finishedCount = list.filter(p => p.finished || (p.progress >= totalQ)).length;

    const raceCountEl = document.getElementById('gameRaceCountText');
    if (raceCountEl) {
      raceCountEl.textContent = `${finishedCount} / ${totalPlayers} фінішували`;
    }

    const container = document.getElementById('gameRacePlayersList');
    if (!container) return;
    container.innerHTML = '';

    // Sort by progress descending, then by score descending
    const sorted = [...list].sort((a, b) => {
      const aDone = a.finished ? 1 : 0;
      const bDone = b.finished ? 1 : 0;
      if (bDone !== aDone) return bDone - aDone;
      if ((b.progress || 0) !== (a.progress || 0)) return (b.progress || 0) - (a.progress || 0);
      return (b.score || 0) - (a.score || 0);
    });

    sorted.forEach(p => {
      const isMe = (p.id === state.user.id);
      const row = document.createElement('div');
      row.className = 'race-player-row';
      const curProg = Math.min(p.progress || 0, totalQ);
      const pct = Math.round((curProg / totalQ) * 100);
      const isDone = p.finished || curProg >= totalQ;

      row.innerHTML = `
        <span class="r-avatar">${p.avatar}</span>
        <span class="r-name">${p.name} ${isMe ? '<strong>(Ви)</strong>' : ''}</span>
        <div class="race-bar-bg">
          <div class="race-bar-fill ${isDone ? 'finished' : ''}" style="width: ${pct}%;"></div>
        </div>
        <span style="font-size: 0.75rem; color: ${isDone ? 'var(--success)' : 'var(--text-muted)'}; min-width: 50px; font-weight: ${isDone ? '700' : '500'};">
          ${isDone ? '🏁 Фініш' : `${curProg}/${totalQ}`}
        </span>
        <span class="r-score">${p.score || 0}</span>
      `;
      container.appendChild(row);
    });
  }

  // Host: Start Game
  document.getElementById('btnHostStartGame').addEventListener('click', () => {
    window.soundController.playClick();
    const room = state.multi.room;
    if (!room || !state.multi.isHost) return;

    const pool = window.QUIZ_QUESTIONS || [];
    const qCount = room.questionCount;
    const diff = room.difficulty || 'all';

    let filtered = pool;
    if (diff !== 'all') {
      filtered = pool.filter(q => q.difficulty === diff);
    }

    room.status = 'playing';

    // Step 1: Run 3..2..1..GO countdown
    let countdown = 3;
    publishRoomMessage({ type: 'START_COUNTDOWN', count: countdown });

    const cInterval = setInterval(() => {
      countdown--;
      if (countdown > 0) {
        publishRoomMessage({ type: 'START_COUNTDOWN', count: countdown });
      } else if (countdown === 0) {
        publishRoomMessage({ type: 'START_COUNTDOWN', count: 0 }); // "GO!"
      } else {
        clearInterval(cInterval);

        // Step 2: Send individualized questions to each player and launch game
        Object.keys(room.players).forEach(playerId => {
          const playerQuestions = shuffle(filtered).slice(0, Math.min(qCount, filtered.length));
          publishRoomMessage({
            type: 'GAME_STARTED_FOR_PLAYER',
            targetId: playerId,
            questions: playerQuestions
          });
        });
      }
    }, 1000);

    sendLobbyPresence();
  });

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
      accuracy: Math.round((p.correctCount / (room.questionCount || 1)) * 100)
    })).sort((a, b) => b.score - a.score);

    publishRoomMessage({
      type: 'GAME_OVER',
      leaderboard: finalLeaderboard
    });

    sendLobbyPresence();
  }

  function hostResetRoomForNewGame() {
    const room = state.multi.room;
    if (!room) return;

    room.status = 'waiting';
    Object.values(room.players).forEach(p => {
      p.score = 0;
      p.streak = 0;
      p.correctCount = 0;
      p.progress = 0;
      p.finished = false;
      p.isReady = p.isHost;
    });

    publishRoomMessage({
      type: 'ROOM_RESET',
      room: room
    });

    sendLobbyPresence();
  }

  function hostKickPlayer(playerId, playerName) {
    const room = state.multi.room;
    if (!room || !state.multi.isHost) return;

    publishRoomMessage({
      type: 'KICKED',
      targetId: playerId,
      message: 'Хост виключив вас із кімнати'
    });

    delete room.players[playerId];

    showToast(`Гравця ${playerName || ''} кікнуто`, 'info');
    publishRoomMessage({ type: 'ROOM_UPDATED', room: room });
    publishRoomMessage({
      type: 'CHAT_MSG',
      sender: 'Система',
      avatar: '🚫',
      text: `Гравця ${playerName || 'учасника'} було виключено хостом`,
      time: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })
    });

    renderWaitingRoom();
    sendLobbyPresence();
  }

  document.getElementById('btnToggleReady').addEventListener('click', () => {
    window.soundController.playClick();
    publishRoomMessage({
      type: 'TOGGLE_READY',
      playerId: state.user.id
    });
  });

  document.getElementById('formRoomChat').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('inputChatMsg');
    const text = input.value.trim();
    if (!text) return;

    publishRoomMessage({
      type: 'CHAT_MSG',
      sender: state.user.name,
      avatar: state.user.avatar,
      text,
      time: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })
    });

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

    const diffNames = { all: '🎲 Змішана', easy: '🟢 Легкі', medium: '🟡 Середні', hard: '🔴 Складні' };
    const diffLabel = diffNames[room.difficulty || 'all'] || '🎲 Змішана';

    document.getElementById('roomTitleText').textContent = room.name;
    document.getElementById('roomCategoryText').textContent = `Складність: ${diffLabel}`;
    document.getElementById('roomQuestionCountText').textContent = `${room.questionCount} питань`;
    document.getElementById('roomTimeText').textContent = `${room.timePerQuestion}с`;
    document.getElementById('roomCodeDisplay').textContent = room.code;

    const playersArr = Object.values(room.players || {});
    document.getElementById('roomPlayerCount').textContent = playersArr.length;
    document.getElementById('roomMaxPlayers').textContent = room.maxPlayers;

    const playersList = document.getElementById('roomPlayersList');
    playersList.innerHTML = '';

    const isHost = state.multi.isHost;
    playersArr.forEach(p => {
      const isMe = (p.id === state.user.id);
      const card = document.createElement('div');
      card.className = `player-slot-card ${p.isReady ? 'is-ready' : ''}`;
      card.innerHTML = `
        ${p.isHost ? '<span class="host-badge">👑 ХОСТ</span>' : ''}
        ${isHost && !p.isHost ? `<button class="kick-btn" title="Кікнути ${p.name}">✕</button>` : ''}
        <div class="avatar-big">${p.avatar}</div>
        <div class="p-name">${p.name} ${isMe ? '(Ви)' : ''}</div>
        <div class="ready-status ${p.isReady ? 'ready' : 'not-ready'}">
          ${p.isHost ? 'Готовий до старту' : p.isReady ? '✅ Готовий' : '⏳ Не готовий'}
        </div>
      `;

      if (isHost && !p.isHost) {
        const kickBtn = card.querySelector('.kick-btn');
        if (kickBtn) {
          kickBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm(`Ви дійсно хочете кікнути гравця "${p.name}"?`)) {
              hostKickPlayer(p.id, p.name);
            }
          });
        }
      }

      playersList.appendChild(card);
    });

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
    stopLobbyPresenceHeartbeat();
    if (state.multi.playerHeartbeatInterval) {
      clearInterval(state.multi.playerHeartbeatInterval);
      state.multi.playerHeartbeatInterval = null;
    }
    if (state.multi.joinTimeout) {
      clearTimeout(state.multi.joinTimeout);
      state.multi.joinTimeout = null;
    }

    if (state.multi.room) {
      if (state.multi.isHost) {
        publishPresenceMessage({ type: 'LOBBY_CLOSED', code: state.multi.room.code });
        publishRoomMessage({
          type: 'CHAT_MSG',
          sender: 'Система',
          avatar: '⚠️',
          text: 'Хост закрив лобі',
          time: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })
        });
      } else {
        publishRoomMessage({
          type: 'CHAT_MSG',
          sender: 'Система',
          avatar: '🚪',
          text: `Гравець ${state.user.name} вийшов з лобі`,
          time: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })
        });
      }
    }

    if (mqttClient && state.multi.roomTopic) {
      mqttClient.unsubscribe(state.multi.roomTopic);
    }

    state.multi.room = null;
    state.multi.currentRoomCode = null;
    state.multi.roomTopic = null;
    state.multi.isHost = false;
  }

  document.getElementById('btnLeaveLobby').addEventListener('click', () => {
    window.soundController.playClick();
    leaveCurrentLobby();
    showScreen('screenLobbies');
    renderLobbiesList();
  });

  document.getElementById('btnCopyRoomCode').addEventListener('click', () => {
    if (state.multi.room) {
      const inviteUrl = `${window.location.origin}${window.location.pathname}?join=${state.multi.room.code}`;
      navigator.clipboard.writeText(inviteUrl);
      showToast(`Посилання для запрошення скопійовано!`, 'success');
      window.soundController.playClick();
    }
  });

  document.getElementById('btnRefreshLobbies').addEventListener('click', () => {
    window.soundController.playClick();
    renderLobbiesList();
    showToast('Список оновлено', 'info');
  });

  document.getElementById('inputLobbySearch').addEventListener('input', (e) => {
    renderLobbiesList(e.target.value.toLowerCase());
  });

  function renderLobbiesList(searchQuery = '') {
    const container = document.getElementById('lobbiesContainer');
    container.innerHTML = '';

    const list = Array.from(state.multi.publicLobbies.values()).filter(l => {
      if (!searchQuery) return true;
      return l.name.toLowerCase().includes(searchQuery) ||
             l.hostName.toLowerCase().includes(searchQuery) ||
             l.code.toLowerCase().includes(searchQuery);
    });

    if (list.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 3.5rem 1.5rem; background: var(--bg-card); border: 1px dashed var(--border); border-radius: var(--radius);">
          <div style="font-size: 2.8rem; margin-bottom: 0.6rem;">👥</div>
          <h3 style="font-size: 1.25rem;">Наразі немає відкритих кімнат</h3>
          <p style="color: var(--text-muted); margin: 0.5rem 0 1.5rem;">Створіть перше лобі або підключіться за кодом від друга!</p>
          <button class="btn btn-primary" onclick="document.getElementById('btnOpenCreateLobbyModal').click()">➕ Створити кімнату</button>
        </div>
      `;
      return;
    }

    const diffBadges = {
      all: '🎲 Мікс',
      easy: '🟢 Легкі',
      medium: '🟡 Середні',
      hard: '🔴 Складні'
    };

    list.forEach(lobby => {
      const card = document.createElement('div');
      card.className = 'lobby-item-card';
      const isFull = lobby.playerCount >= lobby.maxPlayers;
      const isPlaying = lobby.status === 'playing';
      const diffTag = diffBadges[lobby.difficulty || 'all'] || '🎲 Мікс';

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
          <span>👥 Гравці: <strong>${lobby.playerCount}/${lobby.maxPlayers}</strong></span>
          <span>${diffTag}</span>
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
    }, 600);
  }

  // Anti-cheat: prevent right-click context menu & drag selection during gameplay
  document.addEventListener('contextmenu', (e) => {
    if (state.currentView === 'screenGame') {
      e.preventDefault();
    }
  });

  // Init
  initUser();
  initMqtt();
  renderLobbiesList();
});
