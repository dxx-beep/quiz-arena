// QuizArena Client Application
document.addEventListener('DOMContentLoaded', () => {
  // Try connecting socket.io if hosted on dynamic server
  let socket = null;
  let isSocketConnected = false;

  try {
    if (typeof io !== 'undefined') {
      socket = io({ timeout: 2500, reconnectionAttempts: 2 });
      socket.on('connect', () => {
        isSocketConnected = true;
        console.log('✅ Connected to live WebSocket server');
      });
      socket.on('connect_error', () => {
        isSocketConnected = false;
        console.log('ℹ️ WebSocket unavailable, running in standalone/static mode');
      });
    }
  } catch (e) {
    console.log('Static mode fallback active');
  }

  // App State
  const state = {
    user: {
      name: localStorage.getItem('qa_player_name') || `Гравець_${Math.floor(Math.random() * 900 + 100)}`,
      avatar: localStorage.getItem('qa_player_avatar') || '🦊',
      theme: localStorage.getItem('qa_theme') || 'light'
    },
    categories: [],
    currentView: 'screenHome',
    
    // Solo Mode State
    solo: {
      category: 'all',
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

    // Multiplayer Mode State
    multi: {
      room: null,
      isHost: false,
      yourId: 'player-' + Math.random().toString(36).substr(2, 9),
      currentQuestionIndex: 0,
      totalQuestions: 0,
      timeLimit: 15,
      timeRemaining: 15,
      timerInterval: null,
      hasAnsweredCurrent: false,
      lobbiesList: [],
      isSimulated: false,
      botTimers: []
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

  // Header Elements
  const headerPlayerName = document.getElementById('headerPlayerName');
  const headerPlayerAvatar = document.getElementById('headerPlayerAvatar');
  const btnToggleTheme = document.getElementById('btnToggleTheme');
  const btnToggleSound = document.getElementById('btnToggleSound');
  const btnLogoHome = document.getElementById('btnLogoHome');
  const btnOpenProfile = document.getElementById('btnOpenProfile');

  // Modals
  const modalCreateLobby = document.getElementById('modalCreateLobby');
  const modalProfile = document.getElementById('modalProfile');
  const countdownOverlay = document.getElementById('countdownOverlay');
  const countdownNum = document.getElementById('countdownNum');
  const toastContainer = document.getElementById('toastContainer');

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
      if (confirm('Ви дійсно хочете залишити поточну кімнату?')) {
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
    }
  });

  // Screen Switcher
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

  // Toast Notification Helper
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

  // Shuffle Helper
  function shuffle(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // Load Categories
  async function loadCategories() {
    try {
      let data = null;
      if (window.location.protocol.startsWith('http') && !window.location.hostname.includes('github.io')) {
        const res = await fetch('/api/categories').catch(() => null);
        if (res && res.ok) {
          data = await res.json();
        }
      }

      if (!data) {
        // Fallback using window.QUIZ_QUESTIONS
        const questions = window.QUIZ_QUESTIONS || [];
        const categoriesMap = {
          all: { id: 'all', name: 'Усі категорії', count: questions.length, icon: '🌟' }
        };
        questions.forEach(q => {
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
        data = Object.values(categoriesMap);
      }

      state.categories = data;
      renderCategoriesUI();
    } catch (err) {
      console.error('Failed to load categories', err);
    }
  }

  function renderCategoriesUI() {
    const soloGrid = document.getElementById('soloCategoriesGrid');
    soloGrid.innerHTML = '';
    state.categories.forEach((cat, idx) => {
      const card = document.createElement('div');
      card.className = `category-card ${idx === 0 ? 'selected' : ''}`;
      card.setAttribute('data-category', cat.id);
      card.innerHTML = `
        <div class="cat-icon">${cat.icon}</div>
        <div class="cat-name">${cat.name}</div>
        <div class="cat-count">${cat.count} питань</div>
      `;
      card.addEventListener('click', () => {
        document.querySelectorAll('#soloCategoriesGrid .category-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        state.solo.category = cat.id;
        window.soundController.playClick();
      });
      soloGrid.appendChild(card);
    });

    const lobbyCatSelect = document.getElementById('selectLobbyCategory');
    lobbyCatSelect.innerHTML = '';
    state.categories.forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat.id;
      opt.textContent = `${cat.icon} ${cat.name} (${cat.count} пит.)`;
      lobbyCatSelect.appendChild(opt);
    });
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
    fetchLobbies();
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

  document.getElementById('btnStartSoloGame').addEventListener('click', async () => {
    window.soundController.playClick();
    const cat = state.solo.category;
    const count = state.solo.count;

    try {
      let questions = [];
      if (window.location.protocol.startsWith('http') && !window.location.hostname.includes('github.io')) {
        const res = await fetch(`/api/questions/solo?category=${cat}&count=${count}`).catch(() => null);
        if (res && res.ok) questions = await res.json();
      }

      if (!questions || questions.length === 0) {
        let pool = window.QUIZ_QUESTIONS || [];
        if (cat && cat !== 'all') {
          pool = pool.filter(q => q.category === cat);
        }
        if (pool.length === 0) pool = window.QUIZ_QUESTIONS || [];
        const shuffled = shuffle(pool);
        questions = shuffled.slice(0, Math.min(count, shuffled.length));
      }

      if (!questions || questions.length === 0) {
        return showToast('Не вдалося завантажити питання!', 'error');
      }

      state.solo.questions = questions;
      state.solo.currentIndex = 0;
      state.solo.score = 0;
      state.solo.streak = 0;
      state.solo.correctCount = 0;
      state.solo.userAnswers = [];

      startSoloQuestion();
    } catch (err) {
      showToast('Помилка завантаження тесту: ' + err.message, 'error');
    }
  });

  function startSoloQuestion() {
    showScreen('screenGame');
    document.getElementById('gameLiveIndicator').style.display = 'none';
    document.getElementById('soloNextBtnContainer').style.display = 'block';
    document.getElementById('btnSoloNextQuestion').style.display = 'none';
    document.getElementById('gameExplanationBox').style.display = 'none';

    const q = state.solo.questions[state.solo.currentIndex];
    const total = state.solo.questions.length;

    document.getElementById('gameCategoryBadge').textContent = q.categoryName || 'Тест';
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
    if (state.multi.room && (state.multi.isHost || state.multi.isSimulated)) {
      if (isSocketConnected && socket) {
        socket.emit('play_again');
      } else {
        resetSimulatedRoom();
      }
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
  // MULTIPLAYER & LOBBIES MANAGEMENT
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

  document.getElementById('formCreateLobby').addEventListener('submit', (e) => {
    e.preventDefault();
    const roomName = document.getElementById('inputLobbyName').value.trim();
    const category = document.getElementById('selectLobbyCategory').value;
    const catObj = state.categories.find(c => c.id === category);
    const timePerQuestion = Number(document.getElementById('selectLobbyTime').value);
    const maxPlayers = Number(document.getElementById('selectLobbyMaxPlayers').value);
    const isPrivate = document.getElementById('checkLobbyPrivate').checked;

    modalCreateLobby.style.display = 'none';
    window.soundController.playClick();

    if (isSocketConnected && socket) {
      socket.emit('create_lobby', {
        roomName,
        playerName: state.user.name,
        avatar: state.user.avatar,
        questionCount: lobbyQuestionCount,
        category,
        categoryName: catObj ? catObj.name : 'Усі категорії',
        timePerQuestion,
        isPrivate,
        maxPlayers
      });
    } else {
      createSimulatedLobby({
        name: roomName,
        category,
        categoryName: catObj ? catObj.name : 'Усі категорії',
        questionCount: lobbyQuestionCount,
        timePerQuestion,
        maxPlayers,
        isPrivate
      });
    }
  });

  document.getElementById('btnRefreshLobbies').addEventListener('click', () => {
    window.soundController.playClick();
    fetchLobbies();
  });

  async function fetchLobbies() {
    if (isSocketConnected && socket) {
      socket.emit('lobbies_update');
      return;
    }

    // Static sample public lobbies
    state.multi.lobbiesList = [
      {
        code: 'Q-UKR1',
        name: '🏛️ Битва Ерудитів: Історія України',
        hostName: 'Олена_Київ',
        playerCount: 3,
        maxPlayers: 8,
        questionCount: 20,
        category: 'history',
        categoryName: 'Історія України та світу',
        timePerQuestion: 15,
        status: 'waiting'
      },
      {
        code: 'Q-DEV7',
        name: '💻 IT Квіз для Справжніх Кодерів',
        hostName: 'TechLead_UA',
        playerCount: 2,
        maxPlayers: 6,
        questionCount: 10,
        category: 'it',
        categoryName: 'IT & Програмування',
        timePerQuestion: 15,
        status: 'waiting'
      },
      {
        code: 'Q-SCI9',
        name: '🔬 Наука, Космос та Відкриття',
        hostName: 'AstroBoy',
        playerCount: 4,
        maxPlayers: 8,
        questionCount: 40,
        category: 'science',
        categoryName: 'Наука та Космос',
        timePerQuestion: 20,
        status: 'waiting'
      }
    ];
    renderLobbiesList(state.multi.lobbiesList);
  }

  document.getElementById('inputLobbySearch').addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    const filtered = state.multi.lobbiesList.filter(l => 
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
          <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">🏜️</div>
          <h3>Наразі немає відкритих лобі</h3>
          <p style="color: var(--text-muted); margin: 0.5rem 0 1.25rem;">Будьте першим, хто створить мультиплеєрну кімнату!</p>
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
          <span>👥 Гравці: <strong>${lobby.playerCount}/${lobby.maxPlayers}</strong></span>
          <span>📚 ${lobby.categoryName}</span>
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

  function joinLobbyByCode(code) {
    window.soundController.playClick();
    if (isSocketConnected && socket) {
      socket.emit('join_lobby', {
        code,
        playerName: state.user.name,
        avatar: state.user.avatar
      });
    } else {
      // Standalone/Simulated Join
      const existing = state.multi.lobbiesList.find(l => l.code.toUpperCase() === code.toUpperCase());
      createSimulatedLobby({
        code: existing ? existing.code : code,
        name: existing ? existing.name : `Кімната ${code}`,
        category: existing ? existing.category : 'all',
        categoryName: existing ? existing.categoryName : 'Усі категорії',
        questionCount: existing ? existing.questionCount : 10,
        timePerQuestion: existing ? existing.timePerQuestion : 15,
        maxPlayers: 8,
        asGuest: true
      });
    }
  }

  function leaveCurrentLobby() {
    if (isSocketConnected && socket && state.multi.room) {
      socket.emit('leave_lobby');
    }
    clearBotTimers();
    state.multi.room = null;
    state.multi.isHost = false;
    state.multi.isSimulated = false;
  }

  function clearBotTimers() {
    state.multi.botTimers.forEach(t => clearTimeout(t));
    state.multi.botTimers = [];
  }

  document.getElementById('btnLeaveLobby').addEventListener('click', () => {
    window.soundController.playClick();
    leaveCurrentLobby();
    showScreen('screenLobbies');
    fetchLobbies();
  });

  document.getElementById('btnCopyRoomCode').addEventListener('click', () => {
    if (state.multi.room) {
      navigator.clipboard.writeText(state.multi.room.code);
      showToast(`Код ${state.multi.room.code} скопійовано!`, 'success');
      window.soundController.playClick();
    }
  });

  document.getElementById('btnToggleReady').addEventListener('click', () => {
    window.soundController.playClick();
    if (isSocketConnected && socket) {
      socket.emit('toggle_ready');
    } else if (state.multi.room) {
      const p = state.multi.room.players[state.multi.yourId];
      if (p) {
        p.isReady = !p.isReady;
        renderWaitingRoom();
      }
    }
  });

  document.getElementById('btnHostStartGame').addEventListener('click', () => {
    window.soundController.playClick();
    if (isSocketConnected && socket && state.multi.room) {
      socket.emit('start_game');
    } else if (state.multi.isSimulated) {
      startSimulatedGame();
    }
  });

  document.getElementById('formRoomChat').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('inputChatMsg');
    const text = input.value.trim();
    if (!text) return;

    if (isSocketConnected && socket) {
      socket.emit('send_chat', { text });
    } else if (state.multi.room) {
      addChatMessage({
        sender: state.user.name,
        avatar: state.user.avatar,
        text,
        time: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })
      });
      // Friendly auto bot response in standalone mode
      const replies = ['Усім гарної гри! 🔥', 'Я готовий! 🚀', 'Покажемо хто тут топ 🏆', 'Крута тема тесту!'];
      const randomReply = replies[Math.floor(Math.random() * replies.length)];
      setTimeout(() => {
        if (state.multi.room) {
          const bots = Object.values(state.multi.room.players).filter(p => p.id !== state.multi.yourId);
          if (bots.length > 0) {
            const randomBot = bots[Math.floor(Math.random() * bots.length)];
            addChatMessage({
              sender: randomBot.name,
              avatar: randomBot.avatar,
              text: randomReply,
              time: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })
            });
          }
        }
      }, 1200);
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

  // -------------------------------------------------------------
  // SIMULATED / STANDALONE LOBBY ENGINE (FOR GITHUB PAGES)
  // -------------------------------------------------------------
  function createSimulatedLobby(opts) {
    clearBotTimers();
    state.multi.isSimulated = true;
    const code = opts.code || `Q-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
    const isHost = !opts.asGuest;

    const myId = state.multi.yourId;
    const room = {
      code,
      name: opts.name || `Лобі гравця ${state.user.name}`,
      hostId: isHost ? myId : 'bot-host-1',
      hostName: isHost ? state.user.name : 'Олександр_PRO',
      category: opts.category || 'all',
      categoryName: opts.categoryName || 'Усі категорії',
      questionCount: opts.questionCount || 10,
      timePerQuestion: opts.timePerQuestion || 15,
      maxPlayers: opts.maxPlayers || 8,
      status: 'waiting',
      players: {
        [myId]: {
          id: myId,
          name: state.user.name,
          avatar: state.user.avatar,
          isHost,
          isReady: isHost,
          score: 0,
          streak: 0,
          correctCount: 0
        }
      },
      questions: [],
      currentQuestionIndex: 0,
      answers: {}
    };

    // Add 2-3 lively opponents
    const mockPlayers = [
      { id: 'bot-1', name: 'Олександр 🚀', avatar: '🚀', isHost: !isHost, isReady: true, score: 0, streak: 0, correctCount: 0 },
      { id: 'bot-2', name: 'Дарина 🦉', avatar: '🦉', isHost: false, isReady: true, score: 0, streak: 0, correctCount: 0 },
      { id: 'bot-3', name: 'Максим 🦁', avatar: '🦁', isHost: false, isReady: true, score: 0, streak: 0, correctCount: 0 }
    ];

    mockPlayers.slice(0, 3).forEach(p => {
      room.players[p.id] = p;
    });

    state.multi.room = room;
    state.multi.isHost = isHost;

    renderWaitingRoom();
    showScreen('screenLobbyRoom');
    showToast(`Лобі ${code} відкрито!`, 'success');
  }

  function startSimulatedGame() {
    const room = state.multi.room;
    if (!room) return;

    let pool = window.QUIZ_QUESTIONS || [];
    if (room.category && room.category !== 'all') {
      pool = pool.filter(q => q.category === room.category);
    }
    if (pool.length === 0) pool = window.QUIZ_QUESTIONS || [];
    room.questions = shuffle(pool).slice(0, Math.min(room.questionCount, pool.length));
    room.currentQuestionIndex = 0;
    room.status = 'playing';

    Object.values(room.players).forEach(p => {
      p.score = 0;
      p.streak = 0;
      p.correctCount = 0;
    });

    state.multi.totalQuestions = room.questions.length;
    state.multi.timeLimit = room.timePerQuestion;

    // Countdown
    let count = 3;
    countdownOverlay.style.display = 'flex';
    countdownNum.textContent = count;
    window.soundController.playCountdownTick();

    const cInterval = setInterval(() => {
      count--;
      if (count > 0) {
        countdownNum.textContent = count;
        window.soundController.playCountdownTick();
      } else if (count === 0) {
        countdownNum.textContent = 'GO!';
        window.soundController.playStartBeep();
      } else {
        clearInterval(cInterval);
        countdownOverlay.style.display = 'none';
        showScreen('screenGame');
        document.getElementById('soloNextBtnContainer').style.display = 'none';
        document.getElementById('gameLiveIndicator').style.display = 'flex';
        runSimulatedQuestion();
      }
    }, 1000);
  }

  function runSimulatedQuestion() {
    clearBotTimers();
    const room = state.multi.room;
    if (!room || room.status !== 'playing') return;

    const q = room.questions[room.currentQuestionIndex];
    if (!q) {
      finishSimulatedGame();
      return;
    }

    state.multi.currentQuestionIndex = room.currentQuestionIndex;
    state.multi.hasAnsweredCurrent = false;
    room.answers = {};

    document.getElementById('gameExplanationBox').style.display = 'none';
    document.getElementById('gameCategoryBadge').textContent = q.categoryName || room.categoryName;
    document.getElementById('gameCurrentQNum').textContent = room.currentQuestionIndex + 1;
    document.getElementById('gameTotalQNum').textContent = room.questions.length;
    document.getElementById('gameQuestionText').textContent = q.question;
    document.getElementById('gameAnsweredStatusText').textContent = `Відповіло: 0 / ${Object.keys(room.players).length}`;

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
        handleSimulatedAnswer(optIdx, btn);
      });
      optContainer.appendChild(btn);
    });

    // Timer
    if (state.multi.timerInterval) clearInterval(state.multi.timerInterval);
    const timerBar = document.getElementById('gameTimerBar');
    timerBar.style.width = '100%';
    timerBar.style.background = 'linear-gradient(90deg, var(--primary), var(--secondary))';

    const totalTime = room.timePerQuestion;
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
        finishSimulatedRound();
      }
    }, stepMs);

    // Simulate bot answers
    Object.values(room.players).forEach(p => {
      if (p.id !== state.multi.yourId) {
        const delay = Math.random() * (totalTime * 600) + 1500;
        const timer = setTimeout(() => {
          if (room.status !== 'playing' || room.answers[p.id]) return;
          const isCorrect = Math.random() < 0.75;
          const chosenOpt = isCorrect ? q.correctIndex : Math.floor(Math.random() * 4);
          const timeRem = Math.max(0.5, totalTime - (delay / 1000));
          const pts = isCorrect ? 100 + Math.round((timeRem / totalTime) * 50) : 0;

          if (isCorrect) {
            p.streak++;
            p.correctCount++;
            p.score += pts;
          } else {
            p.streak = 0;
          }

          room.answers[p.id] = { optionIndex: chosenOpt, isCorrect, points: pts };
          document.getElementById('gameAnsweredStatusText').textContent = `Відповіло: ${Object.keys(room.answers).length} / ${Object.keys(room.players).length}`;

          if (Object.keys(room.answers).length >= Object.keys(room.players).length) {
            if (state.multi.timerInterval) clearInterval(state.multi.timerInterval);
            finishSimulatedRound();
          }
        }, delay);
        state.multi.botTimers.push(timer);
      }
    });
  }

  function handleSimulatedAnswer(selectedIdx, btnElement) {
    if (state.multi.hasAnsweredCurrent) return;
    state.multi.hasAnsweredCurrent = true;

    btnElement.classList.add('selected');
    const allBtns = document.querySelectorAll('#gameOptionsContainer .option-btn');
    allBtns.forEach(b => {
      if (b !== btnElement) b.disabled = true;
    });

    const room = state.multi.room;
    const q = room.questions[room.currentQuestionIndex];
    const isCorrect = selectedIdx === q.correctIndex;
    const player = room.players[state.multi.yourId];

    let points = 0;
    if (isCorrect) {
      player.streak++;
      player.correctCount++;
      const timeBonus = Math.round((state.multi.timeRemaining / room.timePerQuestion) * 50);
      const streakBonus = Math.min(player.streak * 10, 50);
      points = 100 + timeBonus + streakBonus;
      player.score += points;
    } else {
      player.streak = 0;
    }

    room.answers[state.multi.yourId] = {
      optionIndex: selectedIdx,
      isCorrect,
      points
    };

    document.getElementById('gameAnsweredStatusText').textContent = `Відповіло: ${Object.keys(room.answers).length} / ${Object.keys(room.players).length}`;

    if (Object.keys(room.answers).length >= Object.keys(room.players).length) {
      if (state.multi.timerInterval) clearInterval(state.multi.timerInterval);
      finishSimulatedRound();
    }
  }

  function finishSimulatedRound() {
    if (state.multi.timerInterval) clearInterval(state.multi.timerInterval);
    const room = state.multi.room;
    const q = room.questions[room.currentQuestionIndex];

    const allBtns = document.querySelectorAll('#gameOptionsContainer .option-btn');
    allBtns.forEach((b, idx) => {
      b.disabled = true;
      if (idx === q.correctIndex) {
        b.classList.add('correct');
      }
    });

    if (q.explanation) {
      document.getElementById('gameExplanationText').textContent = q.explanation;
      document.getElementById('gameExplanationBox').style.display = 'block';
    }

    const myAns = room.answers[state.multi.yourId];
    if (myAns && myAns.isCorrect) {
      window.soundController.playCorrect();
      showToast(`Правильно! +${myAns.points} очок`, 'success');
    } else {
      window.soundController.playIncorrect();
      showToast('Неправильна відповідь або час вийшов', 'error');
    }

    const myPlayer = room.players[state.multi.yourId];
    document.getElementById('gameScoreBadge').textContent = `🏆 ${myPlayer.score} очок`;

    setTimeout(() => {
      if (!state.multi.room) return;
      room.currentQuestionIndex++;
      if (room.currentQuestionIndex < room.questions.length) {
        runSimulatedQuestion();
      } else {
        finishSimulatedGame();
      }
    }, 4500);
  }

  function finishSimulatedGame() {
    const room = state.multi.room;
    room.status = 'ended';

    showScreen('screenResults');
    document.getElementById('multiplayerPodium').style.display = 'flex';
    document.getElementById('scoreBadgeCircle').style.display = 'none';

    const leaderboard = Object.values(room.players).map(p => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      score: p.score,
      correctCount: p.correctCount,
      accuracy: Math.round((p.correctCount / (room.questions.length || 1)) * 100)
    })).sort((a, b) => b.score - a.score);

    const myRankIdx = leaderboard.findIndex(p => p.id === state.multi.yourId);
    const myStats = leaderboard[myRankIdx] || { score: 0, correctCount: 0, accuracy: 0 };

    document.getElementById('resultsTitle').textContent = myRankIdx === 0 ? '👑 Ви перемогли в лобі!' : '🏁 Мультиплеєр завершено!';
    document.getElementById('resultsSubtitle').textContent = `Ваше місце в таблиці: #${myRankIdx + 1}`;

    if (leaderboard[0]) {
      document.getElementById('podium1').style.display = 'flex';
      document.getElementById('podium1Name').textContent = `${leaderboard[0].avatar} ${leaderboard[0].name} (${leaderboard[0].score})`;
    }
    if (leaderboard[1]) {
      document.getElementById('podium2').style.display = 'flex';
      document.getElementById('podium2Name').textContent = `${leaderboard[1].avatar} ${leaderboard[1].name} (${leaderboard[1].score})`;
    }
    if (leaderboard[2]) {
      document.getElementById('podium3').style.display = 'flex';
      document.getElementById('podium3Name').textContent = `${leaderboard[2].avatar} ${leaderboard[2].name} (${leaderboard[2].score})`;
    }

    document.getElementById('resTotalScore').textContent = myStats.score;
    document.getElementById('resCorrectCount').textContent = `${myStats.correctCount} / ${room.questions.length}`;
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
          <strong>#${idx + 1} ${p.avatar} ${p.name} ${p.id === state.multi.yourId ? '(Ви)' : ''}</strong>
          <div style="font-size: 0.8rem; color: var(--text-muted);">Точність: ${p.accuracy}% (${p.correctCount}/${room.questions.length})</div>
        </div>
        <div style="font-size: 1.2rem; font-weight: 800; color: var(--primary);">${p.score} очок</div>
      `;
      revContainer.appendChild(row);
    });

    const btnPlayAgain = document.getElementById('btnPlayAgain');
    btnPlayAgain.textContent = '🔄 Грати ще раз (Лобі)';
    btnPlayAgain.style.display = 'inline-flex';
  }

  function resetSimulatedRoom() {
    const room = state.multi.room;
    if (!room) return;
    room.status = 'waiting';
    room.currentQuestionIndex = 0;
    room.answers = {};
    Object.values(room.players).forEach(p => {
      p.score = 0;
      p.streak = 0;
      p.correctCount = 0;
    });
    renderWaitingRoom();
    showScreen('screenLobbyRoom');
    showToast('Повернення до лобі!', 'info');
  }

  function renderWaitingRoom() {
    const room = state.multi.room;
    if (!room) return;

    document.getElementById('roomTitleText').textContent = room.name;
    document.getElementById('roomCategoryText').textContent = room.categoryName;
    document.getElementById('roomQuestionCountText').textContent = `${room.questionCount} питань`;
    document.getElementById('roomTimeText').textContent = `${room.timePerQuestion}с`;
    document.getElementById('roomCodeDisplay').textContent = room.code;

    const playersArr = Object.values(room.players || {});
    document.getElementById('roomPlayerCount').textContent = playersArr.length;
    document.getElementById('roomMaxPlayers').textContent = room.maxPlayers;

    const playersList = document.getElementById('roomPlayersList');
    playersList.innerHTML = '';

    playersArr.forEach(p => {
      const card = document.createElement('div');
      card.className = `player-slot-card ${p.isReady ? 'is-ready' : ''}`;
      card.innerHTML = `
        ${p.isHost ? '<span class="host-badge">👑 ХОСТ</span>' : ''}
        <div class="avatar-big">${p.avatar}</div>
        <div class="p-name">${p.name} ${p.id === state.multi.yourId ? '(Ви)' : ''}</div>
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
    }
  }

  // -------------------------------------------------------------
  // REALTIME SOCKET LISTENERS (FOR SERVER MODE)
  // -------------------------------------------------------------
  if (socket) {
    socket.on('lobbies_update', (list) => {
      state.multi.lobbiesList = list;
      renderLobbiesList(list);
    });

    socket.on('lobby_created', (data) => {
      state.multi.room = data.room;
      state.multi.yourId = data.yourId;
      state.multi.isHost = true;
      state.multi.isSimulated = false;
      renderWaitingRoom();
      showScreen('screenLobbyRoom');
      showToast('Лобі успішно створено!', 'success');
    });

    socket.on('lobby_joined', (data) => {
      state.multi.room = data.room;
      state.multi.yourId = data.yourId;
      state.multi.isHost = (data.room.hostId === data.yourId);
      state.multi.isSimulated = false;
      renderWaitingRoom();
      showScreen('screenLobbyRoom');
      showToast('Ви приєдналися до кімнати!', 'success');
    });

    socket.on('room_updated', (room) => {
      state.multi.room = room;
      state.multi.isHost = (room.hostId === socket.id);
      renderWaitingRoom();
    });

    socket.on('chat_message', (msg) => {
      addChatMessage(msg);
    });

    socket.on('start_countdown', (data) => {
      countdownOverlay.style.display = 'flex';
      countdownNum.textContent = data.count > 0 ? data.count : 'GO!';
      if (data.count > 0) {
        window.soundController.playCountdownTick();
      } else {
        window.soundController.playStartBeep();
      }
    });

    socket.on('game_started', (data) => {
      countdownOverlay.style.display = 'none';
      showScreen('screenGame');
      document.getElementById('soloNextBtnContainer').style.display = 'none';
      document.getElementById('gameLiveIndicator').style.display = 'flex';
      state.multi.totalQuestions = data.totalQuestions;
      state.multi.timeLimit = data.timePerQuestion;
      state.multi.hasAnsweredCurrent = false;
    });

    socket.on('new_question', (data) => {
      state.multi.currentQuestionIndex = data.questionIndex;
      state.multi.hasAnsweredCurrent = false;
      document.getElementById('gameExplanationBox').style.display = 'none';

      document.getElementById('gameCategoryBadge').textContent = data.categoryName || 'Тест';
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
          if (state.multi.hasAnsweredCurrent) return;
          state.multi.hasAnsweredCurrent = true;
          btn.classList.add('selected');
          document.querySelectorAll('#gameOptionsContainer .option-btn').forEach(b => { if (b !== btn) b.disabled = true; });

          socket.emit('submit_answer', {
            questionIndex: data.questionIndex,
            selectedOption: optIdx,
            timeRemaining: state.multi.timeRemaining
          });
        });
        optContainer.appendChild(btn);
      });

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
    });

    socket.on('player_answered', (data) => {
      document.getElementById('gameAnsweredStatusText').textContent = `Відповіло: ${data.answeredCount} / ${data.totalPlayers}`;
    });

    socket.on('question_result', (data) => {
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

      const myResult = data.leaderboard.find(p => p.id === socket.id);
      if (myResult) {
        document.getElementById('gameScoreBadge').textContent = `🏆 ${myResult.currentScore} очок`;
        if (myResult.isCorrect) {
          window.soundController.playCorrect();
        } else {
          window.soundController.playIncorrect();
        }
      }
    });

    socket.on('game_over', (data) => {
      showScreen('screenResults');
      document.getElementById('multiplayerPodium').style.display = 'flex';
      document.getElementById('scoreBadgeCircle').style.display = 'none';

      const leaderboard = data.leaderboard || [];
      const myRankIdx = leaderboard.findIndex(p => p.id === socket.id);
      const myStats = leaderboard[myRankIdx] || { score: 0, correctCount: 0, accuracy: 0 };

      document.getElementById('resultsTitle').textContent = myRankIdx === 0 ? '👑 Ви перемогли!' : '🏁 Гра завершена!';
      document.getElementById('resultsSubtitle').textContent = `Ваше місце в турнірній таблиці: #${myRankIdx + 1}`;

      if (leaderboard[0]) {
        document.getElementById('podium1').style.display = 'flex';
        document.getElementById('podium1Name').textContent = `${leaderboard[0].avatar} ${leaderboard[0].name} (${leaderboard[0].score})`;
      }
      if (leaderboard[1]) {
        document.getElementById('podium2').style.display = 'flex';
        document.getElementById('podium2Name').textContent = `${leaderboard[1].avatar} ${leaderboard[1].name} (${leaderboard[1].score})`;
      }
      if (leaderboard[2]) {
        document.getElementById('podium3').style.display = 'flex';
        document.getElementById('podium3Name').textContent = `${leaderboard[2].avatar} ${leaderboard[2].name} (${leaderboard[2].score})`;
      }

      document.getElementById('resTotalScore').textContent = myStats.score;
      document.getElementById('resCorrectCount').textContent = `${myStats.correctCount} / ${data.questionCount}`;
      document.getElementById('resAccuracy').textContent = `${myStats.accuracy}%`;

      window.soundController.playVictory();
      if (typeof confetti === 'function') {
        confetti({ particleCount: 150, spread: 80, origin: { y: 0.5 } });
      }

      const revContainer = document.getElementById('reviewItemsContainer');
      revContainer.innerHTML = '<h4>🏆 Підсумкова таблиця кімнати:</h4>';
      leaderboard.forEach((p, idx) => {
        const row = document.createElement('div');
        row.className = 'review-item';
        row.style.display = 'flex';
        row.style.justifyContent = 'space-between';
        row.style.alignItems = 'center';
        row.innerHTML = `
          <div>
            <strong>#${idx + 1} ${p.avatar} ${p.name} ${p.id === socket.id ? '(Ви)' : ''}</strong>
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
    });

    socket.on('room_reset', (room) => {
      state.multi.room = room;
      renderWaitingRoom();
      showScreen('screenLobbyRoom');
      showToast('Хост повернув усіх до лобі!', 'info');
    });

    socket.on('error_msg', (data) => {
      showToast(data.message || 'Сталася помилка', 'error');
    });
  }

  // Initial Load
  initUser();
  loadCategories();
  fetchLobbies();
});
