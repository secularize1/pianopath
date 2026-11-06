(() => {
  const DATA = window.PIANO_DATA;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const STORAGE_KEY = 'pianopath-state-v1';
  const DAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
  const PHASE_COLORS = { '起步': '#5bbd78', '基础 I': '#f3cf66', '基础 II': '#ef8d78', '进阶 I': '#7ab6d9', '进阶 II': '#9d8ad6', '巩固': '#6eb98b', '展示': '#1f2a24' };
  const MASTERY_PASS_PERCENT = 67;

  const defaultState = {
    profile: { weeklyMinutes: 240, daysPerWeek: 4, sessionMinutes: 60, level: 'zero', style: 'mixed', goal: '', startWeek: 1 },
    completed: {},
    history: [],
    activeSession: null,
    gameSessions: [],
    repertoire: {},
    placement: null,
    quickPractice: null,
    mastery: {},
    playAlong: {},
    serverPlan: null,
    settingsSource: 'local'
  };

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return structuredClone(defaultState);
      const parsed = JSON.parse(raw);
      return { ...structuredClone(defaultState), ...parsed, profile: { ...defaultState.profile, ...(parsed.profile || {}) } };
    } catch (error) {
      console.warn('Could not load local state', error);
      return structuredClone(defaultState);
    }
  }

  const state = loadState();
  const savedTheme = localStorage.getItem('pianopath-theme');
  if (savedTheme === 'dark' || (!savedTheme && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.dataset.theme = 'dark';
  }
  let activePage = 'today';
  let currentPhase = '全部';
  let currentTopic = '国内可用';
  let repertoireFilter = '全部';
  let repertoireSearch = '';
  let searchTerm = '';
  let lessonSession = null;
  let lessonStepIndex = 0;
  let lessonTimer = null;
  let lessonRemaining = 0;
  let lessonPaused = false;
  let lessonStartedAt = null;
  let currentRating = 3;
  let backendAvailable = false;

  function persist(options = {}) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (window.PIANO_ACCOUNT && window.PIANO_ACCOUNT.loggedIn && options.sync !== false) {
      window.PIANO_ACCOUNT.queueSync();
    }
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function resourceById(id) {
    return DATA.resources.videos.find((resource) => resource.id === id);
  }

  function localDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function parseLocalDate(value) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function dateFromOffset(offset) {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + offset);
    return date;
  }

  function formatChineseDate(date = new Date()) {
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    return `${date.getMonth() + 1} 月 ${date.getDate()} 日 · 星期${weekdays[date.getDay()]}`;
  }

  function greetingForHour(hour) {
    if (hour < 6) return '夜深了，练琴人';
    if (hour < 12) return '早上好，练琴人';
    if (hour < 18) return '下午好，练琴人';
    return '晚上好，练琴人';
  }

  function getPlanProfile() {
    const days = Math.max(1, Number(state.profile.daysPerWeek) || 4);
    const sessionMinutes = Math.max(10, Number(state.profile.sessionMinutes) || 60);
    return { ...state.profile, daysPerWeek: days, sessionMinutes, weeklyMinutes: days * sessionMinutes };
  }

  function completedEntry(sessionId) {
    return state.completed[sessionId] || null;
  }

  function isComplete(sessionId) {
    return Boolean(completedEntry(sessionId));
  }

  function isNormalLesson(session) {
    return Boolean(session && !session.quick && !session.repertoireId);
  }

  function masteryPassed(sessionId) {
    const mastery = state.mastery?.[sessionId];
    return Boolean(mastery && Number(mastery.best) >= MASTERY_PASS_PERCENT);
  }

  function splitMinutes(total, count) {
    if (!count) return [];
    const base = Math.floor(total / count);
    const remainder = total - base * count;
    return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
  }

  function adaptSteps(baseSession, minutes) {
    const baseTotal = baseSession.steps.reduce((sum, step) => sum + Number(step.minutes || 0), 0) || 60;
    const raw = baseSession.steps.map((step) => Math.max(1, (Number(step.minutes || 0) / baseTotal) * minutes));
    const rounded = raw.map((value) => Math.max(1, Math.round(value)));
    let sum = rounded.reduce((a, b) => a + b, 0);
    let delta = minutes - sum;
    if (delta !== 0) {
      const order = raw.map((value, index) => ({ index, fraction: value - Math.floor(value) })).sort((a, b) => delta > 0 ? b.fraction - a.fraction : a.fraction - b.fraction);
      let cursor = 0;
      const direction = delta > 0 ? 1 : -1;
      while (delta !== 0) {
        const item = order[cursor % order.length];
        if (rounded[item.index] + direction >= 1) {
          rounded[item.index] += direction;
          delta -= direction;
        }
        cursor += 1;
      }
    }
    let start = 0;
    return baseSession.steps.map((step, index) => {
      const duration = rounded[index];
      const item = { ...step, start, end: start + duration, minutes: duration };
      start += duration;
      return item;
    });
  }

  function sessionIndicesForDays(days, baseLength) {
    if (days <= baseLength) {
      if (days === baseLength) return Array.from({ length: days }, (_, index) => index);
      if (days === 1) return [0];
      return Array.from({ length: days }, (_, index) => Math.round((index * (baseLength - 1)) / (days - 1)));
    }
    return Array.from({ length: days }, (_, index) => index % baseLength);
  }

  function sessionsForWeek(week) {
    const profile = getPlanProfile();
    const indices = sessionIndicesForDays(profile.daysPerWeek, week.sessions.length);
    return indices.map((baseIndex, index) => {
      const base = week.sessions[baseIndex];
      const duplicate = profile.daysPerWeek > week.sessions.length && index >= week.sessions.length;
      return {
        ...base,
        id: duplicate ? `${base.id}-p${index + 1}` : base.id,
        day: index + 1,
        duration: profile.sessionMinutes,
        steps: adaptSteps(base, profile.sessionMinutes),
        adapted: profile.sessionMinutes !== 60 || profile.daysPerWeek !== 4
      };
    });
  }

  function allSessions() {
    return DATA.weeks.flatMap(sessionsForWeek);
  }

  function currentWeekData() {
    const startWeek = Math.max(1, Math.min(DATA.weeks.length, Number(state.profile.startWeek) || 1));
    for (const rawWeek of DATA.weeks) {
      const weekId = rawWeek.id ?? rawWeek.n;
      if (weekId < startWeek) continue;
      const week = { ...rawWeek, id: weekId };
      const sessions = sessionsForWeek(week);
      if (sessions.some((session) => !isComplete(session.id))) return { week, sessions };
    }
    const rawWeek = DATA.weeks[DATA.weeks.length - 1];
    const week = { ...rawWeek, id: rawWeek.id ?? rawWeek.n };
    return { week, sessions: sessionsForWeek(week) };
  }

  function currentSessionData() {
    const current = currentWeekData();
    return current.sessions.find((session) => !isComplete(session.id)) || current.sessions[0] || null;
  }

  function findSession(sessionId) {
    for (const week of DATA.weeks) {
      const found = sessionsForWeek(week).find((session) => session.id === sessionId);
      if (found) return found;
    }
    return null;
  }

  function uniquePracticeDays() {
    return [...new Set(state.history.map((entry) => entry.date))].sort().reverse();
  }

  function streakCount() {
    const days = new Set(uniquePracticeDays());
    if (!days.size) return 0;
    let cursor = new Date();
    cursor.setHours(12, 0, 0, 0);
    if (!days.has(localDateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
    let count = 0;
    while (days.has(localDateKey(cursor))) {
      count += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return count;
  }

  function completedThisWeek() {
    const monday = new Date();
    monday.setHours(12, 0, 0, 0);
    const offset = (monday.getDay() + 6) % 7;
    monday.setDate(monday.getDate() - offset);
    const keys = new Set();
    for (let index = 0; index < 7; index += 1) {
      const date = new Date(monday);
      date.setDate(monday.getDate() + index);
      keys.add(localDateKey(date));
    }
    return state.history.filter((entry) => keys.has(entry.date));
  }

  function minutesForDate(key) {
    return state.history.filter((entry) => entry.date === key).reduce((sum, entry) => sum + Number(entry.minutes || 0), 0);
  }

  function totalMinutes() {
    return state.history.reduce((sum, entry) => sum + Number(entry.minutes || 0), 0);
  }

  function totalXp() {
    const completedLessons = Object.keys(state.completed).length;
    const repertoirePhases = Object.values(state.repertoire || {}).reduce((sum, item) => sum + (Number(item.phaseIndex) || 0), 0);
    const playAlongXp = Object.values(state.playAlong || {}).reduce((sum, item) => sum + (Number(item.xp) || 0), 0);
    const practiceXp = Math.floor(totalMinutes() / 5);
    return completedLessons * 20 + repertoirePhases * 15 + playAlongXp + practiceXp;
  }

  function levelForXp(xp) {
    const level = Math.max(1, Math.floor(Number(xp || 0) / 100) + 1);
    const intoLevel = Number(xp || 0) % 100;
    return { level, intoLevel, nextLevelAt: 100, progress: intoLevel };
  }


  function renderSidebar() {
    const streak = streakCount();
    const topStreak = document.querySelector('#topStreak');
    const sideStreak = document.querySelector('#sideStreak');
    if (topStreak) topStreak.textContent = streak;
    if (sideStreak) sideStreak.textContent = streak;
    const today = new Date();
    const monday = new Date(today);
    monday.setHours(12, 0, 0, 0);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    const practiced = new Set(state.history.map((entry) => entry.date));
    const dots = document.querySelector('#sideWeekDots');
    if (dots) {
      dots.innerHTML = DAY_LABELS.map((label, index) => {
        const date = new Date(monday);
        date.setDate(monday.getDate() + index);
        const done = practiced.has(localDateKey(date));
        const isToday = localDateKey(date) === localDateKey(today);
        return `<span class="streak-day ${done ? 'done' : ''}" title="${label}"><i>${done ? '✓' : isToday ? '•' : ''}</i>${label}</span>`;
      }).join('');
    }
  }

  function renderHeader() {
    const now = new Date();
    $('#todayDate').textContent = formatChineseDate(now);
    $('#greeting').textContent = greetingForHour(now.getHours());
  }

  function renderDashboard() {
    const { week, sessions } = currentWeekData();
    const session = currentSessionData();
    const weekDone = sessions.filter((item) => isComplete(item.id)).length;
    const current = session || sessions[0];

    if (current) {
      const setText = (selector, value) => { const element = document.querySelector(selector); if (element) element.textContent = value; };
      setText('#homeStage', `第 ${current.week} 周 · ${week.phase}`);
      const resumable = state.activeSession && state.activeSession.id === current.id;
      setText('#homeLessonIndex', resumable ? `继续 · 第 ${current.week} 周 · 第 ${current.day} 次` : `第 ${current.week} 周 · 第 ${current.day} 次`);
      setText('#homeLessonTitle', current.title);
      setText('#homeLessonGoal', current.goal);
      setText('#homeLessonDuration', `${current.duration} 分钟`);
      setText('#homeWeekProgress', `${weekDone} / ${sessions.length}`);
      setText('#homeArtWeek', `${weekDone} / ${sessions.length}`);

    }

    const trail = document.querySelector('#homeWeekTrail');
    if (trail) {
      trail.innerHTML = sessions.map((item, index) => {
        const done = isComplete(item.id);
        const isCurrent = current && item.id === current.id;
        const locked = !done && !isCurrent;
        const stepLabel = ['学', '练', '合', '录'][index % 4] || String(index + 1);
        return `<button class="week-trail-item ${done ? 'done' : ''} ${isCurrent ? 'current' : ''} ${locked ? 'locked' : ''}" data-session="${escapeHtml(item.id)}" type="button" ${locked ? 'aria-disabled="true" tabindex="-1"' : ''}>
          <span class="trail-node">${done ? '✓' : stepLabel}</span>
          <span class="trail-copy"><small>第 ${item.day} 次 · ${item.duration} 分钟</small><strong>${escapeHtml(item.title)}</strong><em>${escapeHtml(item.goal)}</em></span>
          ${isCurrent ? '<span class="trail-now">现在</span>' : ''}
        </button>`;
      }).join('');
    }

    const todayKey = localDateKey(new Date());
    const gameToday = (state.gameSessions || []).filter((item) => item.date === todayKey);
    const playAlongToday = state.history.filter((entry) => entry.date === todayKey && entry.type === 'playalong');
    const todayMinutes = minutesForDate(todayKey);
    const todayLesson = state.history.some((entry) => entry.date === todayKey && !['game', 'lesson-practice', 'playalong'].includes(entry.type));
    const todayGame = gameToday.length > 0 || playAlongToday.length > 0;
    const quests = [
      { done: todayLesson, label: '完成 1 次课程练习', detail: todayLesson ? '已完成' : '开始今日课程' },
      { done: todayGame, label: '完成一次听辨或跟弹', detail: gameToday.length || playAlongToday.length ? `今日 ${gameToday.length + playAlongToday.length} 局` : '约 2 分钟' },
      { done: todayMinutes >= 20, label: '累计练习 20 分钟', detail: `${Math.min(todayMinutes, 20)} / 20 分钟` }
    ];
    const questList = document.querySelector('#dailyQuestList');
    if (questList) {
      questList.innerHTML = quests.map((quest) => `<div class="daily-quest ${quest.done ? 'done' : ''}"><span class="quest-check">${quest.done ? '✓' : ''}</span><span><strong>${escapeHtml(quest.label)}</strong><small>${escapeHtml(quest.detail)}</small></span></div>`).join('');
      const questCount = document.querySelector('#dailyQuestCount');
      if (questCount) questCount.textContent = `${quests.filter((quest) => quest.done).length} / 3`;
    }

    const currentId = current?.id;
    const currentMastery = currentId ? state.mastery?.[currentId] : null;
    const mainDone = Boolean(todayLesson);
    const checkDone = Boolean(mainDone && currentMastery && Number(currentMastery.best) >= MASTERY_PASS_PERCENT);
    const activityDone = todayMinutes > 0 || todayGame;
    const routeMain = document.querySelector('#routeMain');
    const routeCheck = document.querySelector('#routeCheck');
    const routeDone = document.querySelector('#routeDone');
    if (routeMain) routeMain.className = mainDone ? 'done' : 'active';
    if (routeCheck) routeCheck.className = checkDone ? 'done' : mainDone ? 'active' : '';
    if (routeDone) routeDone.className = activityDone ? 'done' : checkDone ? 'active' : '';

    const best = localStorage.getItem('pianopath-note-game-best') || localStorage.getItem('pianopath-ear-game-best');
    const gameBest = document.querySelector('#homeGameBest');
    if (gameBest) gameBest.textContent = best ? `${best} 分` : '—';
  }

  function renderPath() {
    const current = currentWeekData().week.id;
    $('#phaseTabs').innerHTML = ['全部', ...DATA.phases].map((phase) => `<button class="phase-tab ${currentPhase === phase ? 'active' : ''}" data-phase="${escapeHtml(phase)}">${escapeHtml(phase)}</button>`).join('');
    const filtered = DATA.weeks.filter((week) => currentPhase === '全部' || week.phase === currentPhase);
    $('#journey').innerHTML = filtered.map((week) => {
      const weekNumber = week.id ?? week.n;
      const sessions = sessionsForWeek({ ...week, id: weekNumber });
      const done = sessions.filter((session) => isComplete(session.id)).length;
      const locked = weekNumber > current;
      const nodeClass = done === sessions.length ? 'done' : weekNumber === current ? 'current' : '';
      const tags = [week.technique, week.sight].slice(0, 2).map((tag) => `<span class="week-tag">${escapeHtml(tag.split('；')[0])}</span>`).join('');
      const firstOpenIndex = sessions.findIndex((session) => !isComplete(session.id));
      const dayButtons = sessions.map((session, sessionIndex) => {
        const dayLocked = locked || (sessionIndex > firstOpenIndex && firstOpenIndex !== -1 && !isComplete(session.id));
        return `<button class="week-day-btn ${isComplete(session.id) ? 'done' : ''} ${dayLocked ? 'locked' : ''}" data-session="${escapeHtml(session.id)}" ${dayLocked ? 'aria-disabled="true" tabindex="-1"' : ''}><strong>${isComplete(session.id) ? '✓ ' : ''}${escapeHtml(session.title)}</strong><span>${session.duration} 分钟 · ${escapeHtml(session.goal)}</span></button>`;
      }).join('');
      return `<div class="week-row"><div class="week-node ${nodeClass}">${done === sessions.length ? '✓' : String(weekNumber).padStart(2, '0')}</div><article class="week-panel ${locked ? 'locked' : ''}"><div class="week-panel-head"><div><span class="eyebrow">${escapeHtml(week.phase)}</span><h3>${escapeHtml(week.title)}</h3><p>${escapeHtml(week.goal)}</p><div class="week-tags">${tags}</div></div><div class="week-meta"><strong>${done} / ${sessions.length}</strong>完成</div></div><div class="week-days">${dayButtons}</div></article></div>`;
    }).join('');
    renderStages();
  }

  function renderStages() {
    const stageGrid = $('#stageGrid');
    if (!stageGrid) return;
    const colors = { mint: '#5bbd78', sun: '#d6ad2f', coral: '#e6806a', violet: '#9581ce', ink: '#4d6856' };
    stageGrid.innerHTML = (DATA.stages || []).map((stage, index) => `<article class="stage-card" style="--stage-color:${colors[stage.color] || colors.mint}"><div class="stage-rank"><span>${escapeHtml(stage.range)}</span><em>${escapeHtml(stage.grade)}</em></div><h3>${escapeHtml(stage.label)}</h3><p>${escapeHtml(stage.description)}</p><ul>${(stage.goals || []).map((goal) => `<li>${escapeHtml(goal)}</li>`).join('')}</ul></article>`).join('');
    $('#masteryFootnote').textContent = DATA.masteryNote || '';
  }

  function renderLibrary(nextTopic, nextSearch) {
    if (nextTopic !== undefined) currentTopic = nextTopic;
    if (nextSearch !== undefined) searchTerm = nextSearch;
    const topicMap = {
      '国内可用': (item) => item.region === 'cn' || item.region === 'institution',
      '全部来源': () => true,
      '入门': (item) => item.topics.some((topic) => /入门|基础|第一课|成人|零基础/.test(topic)),
      '技巧': (item) => item.topics.some((topic) => /技术|音阶|指法|双手|协调|哈农|琶音|踏板/.test(topic)),
      '视奏': (item) => item.topics.some((topic) => /视奏|读谱/.test(topic)),
      '和弦': (item) => item.topics.some((topic) => /和弦|伴奏|流行|即兴/.test(topic)),
      '方法': (item) => item.topics.some((topic) => /方法|练习法|慢练|拆段|路线/.test(topic))
    };
    const topics = DATA.resources.filters || Object.keys(topicMap);
    if (!topicMap[currentTopic]) currentTopic = DATA.resources.defaultFilter || '国内可用';
    $('#topicFilters').innerHTML = topics.map((topic) => `<button class="filter-chip ${currentTopic === topic ? 'active' : ''}" data-topic="${escapeHtml(topic)}">${escapeHtml(topic)}</button>`).join('');
    const filtered = DATA.resources.videos.filter((item) => {
      const matchTopic = (topicMap[currentTopic] || topicMap['全部来源'])(item);
      const haystack = `${item.creator} ${item.title} ${item.description} ${(item.topics || []).join(' ')}`.toLowerCase();
      return matchTopic && (!searchTerm || haystack.includes(searchTerm.toLowerCase()));
    });
    $('#resourceGrid').innerHTML = filtered.map((item) => `<article class="resource-card ${item.supplement ? 'supplement' : ''}"><div class="resource-image"><img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 1200 675%27%3E%3Crect width=%271200%27 height=%27675%27 fill=%27%23edf2e9%27/%3E%3Ctext x=%27600%27 y=%27340%27 text-anchor=%27middle%27 font-family=%27sans-serif%27 font-size=%2724%27 fill=%27%236f8975%27%3E琴阶 PianoPath%3C/text%3E%3C/svg%3E'"><span class="resource-platform">${escapeHtml(item.platform === 'Bilibili' ? 'B站 · 国内可看' : item.platform)}</span>${item.supplement ? '<span class="resource-badge">补充资源</span>' : ''}</div><div class="resource-body"><div class="resource-author"><strong>${escapeHtml(item.creator)}</strong><span>${item.region === 'global' ? '海外补充' : '国内可用'}</span></div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p><div class="resource-footer"><span>${escapeHtml(item.duration || '')} · ${escapeHtml(item.credential || '系统课程')}</span><a href="${escapeHtml(item.url)}" data-video="${escapeHtml(item.id)}">预览来源 ↗</a></div></div></article>`).join('') || `<div class="empty-history">当前筛选下没有匹配来源。</div>`;

    $('#methodGrid').innerHTML = DATA.resources.methodBooks.map((book) => `<article class="method-card"><div class="method-icon">${book.type.includes('曲谱') ? '♬' : book.type.includes('教材') ? '▤' : '§'}</div><div><strong>${escapeHtml(book.name)}</strong><span>${escapeHtml(book.note)}</span></div><a href="${escapeHtml(book.url)}" target="_blank" rel="noreferrer noopener">查看 ↗</a></article>`).join('');
  }

  function repertoireProgress(piece) {
    const progress = state.repertoire?.[piece.id] || null;
    const phases = piece.phases || [];
    const phaseIndex = Math.min(phases.length, Math.max(0, Number(progress?.phaseIndex) || 0));
    return {
      progress,
      phases,
      phaseIndex,
      completed: phaseIndex >= phases.length,
      percent: phases.length ? Math.round((phaseIndex / phases.length) * 100) : 0
    };
  }

  function renderRepertoire(nextFilter, nextSearch) {
    if (nextFilter !== undefined) repertoireFilter = nextFilter;
    if (nextSearch !== undefined) repertoireSearch = nextSearch;
    const grid = document.querySelector('#repertoireGrid');
    if (!grid) return;
    const groups = ['全部', '入门', '初级', '中级', '高级', '已完成'];
    const filterContainer = document.querySelector('#repertoireFilters');
    if (filterContainer) {
      filterContainer.innerHTML = groups.map((group) => `<button type="button" class="filter-chip ${group === repertoireFilter ? 'active' : ''}" data-repertoire-filter="${escapeHtml(group)}">${escapeHtml(group)}</button>`).join('');
    }
    const pieces = (DATA.repertoire || []).filter((piece) => {
      const progress = repertoireProgress(piece);
      if (repertoireFilter === '已完成' && !progress.completed) return false;
      if (repertoireFilter !== '全部' && repertoireFilter !== '已完成' && !piece.level.includes(repertoireFilter)) return false;
      const haystack = `${piece.title} ${piece.composer} ${piece.level} ${piece.grade} ${(piece.skills || []).join(' ')}`.toLowerCase();
      return !repertoireSearch || haystack.includes(repertoireSearch.toLowerCase());
    });
    const count = document.querySelector('#repertoireCount');
    if (count) count.textContent = String(pieces.length);
    grid.innerHTML = pieces.length ? pieces.map((piece) => {
      const progress = repertoireProgress(piece);
      const phaseText = progress.completed ? '已完成全部阶段' : progress.phaseIndex > 0 ? `正在练：${progress.phases[progress.phaseIndex]}` : '准备开始';
      return `<article class="repertoire-card ${progress.completed ? 'completed' : ''}" style="--repertoire-color:${({mint:'#5bbd78',sun:'#d6ad2f',coral:'#e6806a',sky:'#67acd1',violet:'#9581ce',rose:'#d68691',orange:'#d9914f',teal:'#5baaa0',slate:'#7b8c9e',indigo:'#6f7fc2'}[piece.color] || '#5bbd78')}">
        <div class="repertoire-card-main">
          <div class="repertoire-head"><div><h3>${escapeHtml(piece.title)}</h3><p>${escapeHtml(piece.composer)}</p></div><span class="repertoire-grade">${escapeHtml(piece.grade)}</span></div>
          <p class="repertoire-desc">${escapeHtml(piece.description)}</p>
          <div class="repertoire-skills">${(piece.skills || []).map((skill) => `<span>${escapeHtml(skill)}</span>`).join('')}</div>
          <div class="repertoire-progress"><div class="repertoire-progress-top"><span>${escapeHtml(phaseText)}</span><strong>${progress.percent}%</strong></div><div class="repertoire-progress-bar"><i style="width:${progress.percent}%"></i></div></div>
        </div>
        <div class="repertoire-actions"><button type="button" class="btn btn-soft" data-repertoire-open="${escapeHtml(piece.id)}">${progress.completed ? '复盘曲目' : progress.phaseIndex > 0 ? '继续曲目' : '开始曲目'}</button><a class="text-button" href="${escapeHtml(piece.score)}" target="_blank" rel="noreferrer noopener">公共曲谱 ↗</a></div>
      </article>`;
    }).join('') : '<div class="empty-history">没有匹配的曲目，换个难度试试。</div>';
  }

  function computeSkillProfile() {
    const completedLessons = Object.keys(state.completed || {}).length;
    const masteryValues = Object.values(state.mastery || {});
    const avgMastery = masteryValues.length ? masteryValues.reduce((sum, item) => sum + (Number(item.best) || 0), 0) / masteryValues.length : 0;
    const repertoirePhases = Object.values(state.repertoire || {}).reduce((sum, item) => sum + (Number(item.phaseIndex) || 0), 0);
    const sightEntries = (state.history || []).filter((entry) => Number(entry.sightDone) > 0).length;
    const gameSessions = (state.gameSessions || []).length;
    const playAlongSessions = Object.values(state.playAlong || {}).length;
    const playAlongAccuracy = Object.values(state.playAlong || {}).reduce((sum, item) => sum + (Number(item.bestAccuracy) || 0), 0) / Math.max(1, playAlongSessions);
    const reviewEntries = (state.history || []).filter((entry) => entry.type !== 'game' && (entry.rating <= 2 || entry.notes)).length;
    const read = Math.min(100, Math.round(sightEntries * 4 + avgMastery * 0.35 + completedLessons * 1.5));
    const technique = Math.min(100, Math.round(completedLessons * 4 + avgMastery * 0.45 + playAlongSessions * 2));
    const repertoire = Math.min(100, Math.round(repertoirePhases * 12 + completedLessons * 2));
    const ear = Math.min(100, Math.round(gameSessions * 6 + playAlongAccuracy * 0.12 + playAlongSessions * 2 + avgMastery * 0.2));
    const skills = [
      { key: 'read', label: '读谱', value: read, detail: sightEntries ? `${sightEntries} 次视奏` : '还没开始' },
      { key: 'technique', label: '技术', value: technique, detail: completedLessons || playAlongSessions ? `${completedLessons} 课 · ${playAlongSessions} 次跟弹` : '建立基线' },
      { key: 'repertoire', label: '曲目', value: repertoire, detail: repertoirePhases ? `${repertoirePhases} 个阶段` : '选择一首曲子' },
      { key: 'ear', label: '听觉', value: ear, detail: gameSessions || playAlongSessions ? `${gameSessions} 次听辨 · ${playAlongSessions} 次跟弹` : '去玩音名游戏' }
    ];
    const weakest = [...skills].sort((a, b) => a.value - b.value)[0];
    return { skills, weakest, avgMastery, completedLessons, reviewEntries };
  }

  function renderSkillReport() {
    const grid = document.querySelector('#skillReportGrid');
    if (!grid) return;
    const report = computeSkillProfile();
    document.querySelector('#skillLevel').textContent = `Lv.${window.PIANO_APP.levelForXp(window.PIANO_APP.totalXp()).level}`;
    document.querySelector('#skillReportNote').textContent = report.avgMastery ? `掌握检查平均 ${Math.round(report.avgMastery)}% · 共 ${report.completedLessons} 课` : '完成练习和掌握检查后，这里会更新。';
    grid.innerHTML = report.skills.map((skill) => `<div class="skill-meter"><div class="skill-meter-top"><span>${skill.label}</span><strong>${skill.value}%</strong></div><div class="skill-meter-bar"><i style="width:${skill.value}%"></i></div><small>${skill.detail}</small></div>`).join('');
    const focus = report.weakest.key === 'read' ? '先做一次视奏，建立读谱基线。' : report.weakest.key === 'technique' ? '先完成当前课程的技术闭环。' : report.weakest.key === 'repertoire' ? '从曲目库选一首 0–1 级曲子开始。' : '去玩一次听声音辨音。';
    document.querySelector('#skillFocusText').textContent = focus;
    document.querySelector('#skillFocusButton').dataset.skillFocus = report.weakest.key;
  }

  function renderStats() {
    renderSkillReport();
    const total = totalMinutes();
    const sessions = Object.keys(state.completed).length;
    const sight = state.history.filter((entry) => Number(entry.sightDone || 0) > 0).length;
    $('#statMinutes').innerHTML = `${total} <small>分钟</small>`;
    $('#statMinutesHint').textContent = total ? `约 ${(total / 60).toFixed(1)} 小时` : '从今天开始';
    $('#statStreak').innerHTML = `${streakCount()} <small>天</small>`;
    $('#statSessions').innerHTML = `${sessions} <small>/ 48</small>`;
    $('#statSessionsHint').textContent = sessions ? `完成率 ${Math.round((sessions / 48) * 100)}%` : '第一周还在等你';
    $('#statSight').innerHTML = `${sight} <small>次</small>`;

    const reviewEntries = (state.history || []).filter((entry) => entry.type !== 'game' && (entry.rating <= 2 || entry.notes));
    const reviewList = document.querySelector('#reviewList');
    if (reviewList) {
      const unique = [];
      const seen = new Set();
      for (const entry of reviewEntries) {
        const key = entry.id;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(entry);
        if (unique.length >= 4) break;
      }
      reviewList.innerHTML = unique.length ? unique.map((entry, index) => `<button type="button" class="review-item" data-review-index="${index}"><span class="review-number">${index + 1}</span><span><strong>${escapeHtml(entry.title.replace('5 分钟快练：',''))}</strong><small>${entry.rating <= 2 ? '上次感觉有点卡 · ' : ''}${escapeHtml(entry.notes || '重练最不稳的两小节')}</small></span><em>复习 →</em></button>`).join('') : '<div class="review-empty">完成一次课程后，这里会出现需要回练的内容。</div>';
      document.querySelector('#reviewCount').textContent = `${unique.length} 项`;
      reviewList.querySelectorAll('[data-review-index]').forEach((button) => button.addEventListener('click', () => {
        const entry = unique[Number(button.dataset.reviewIndex)];
        const sourceId = entry.sourceId || entry.id.replace(/-quick$/, '').replace(/-review-.*$/, '');
        const found = window.PIANO_APP.findSession(sourceId);
        const piece = (window.PIANO_APP.DATA.repertoire || []).find((item) => item.id === sourceId);
        const source = found || piece;
        if (source) {
          const reviewSession = { ...source, id: `${source.id}-review-${Date.now()}`, sourceId: source.id, title: `复习：${source.title}`, duration: 10, quick: true, steps: [
            { start: 0, end: 2, minutes: 2, title: '旧问题定位', category: '复习', detail: entry.notes || '先找到上次最不稳的两小节。', cue: '不从头弹' },
            { start: 2, end: 7, minutes: 5, title: '慢速重练', category: '技术', detail: found?.steps?.[2]?.detail || source.goal, cue: '分手、慢速、连续三次正确' },
            { start: 7, end: 9, minutes: 2, title: '接回前后连接', category: '曲目', detail: '从问题小节前一小节进入，再接到后一小节。', cue: '连接比单点更重要' },
            { start: 9, end: 10, minutes: 1, title: '记录新状态', category: '反馈', detail: '再听/再弹一次，写下现在的感受。', cue: '只记一个变化' }
          ] };
          window.PIANO_OPEN_SESSION?.(reviewSession);
        }
      }));
    }

    const heatmap = $('#heatmap');
    heatmap.innerHTML = Array.from({ length: 84 }, (_, index) => {
      const date = dateFromOffset(index - 83);
      const minutes = minutesForDate(localDateKey(date));
      const level = minutes === 0 ? 0 : minutes < 20 ? 1 : minutes < 40 ? 2 : minutes < 60 ? 3 : 4;
      return `<i class="heat-cell ${level ? `l${level}` : ''}" title="${localDateKey(date)} · ${minutes} 分钟"></i>`;
    }).join('');

    const bars = Array.from({ length: 6 }, (_, index) => {
      const end = dateFromOffset(index * -7);
      const start = dateFromOffset(index * -7 - 6);
      const dailyKeys = Array.from({ length: 7 }, (_, day) => localDateKey(new Date(start.getFullYear(), start.getMonth(), start.getDate() + day)));
      const minutes = dailyKeys.reduce((sum, key) => sum + minutesForDate(key), 0);
      return { label: index === 0 ? '本周' : `${index} 周前`, minutes };
    }).reverse();
    const maxMinutes = Math.max(60, ...bars.map((bar) => bar.minutes));
    $('#barChart').innerHTML = bars.map((bar) => `<div class="bar-item" style="--h:${Math.max(4, Math.round((bar.minutes / maxMinutes) * 105))}px"><span></span><small>${bar.minutes}</small><em>${bar.label}</em></div>`).join('');

    if (!state.history.length) {
      $('#historyList').innerHTML = `<div class="empty-history">完成第一次练习后，这里会留下你的声音记录。</div>`;
    } else {
      $('#historyList').innerHTML = state.history.slice(0, 12).map((entry) => `<div class="history-item"><span class="history-icon">♪</span><div><strong>${escapeHtml(entry.title)}</strong><small>第 ${entry.week} 周 · ${entry.date} · ${entry.ratingLabel || '已记录'}${entry.notes ? ` · ${escapeHtml(entry.notes)}` : ''}</small></div><span>${entry.minutes} 分钟</span></div>`).join('');
    }
  }

  function renderAll() {
    renderHeader();
    renderSidebar();
    renderDashboard();
    renderPath();
    renderLibrary();
    renderRepertoire();
    renderStats();
  }

  function updateNav(page) {
    activePage = page;
    ['today', 'path', 'library', 'repertoire', 'stats'].forEach((name) => {
      $(`#${name}Page`).classList.toggle('hidden', name !== page);
      $$(`[data-nav="${name}"]`).forEach((link) => { link.classList.toggle('active', name === page); if (name === page) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
    });
    if (location.hash !== `#${page}` && page !== 'today') history.replaceState(null, '', `#${page}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (page === 'today') renderDashboard();
    if (page === 'path') renderPath();
    if (page === 'library') renderLibrary();
    if (page === 'repertoire') renderRepertoire();
    if (page === 'stats') renderStats();
  }

  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    $('#toastRegion').appendChild(toast);
    setTimeout(() => toast.remove(), 2800);
  }

  window.PIANO_APP = {
    state, DATA, persist, renderAll, updateNav, showToast, findSession,
    sessionsForWeek, currentWeekData, currentSessionData, streakCount, openPlayAlong,
    renderLibrary, renderRepertoire, repertoireProgress, isSessionComplete: isComplete, totalXp, levelForXp,
    replaceState(nextState) {
      Object.keys(state).forEach((key) => delete state[key]);
      Object.assign(state, structuredClone(defaultState), nextState || {});
      state.profile = { ...defaultState.profile, ...((nextState && nextState.profile) || {}) };
    }
  };
})();

(() => {
  const APP = window.PIANO_APP;
  const DATA = APP.DATA;
  const state = APP.state;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const RATING_LABELS = { 1: '需要帮助', 2: '有点卡', 3: '刚刚好', 4: '很顺' };
  const MASTERY_PASS_PERCENT = 67;
  const isNormalLesson = (item) => Boolean(item && !item.quick && !item.repertoireId);
  const masteryPassed = (sessionId) => Boolean(state.mastery?.[sessionId] && Number(state.mastery[sessionId].best) >= MASTERY_PASS_PERCENT);
  const escapeUi = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const localDateKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const STATIC_HOST = location.protocol === 'file:' || /github\.io$/i.test(location.hostname) || location.hostname.endsWith('.pages.dev') || location.hostname.endsWith('.netlify.app') || location.hostname.endsWith('.vercel.app');
  const SOURCE_URL = 'https://i.ytimg.com/vi/tEtukfFv3Wk/maxresdefault.jpg';

  let session = null;
  let stepIndex = 0;
  let remaining = 0;
  let intervalId = null;
  let paused = false;
  let startedAt = null;
  let rating = 3;
  let completionPreview = null;
  let deferredInstallPrompt = null;
  let metronomeTimer = null;
  let metronomeStep = 0;
  let metronomeBpms = [0, 60, 72, 84, 96];
  let metronomeIndex = 0;
  let metronomeAudio = null;
  const NOTE_FREQ = { C: 261.63, D: 293.66, E: 329.63, F: 349.23, G: 392, A: 440, B: 493.88 };
  let noteGameIndex = 0;
  let noteGameScore = 0;
  let noteGameCombo = 0;
  let noteGameCurrent = 'C';
  let noteGameLocked = false;
  let onboardingChoices = { level: 'zero', weeklyMinutes: 240, style: 'mixed' };
  let noteGameMode = 'note';
  let activeRepertoirePiece = null;
  const PLAY_ALONG_PITCHES = [
    { name: 'C', pc: 0, input: 'a', black: false },
    { name: 'C♯', pc: 1, input: 'w', black: true },
    { name: 'D', pc: 2, input: 's', black: false },
    { name: 'D♯', pc: 3, input: 'e', black: true },
    { name: 'E', pc: 4, input: 'd', black: false },
    { name: 'F', pc: 5, input: 'f', black: false },
    { name: 'F♯', pc: 6, input: 't', black: true },
    { name: 'G', pc: 7, input: 'g', black: false },
    { name: 'G♯', pc: 8, input: 'y', black: true },
    { name: 'A', pc: 9, input: 'h', black: false },
    { name: 'A♯', pc: 10, input: 'u', black: true },
    { name: 'B', pc: 11, input: 'j', black: false }
  ];
  const PLAY_ALONG_PATTERNS = [
    { id: 'c-five', title: 'C 五指位', cue: '右手 1–2–3–4–5，慢速弹准每个音', notes: [0, 2, 4, 5, 7, 5, 4, 2, 0, 0] },
    { id: 'stepwise', title: '级进短句', cue: '保持手腕放松，听每个音是否同样清楚', notes: [0, 2, 4, 2, 4, 5, 4, 2, 0, 2] },
    { id: 'fifth-up', title: '五度回环', cue: '先看目标音，再落键；不要用手臂找键', notes: [0, 4, 7, 4, 0, 4, 7, 4, 0, 0] },
    { id: 'broken-triad', title: '分解和弦', cue: 'C–E–G 一次成形，声音均匀地向上走', notes: [0, 4, 7, 12 - 12, 7, 4, 0, 4, 7, 0] }
  ];
  let playAlongPattern = PLAY_ALONG_PATTERNS[0];
  let playAlongSequence = [];
  let playAlongIndex = 0;
  let playAlongCorrect = 0;
  let playAlongMistakes = 0;
  let playAlongStreak = 0;
  let playAlongBestStreak = 0;
  let playAlongActive = false;
  let playAlongMidi = null;
  let playAlongMidiAccess = null;

  function formatClock(seconds) {
    const safe = Math.max(0, Math.round(seconds));
    return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
  }

  function totalRemaining() {
    if (!session) return 0;
    const currentLeft = stepIndex < session.steps.length ? remaining : 0;
    const future = session.steps.slice(stepIndex + 1).reduce((sum, step) => sum + step.minutes * 60, 0);
    return currentLeft + future;
  }

  function updateLessonProgress() {
    if (!session) return;
    const completedMinutes = session.steps.slice(0, stepIndex).reduce((sum, step) => sum + step.minutes, 0) + (session.steps[stepIndex] ? session.steps[stepIndex].minutes - remaining / 60 : 0);
    const total = session.duration || 60;
    $('#lessonProgressBar').style.width = `${Math.min(100, Math.max(0, (completedMinutes / total) * 100))}%`;
    $('#lessonXp').textContent = `+${Math.max(10, Math.round((completedMinutes / total) * 20))}`;
    $('#lessonClock').textContent = `剩余 ${formatClock(totalRemaining())}`;
    $('.timer-ring span').textContent = formatClock(remaining);
    if (session.steps[stepIndex]) $('.timer-ring small').textContent = session.steps[stepIndex].title;
    $$('.lesson-step').forEach((element, index) => {
      element.classList.toggle('active', index === stepIndex);
      element.classList.toggle('done', index < stepIndex);
    });
  }

  let checkpointQuestions = [];
  let checkpointIndex = 0;
  let checkpointCorrect = 0;
  let checkpointAnswered = false;

  function checkpointQuestionSet(step) {
    const base = [
      {
        q: `这一步最关键的动作或听感检查是什么？`,
        options: [`${step.title}：先慢速，确认均匀与放松`, '直接加速到目标速度', '只看手，不看谱和拍子'],
        answer: 0,
        explain: '练习先保证动作与声音可控，再逐步加速。'
      },
      {
        q: '遇到连续两次相同错误时，最合理的处理是？',
        options: ['从头再弹一遍完整曲目', '把问题缩到 2–4 小节，分手慢练', '继续原速直到碰对'],
        answer: 1,
        explain: '缩小问题范围，降低速度并分手，才能建立稳定反馈。'
      },
      {
        q: '本步骤的时间结构更接近哪一种？',
        options: ['一次练到累为止', '短段、多次、带暂停和复盘', '只练最熟悉的开头'],
        answer: 1,
        explain: '高质量练习需要短段、反馈和间歇，而不是无脑重复。'
      }
    ];
    const template = String(step.detail || '').split(/[。；]/).filter(Boolean).slice(0, 2).join('；');
    if (/视奏|陌生谱/.test(step.title + step.detail)) {
      base[0] = { q: '视奏时遇到错音，正确的第一反应是？', options: ['停下来逐音纠正', '保持节拍继续，弹完再复盘', '从头重来'], answer: 1, explain: '视奏训练的是连续读谱与预判，错误留到弹完再处理。' };
    } else if (/技术|音阶|哈农|琶音/.test(step.title + step.detail)) {
      base[0] = { q: '技术练习中最重要的即时指标是？', options: ['速度越快越好', '均匀、放松、声音稳定', '每个音都用力'], answer: 1, explain: '技术练习的质量来自均匀、放松和可控的声音，而不是盲目加速。' };
    }
    return base;
  }

  function openCheckpoint() {
    if (!session) return;
    const step = session.steps[stepIndex] || session.steps[0];
    checkpointQuestions = checkpointQuestionSet(step);
    checkpointIndex = 0;
    checkpointCorrect = 0;
    checkpointAnswered = false;
    document.querySelector('#checkpointPanel').classList.remove('hidden');
    document.querySelector('#checkpointDone').classList.add('hidden');
    document.querySelector('#checkpointOptions').classList.remove('hidden');
    document.querySelector('#checkpointQuestion').classList.remove('hidden');
    document.querySelector('#checkpointNext').classList.add('hidden');
    renderCheckpointQuestion();
  }

  function closeCheckpoint() {
    document.querySelector('#checkpointPanel').classList.add('hidden');
  }

  function renderCheckpointQuestion() {
    const question = checkpointQuestions[checkpointIndex];
    checkpointAnswered = false;
    document.querySelector('#checkpointProgress').textContent = `${checkpointIndex + 1} / ${checkpointQuestions.length}`;
    document.querySelector('#checkpointProgressBar').style.width = `${((checkpointIndex) / checkpointQuestions.length) * 100}%`;
    document.querySelector('#checkpointQuestion').textContent = question.q;
    document.querySelector('#checkpointFeedback').textContent = '';
    document.querySelector('#checkpointNext').classList.add('hidden');
    document.querySelector('#checkpointOptions').innerHTML = question.options.map((option, index) => `<button type="button" class="checkpoint-option" data-checkpoint-option="${index}">${escapeUi(option)}</button>`).join('');
    document.querySelectorAll('[data-checkpoint-option]').forEach((button) => button.addEventListener('click', () => answerCheckpoint(Number(button.dataset.checkpointOption), button)));
  }

  function answerCheckpoint(choice, button) {
    if (checkpointAnswered) return;
    checkpointAnswered = true;
    const question = checkpointQuestions[checkpointIndex];
    document.querySelectorAll('[data-checkpoint-option]').forEach((option, index) => {
      option.disabled = true;
      if (index === question.answer) option.classList.add('correct');
    });
    if (choice === question.answer) {
      checkpointCorrect += 1;
      button.classList.add('correct');
      document.querySelector('#checkpointFeedback').textContent = question.explain;
    } else {
      button.classList.add('wrong');
      document.querySelector('#checkpointFeedback').textContent = `正确答案：${question.options[question.answer]}。${question.explain}`;
    }
    const next = document.querySelector('#checkpointNext');
    next.classList.remove('hidden');
    next.textContent = checkpointIndex >= checkpointQuestions.length - 1 ? '查看结果' : '下一题';
  }

  function nextCheckpoint() {
    if (checkpointIndex >= checkpointQuestions.length - 1) {
      finishCheckpoint();
      return;
    }
    checkpointIndex += 1;
    renderCheckpointQuestion();
  }

  function finishCheckpoint() {
    document.querySelector('#checkpointOptions').classList.add('hidden');
    document.querySelector('#checkpointQuestion').classList.add('hidden');
    document.querySelector('#checkpointNext').classList.add('hidden');
    document.querySelector('#checkpointFeedback').textContent = '';
    document.querySelector('#checkpointDone').classList.remove('hidden');
    const percent = Math.round((checkpointCorrect / checkpointQuestions.length) * 100);
    document.querySelector('#checkpointScore').textContent = `${checkpointCorrect} / ${checkpointQuestions.length}`;
    const message = percent >= MASTERY_PASS_PERCENT ? '通过。可以保存本次练习，继续下一课。' : `还差一点：至少答对 2 / 3 才能解锁下一课。回到当前步骤再练一轮。`;
    document.querySelector('#checkpointMessage').textContent = message;
    document.querySelector('#checkpointProgressBar').style.width = '100%';
    if (session) {
      const key = session.id;
      const previous = state.mastery?.[key] || { attempts: 0, best: 0 };
      state.mastery = { ...(state.mastery || {}), [key]: { attempts: previous.attempts + 1, best: Math.max(previous.best, percent), last: percent, updatedAt: new Date().toISOString() } };
      APP.persist();
    }
  }

  function renderStep() {
    if (!session) return;
    if (stepIndex >= session.steps.length) {
      finishSession();
      return;
    }
    const step = session.steps[stepIndex];
    document.querySelector('#checkpointPanel')?.classList.add('hidden');
    remaining = step.minutes * 60;
    paused = false;
    $('#stepIndex').textContent = String(stepIndex + 1).padStart(2, '0');
    $('#stepTitle').textContent = step.title;
    $('#stepDetail').textContent = step.detail;
    $('#stepCue').textContent = step.cue;
    const firstSource = session.sources.map((id) => DATA.resources.videos.find((item) => item.id === id)).find(Boolean);
    $('#lessonSource').innerHTML = firstSource ? `对应来源：<a href="${firstSource.url}" target="_blank" rel="noreferrer noopener">${firstSource.creator} · ${firstSource.title}</a>` : '';
    const checkpoint = APP.state.mastery?.[session.id];
    const checkpointButton = document.querySelector('#openCheckpoint');
    if (checkpointButton) {
      const passed = !isNormalLesson(session) || Number(checkpoint?.best || 0) >= MASTERY_PASS_PERCENT;
      checkpointButton.textContent = passed ? '✓ 已通过检查' : checkpoint ? `◎ 再测一次 · ${checkpoint.best}%` : '◎ 完成掌握检查';
      checkpointButton.classList.toggle('passed', passed);
    }
    $('#timerToggle').classList.remove('paused');
    $('#timerToggle').innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>';
    $$('.lesson-step').forEach((element, index) => {
      element.classList.toggle('active', index === stepIndex);
      element.classList.toggle('done', index < stepIndex);
    });
    updateLessonProgress();
  }

  let lastActiveSessionSave = 0;

  function rememberActiveSession(force = false) {
    if (!session) return;
    const now = Date.now();
    if (!force && now - lastActiveSessionSave < 8000) return;
    lastActiveSessionSave = now;
    APP.state.activeSession = {
      id: session.id,
      week: session.week,
      day: session.day,
      stepIndex,
      remaining,
      updatedAt: new Date().toISOString()
    };
    APP.persist();
  }

  function startTimer() {
    clearInterval(intervalId);
    intervalId = setInterval(() => {
      if (paused || !session) return;
      remaining -= 1;
      if (remaining <= 0) {
        if (stepIndex >= session.steps.length - 1) {
          clearInterval(intervalId);
          remaining = 0;
          updateLessonProgress();
          finishSession();
          return;
        }
        stepIndex += 1;
        renderStep();
        APP.showToast('进入下一段练习');
        return;
      }
      updateLessonProgress();
      rememberActiveSession();
    }, 1000);
  }

  function updateProgressDisplay() {
    const xp = APP.totalXp();
    const level = APP.levelForXp(xp);
    const levelBadge = document.querySelector('#levelBadge');
    const xpValue = document.querySelector('#xpValue');
    const levelProgress = document.querySelector('#levelProgress');
    if (levelBadge) levelBadge.textContent = `Lv.${level.level}`;
    if (xpValue) xpValue.textContent = `${xp} XP`;
    if (levelProgress) levelProgress.style.width = `${Math.min(100, Math.max(0, level.progress))}%`;
    const profileSub = document.querySelector('#profileSub');
    if (profileSub) {
      const profile = APP.state.profile;
      const levelText = profile.level === 'zero' ? '零基础' : profile.level === 'basic' ? '有基础' : '重新开始';
      profileSub.textContent = `${levelText} · 每周 ${Math.round((Number(profile.weeklyMinutes) || 240) / 60)} 小时`;
    }
  }

  const PLACEMENT_QUESTIONS = [
    {
      prompt: '一个 4/4 小节里，如果每个音符是四分音符，最多有几个？',
      options: ['2 个', '3 个', '4 个'], answer: 2,
      explain: '4/4 拍每小节四拍，每拍一个四分音符。'
    },
    {
      prompt: '五线谱高音谱号中，中央 C 通常写在哪里？',
      options: ['第一线', '下加一线', '第三间'], answer: 1,
      explain: '中央 C 在高音谱的下加一线，也在低音谱的上加一线。'
    },
    {
      prompt: 'C 大调的 I–IV–V 三和弦分别是？',
      options: ['C–F–G', 'C–D–E', 'C–Am–F'], answer: 0,
      explain: 'C 大调主、下属、属和弦的根音是 C、F、G。'
    },
    {
      prompt: '切分踏板通常应该在什么时候换？',
      options: ['音落下之前踩住', '音落下后迅速抬起再踩', '整段一直踩住'], answer: 1,
      explain: '切分踏板在音落下后更换，避免前一个和声残留。'
    },
    {
      prompt: '如果要练一个困难的两小节，最有效的做法是？',
      options: ['从曲首反复整首弹', '分手、拆段、慢速、连续三次正确', '只加快速度直到弹对'], answer: 1,
      explain: '拆段、分手和慢练能让大脑建立稳定的动作与听觉反馈。'
    }
  ];
  let placementIndex = 0;
  let placementScore = 0;
  let placementAnswered = false;
  let pendingPlacementWeek = 1;

  function scoreToWeek(score) {
    if (score <= 1) return 1;
    if (score === 2) return 3;
    if (score === 3) return 5;
    if (score === 4) return 7;
    return 9;
  }

  function renderPlacementQuestion() {
    placementAnswered = false;
    const question = PLACEMENT_QUESTIONS[placementIndex];
    document.querySelector('#placementProgress').textContent = `${placementIndex + 1} / ${PLACEMENT_QUESTIONS.length}`;
    document.querySelector('#placementFeedback').textContent = '';
    document.querySelector('#placementQuestion').textContent = question.prompt;
    document.querySelector('#placementOptions').innerHTML = question.options.map((option, index) => `<button type="button" class="placement-option" data-placement-option="${index}">${escapeUi(option)}</button>`).join('');
    document.querySelectorAll('[data-placement-option]').forEach((button) => button.addEventListener('click', () => answerPlacement(Number(button.dataset.placementOption), button)));
  }

  function answerPlacement(choice, button) {
    if (placementAnswered) return;
    placementAnswered = true;
    const question = PLACEMENT_QUESTIONS[placementIndex];
    document.querySelectorAll('[data-placement-option]').forEach((option, index) => {
      option.disabled = true;
      if (index === question.answer) option.classList.add('correct');
    });
    if (choice === question.answer) {
      placementScore += 1;
      button.classList.add('correct');
      document.querySelector('#placementFeedback').textContent = question.explain;
    } else {
      button.classList.add('wrong');
      document.querySelector('#placementFeedback').textContent = `正确答案：${question.options[question.answer]}。${question.explain}`;
    }
    setTimeout(() => {
      placementIndex += 1;
      if (placementIndex < PLACEMENT_QUESTIONS.length) {
        renderPlacementQuestion();
      } else {
        const week = scoreToWeek(placementScore);
        pendingPlacementWeek = week;
        document.querySelector('#placementResultTitle').textContent = `第 ${week} 周`;
        document.querySelector('#placementResultText').textContent = week === 1 ? '从最基础的动作、键盘与拍感开始，最稳妥。' : week <= 3 ? '你具备一些读谱基础，可以从五指位置和简单和弦开始。' : week <= 5 ? '建议从双手独立、八分音符和踏板开始补齐。' : '你的基础不错，可以直接从复调、声部和表达开始。';
        document.querySelector('#placementResultPanel').classList.remove('hidden');
        document.querySelector('#placementQuestion').classList.add('hidden');
        document.querySelector('#placementOptions').classList.add('hidden');
        document.querySelector('#placementProgress').textContent = '完成';
      }
    }, 700);
  }

  function openPlacement() {
    placementIndex = 0;
    placementScore = 0;
    pendingPlacementWeek = 1;
    document.querySelector('#placementResultPanel').classList.add('hidden');
    document.querySelector('#placementQuestion').classList.remove('hidden');
    document.querySelector('#placementOptions').classList.remove('hidden');
    const onboarding = document.querySelector('#onboardingModal');
    if (onboarding && !onboarding.classList.contains('hidden')) {
      onboarding.classList.add('placement-parent-hidden');
      onboarding.classList.add('hidden');
    }
    document.querySelector('#placementModal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    renderPlacementQuestion();
  }

  function closePlacement() {
    document.querySelector('#placementModal').classList.add('hidden');
    const onboarding = document.querySelector('#onboardingModal');
    if (onboarding?.classList.contains('placement-parent-hidden')) {
      onboarding.classList.remove('placement-parent-hidden');
      onboarding.classList.remove('hidden');
    }
    document.body.style.overflow = '';
  }

  function usePlacement() {
    APP.state.placement = { week: pendingPlacementWeek, score: placementScore, completedAt: new Date().toISOString() };
    APP.state.profile = { ...APP.state.profile, startWeek: pendingPlacementWeek };
    APP.persist();
    APP.renderAll();
    updateProgressDisplay();
    const result = document.querySelector('#placementResult');
    if (result) {
      result.classList.remove('hidden');
      result.textContent = `定位完成：建议从第 ${pendingPlacementWeek} 周开始。`;
    }
    closePlacement();
  }

  function openQuickPractice() {
    const current = APP.currentSessionData();
    if (!current) return;
    const brief = {
      ...current,
      id: `${current.id}-quick`,
      title: `5 分钟快练：${current.title}`,
      duration: 5,
      quick: true,
      steps: [
        { start: 0, end: 1, minutes: 1, title: '身体与拍感', category: '热身', detail: '坐稳、松肩，跟 60 BPM 数四拍。', cue: '先听再动' },
        { start: 1, end: 3, minutes: 2, title: current.title, category: '技术', detail: current.steps[2]?.detail || current.goal, cue: '只练一个小段' },
        { start: 3, end: 4, minutes: 1, title: '陌生谱视奏', category: '读谱', detail: current.steps[4]?.detail || '视奏两小节陌生谱，不停顿。', cue: '连续比完美重要' },
        { start: 4, end: 5, minutes: 1, title: '一句话复盘', category: '反馈', detail: '录音或写下今天最清楚的一个动作。', cue: '只记一个问题' }
      ],
      sources: current.sources
    };
    openSession(brief);
  }

  function findRepertoire(id) {
    return (APP.DATA.repertoire || []).find((piece) => piece.id === id) || null;
  }

  function openRepertoirePiece(id) {
    const piece = findRepertoire(id);
    if (!piece) return;
    activeRepertoirePiece = piece;
    const progress = APP.repertoireProgress(piece);
    document.querySelector('#repertoireModalTitle').textContent = piece.title;
    document.querySelector('#repertoireModalComposer').textContent = piece.composer;
    document.querySelector('#repertoireModalMeta').innerHTML = `<span>${escapeUi(piece.level)}</span><span>${escapeUi(piece.grade)}</span><span>${piece.minutes} 分钟 / 阶段</span><span>${escapeUi((piece.skills || []).join(' · '))}</span>`;
    document.querySelector('#repertoireModalDesc').textContent = piece.description;
    document.querySelector('#repertoireModalPhases').innerHTML = progress.phases.map((phase, index) => `<div class="repertoire-phase ${index < progress.phaseIndex ? 'done' : index === progress.phaseIndex ? 'current' : ''}">${index < progress.phaseIndex ? '✓ ' : ''}${index === progress.phaseIndex ? '● ' : ''}${escapeUi(phase)}</div>`).join('');
    document.querySelector('#repertoireModalTitle').dataset.pieceId = piece.id;
    document.querySelector('#repertoireScoreLink').href = piece.score;
    const start = document.querySelector('#startRepertoirePractice');
    start.textContent = progress.completed ? '复盘完整曲目' : `开始：${progress.phases[progress.phaseIndex]}`;
    document.querySelector('#repertoireModal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeRepertoireModal() {
    document.querySelector('#repertoireModal').classList.add('hidden');
    document.body.style.overflow = '';
    activeRepertoirePiece = null;
  }

  function startRepertoirePractice() {
    const piece = activeRepertoirePiece;
    if (!piece) return;
    const progress = APP.repertoireProgress(piece);
    const phaseIndex = progress.phaseIndex;
    const phaseName = progress.completed ? '完整复盘' : progress.phases[phaseIndex];
    const phaseSteps = [
      { start: 0, end: 3, minutes: 3, title: '曲目地图', category: '定向', detail: `找到 ${piece.title} 的调号、拍号、反复记号与最难的两个位置。`, cue: '先看全局，不急着弹' },
      { start: 3, end: 10, minutes: 7, title: phaseName, category: '阶段', detail: progress.completed ? '从曲首完整走一遍，只标记失去方向的位置。' : `本阶段目标：${phaseName}。只处理与这个阶段直接相关的小段。`, cue: '一次只解决一个层级' },
      { start: 10, end: 18, minutes: 8, title: '分手/慢速闭环', category: '技术', detail: '每 2–4 小节一段，单手连续 3 次正确，再半速合手。', cue: '连续三次正确才算通过' },
      { start: 18, end: 24, minutes: 6, title: '连接与表达', category: '曲目', detail: '把刚练的段落接到前一小节和后一小节，完成一次带起句的演奏。', cue: '连接比单点更重要' },
      { start: 24, end: 25, minutes: 1, title: '阶段记录', category: '反馈', detail: '录下 10–20 秒，只记录一个下次要修的连接。', cue: '一次只记一个问题' }
    ];
    const repertoireSession = {
      id: `${piece.id}-practice-${Date.now()}`,
      sourceId: piece.id,
      repertoireId: piece.id,
      title: `曲目训练：${piece.title}`,
      week: 0,
      day: 1,
      duration: 25,
      quick: true,
      goal: progress.completed ? piece.goal : `${phaseName}：${piece.goal}`,
      steps: phaseSteps,
      sources: []
    };
    closeRepertoireModal();
    openSession(repertoireSession);
  }

  function openOnboarding(force = false) {
    if (!force && localStorage.getItem('pianopath-onboarded') === '1') return false;
    const profile = APP.state.profile;
    onboardingChoices = { level: profile.level || 'zero', weeklyMinutes: Number(profile.weeklyMinutes) || 240, style: profile.style || 'mixed' };
    const form = document.querySelector('#onboardingForm');
    if (form) {
      form.querySelectorAll('[data-group]').forEach((group) => {
        const activeValue = onboardingChoices[group.dataset.group];
        group.querySelectorAll('.choice-chip').forEach((chip) => chip.classList.toggle('active', Number(chip.dataset.value) === Number(activeValue) || chip.dataset.value === String(activeValue)));
      });
    }
    document.querySelector('#onboardingModal')?.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    return true;
  }

  function closeOnboarding() {
    document.querySelector('#onboardingModal')?.classList.add('hidden');
    document.body.style.overflow = '';
    localStorage.setItem('pianopath-onboarded', '1');
  }

  function chooseOnboarding(button) {
    const group = button.closest('[data-group]');
    if (!group) return;
    const key = group.dataset.group;
    const raw = button.dataset.value;
    onboardingChoices[key] = key === 'weeklyMinutes' ? Number(raw) : raw;
    group.querySelectorAll('.choice-chip').forEach((chip) => chip.classList.toggle('active', chip === button));
  }

  function saveOnboarding(event) {
    event.preventDefault();
    const weeklyMinutes = Number(onboardingChoices.weeklyMinutes) || 240;
    const daysPerWeek = weeklyMinutes >= 360 ? 6 : weeklyMinutes >= 300 ? 5 : 4;
    APP.state.profile = {
      ...APP.state.profile,
      weeklyMinutes,
      daysPerWeek,
      sessionMinutes: Math.round(weeklyMinutes / daysPerWeek),
      level: onboardingChoices.level,
      style: onboardingChoices.style
    };
    APP.persist();
    APP.renderAll();
    updateProgressDisplay();
    closeOnboarding();
    APP.showToast('计划创建好了，先完成第一课。');
    setTimeout(() => openSession(APP.currentSessionData().id), 280);
  }

  function openSession(sessionId) {
    const found = sessionId && typeof sessionId === 'object' ? sessionId : APP.findSession(sessionId);
    if (!found) {
      APP.showToast('找不到这节课，请刷新页面。');
      return;
    }
    stopMetronome();
    session = found;
    const saved = state.activeSession && state.activeSession.id === session.id ? state.activeSession : null;
    stepIndex = saved ? Math.max(0, Math.min(session.steps.length - 1, Number(saved.stepIndex) || 0)) : 0;
    paused = false;
    startedAt = Date.now();
    $('#lessonKicker').textContent = `第 ${session.week} 周 · 第 ${session.day} 次`;
    $('#lessonTitle').textContent = session.title;
    $('#lessonGoal').textContent = session.goal;
    const planLength = document.querySelector('#lessonPlanLength');
    if (planLength) planLength.textContent = session.repertoireId ? `曲目训练 · ${session.duration} 分钟` : session.quick ? '5 分钟快练' : `今天的 ${session.duration} 分钟`;
    $('#lessonSteps').innerHTML = session.steps.map((step, index) => `<div class="lesson-step" data-step="${index}"><span class="lesson-step-num">${String(index + 1).padStart(2, '0')}</span><span><strong>${step.title}</strong><small>${step.start}–${step.end} 分 · ${step.minutes} 分钟</small></span></div>`).join('');
    $('#lessonModal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    renderStep();
    if (saved && Number(saved.remaining) > 0) {
      remaining = Math.min(remaining, Number(saved.remaining));
      updateLessonProgress();
    }
    rememberActiveSession(true);
    startTimer();
  }

  function closeSession() {
    stopMetronome();
    rememberActiveSession(true);
    clearInterval(intervalId);
    intervalId = null;
    $('#lessonModal').classList.add('hidden');
    document.body.style.overflow = '';
    session = null;
  }

  function finishSession() {
    if (!session) return;
    stopMetronome();
    rememberActiveSession(true);
    clearInterval(intervalId);
    intervalId = null;
    const elapsed = Math.max(1, Math.round((Date.now() - (startedAt || Date.now())) / 60000));
    const mastery = APP.state.mastery?.[session.id];
    const passed = !isNormalLesson(session) || masteryPassed(session.id);
    completionPreview = { session: { ...session }, elapsed, masteryPassed: passed };
    $('#lessonModal').classList.add('hidden');
    if (session.repertoireId) {
      $('#completeSummary').textContent = `曲目阶段完成 · ${session.title.replace('曲目训练：','')}`;
    } else if (session.quick) {
      $('#completeSummary').textContent = `5 分钟快练完成 · ${session.title.replace('5 分钟快练：','')}`;
    } else if (!passed) {
      $('#completeSummary').textContent = mastery
        ? `掌握检查 ${mastery.best}% · 达到 ${MASTERY_PASS_PERCENT}% 后解锁下一课`
        : `还没有完成掌握检查 · 达到 ${MASTERY_PASS_PERCENT}% 后解锁下一课`;
    } else {
      const weekData = APP.currentWeekData();
      const doneCount = weekData.sessions.filter((item) => APP.isSessionComplete(item.id)).length;
      const remaining = Math.max(0, weekData.sessions.length - doneCount - 1);
      $('#completeSummary').textContent = remaining
        ? `${session.title} 已完成 · 完成后本周还剩 ${remaining} 次练习`
        : `${session.title} 已完成 · 这是本周最后一次练习`;
    }
    $('#completeStreak').textContent = APP.streakCount();
    $('#completeXp').textContent = session.repertoireId ? '+15' : session.quick ? '+5' : passed ? '+20' : '+0';
    const saveButton = document.querySelector('#saveCompletion');
    if (saveButton) saveButton.textContent = !passed ? '保存练习，继续巩固' : session.repertoireId ? '保存阶段并返回曲目' : session.quick ? '保存快练' : '保存，继续下一课';
    const masteryEl = document.querySelector('#completeMastery');
    if (masteryEl) masteryEl.textContent = mastery ? `${mastery.best}%` : '未测';
    const completeSessions = document.querySelector('#completeSessionCount');
    if (completeSessions) completeSessions.textContent = Object.keys(APP.state.completed).length + (passed && !session.quick ? 1 : 0);
    $('#sessionNotes').value = '';
    rating = 3;
    $$('#ratingRow button').forEach((button) => button.classList.toggle('selected', button.dataset.rating === '3'));
    $('#completeModal').classList.remove('hidden');
  }

  function saveCompletion() {
    if (!completionPreview) return;
    const { session: finished, elapsed } = completionPreview;
    const now = new Date();
    const entry = {
      id: finished.id,
      sourceId: finished.sourceId || finished.id.replace(/-quick$/, ''),
      title: finished.title,
      week: finished.week,
      date: finished.date || `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`,
      minutes: Math.max(1, Math.min(finished.duration, elapsed)),
      rating,
      ratingLabel: RATING_LABELS[rating],
      notes: $('#sessionNotes').value.trim(),
      sightDone: finished.steps.some((step) => step.category === '读谱' || /视奏/.test(step.title)) ? 1 : 0,
      completedAt: now.toISOString()
    };
    const isLesson = isNormalLesson(finished);
    const passed = !isLesson || masteryPassed(finished.id);
    if (isLesson && !passed) {
      entry.type = 'lesson-practice';
      entry.mastery = state.mastery?.[finished.id] || null;
      state.history = [entry, ...state.history.filter((item) => item.id !== finished.id || item.date !== entry.date)];
      state.history = state.history.slice(0, 400);
      APP.persist();
      APP.renderAll();
      APP.updateNav('today');
      $('#completeModal').classList.add('hidden');
      completionPreview = null;
      APP.showToast('本次练习已记录。再练一轮，通过掌握检查后解锁下一课。');
      setTimeout(() => openSession(APP.currentSessionData().id), 450);
      syncStateToServer();
      return;
    }
    if (!finished.quick) state.completed[finished.id] = { ...entry, completedAt: entry.completedAt, mastery: state.mastery?.[finished.id] || null };
    if (finished.quick) entry.type = finished.repertoireId ? 'repertoire' : 'quick';
    if (finished.repertoireId) {
      const piece = findRepertoire(finished.repertoireId);
      if (piece) {
        const old = state.repertoire?.[piece.id] || { phaseIndex: 0 };
        const phases = piece.phases || [];
        const nextPhase = Math.min(phases.length, (Number(old.phaseIndex) || 0) + 1);
        state.repertoire = { ...(state.repertoire || {}), [piece.id]: { phaseIndex: nextPhase, lastPracticedAt: now.toISOString(), lastRating: rating, notes: entry.notes } };
        entry.repertoireId = piece.id;
        entry.phaseAdvancedTo = nextPhase;
      }
    }
    state.activeSession = null;
    state.history = [entry, ...state.history.filter((item) => item.id !== finished.id || item.date !== entry.date)];
    state.history = state.history.slice(0, 400);
    APP.persist();
    APP.renderAll();
    updateProgressDisplay();
    $('#completeModal').classList.add('hidden');
    completionPreview = null;
    APP.showToast(finished.repertoireId ? '曲目阶段已保存，继续下一阶段。' : '已保存。下一课已经准备好。');
    document.querySelector('#routeMain')?.classList.add('done');
    document.querySelector('#routeCheck')?.classList.add('done');
    document.querySelector('#routeDone')?.classList.add('active');
    if (finished.repertoireId) {
      APP.updateNav('repertoire');
      setTimeout(() => APP.renderRepertoire(), 180);
    } else {
      APP.updateNav('today');
      setTimeout(() => openSession(APP.currentSessionData().id), 500);
    }
    syncStateToServer();
  }

  function syncStateToServer() {
    if (!window.PIANO_BACKEND_AVAILABLE) return;
    fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state)
    }).catch(() => {});
  }

  function openSettings() {
    const profile = state.profile;
    const form = $('#planForm');
    form.weeklyMinutes.value = String(profile.weeklyMinutes || 240);
    form.daysPerWeek.value = String(profile.daysPerWeek || 4);
    form.level.value = profile.level || 'zero';
    form.style.value = profile.style || 'mixed';
    form.goal.value = profile.goal || '';
    updateDerivedMinutes();
    $('#settingsModal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function updateDerivedMinutes() {
    const form = $('#planForm');
    const weekly = Number(form.weeklyMinutes.value) || 240;
    const days = Number(form.daysPerWeek.value) || 4;
    $('#minutesPerDayLabel').textContent = `${Math.max(10, Math.round(weekly / days))} 分钟`;
  }

  function closeSettings() {
    $('#settingsModal').classList.add('hidden');
    document.body.style.overflow = '';
  }

  function generatePlan(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const weeklyMinutes = Number(form.weeklyMinutes.value);
    const daysPerWeek = Number(form.daysPerWeek.value);
    const profile = {
      weeklyMinutes,
      daysPerWeek,
      sessionMinutes: Math.max(10, Math.round(weeklyMinutes / daysPerWeek)),
      level: form.level.value,
      style: form.style.value,
      goal: form.goal.value.trim()
    };
    state.profile = profile;
    APP.persist();
    APP.renderAll();
    updateProgressDisplay();
    closeSettings();
    APP.showToast(`计划已更新：每周 ${profile.daysPerWeek} 次，每次 ${profile.sessionMinutes} 分钟。`);
    if (window.PIANO_BACKEND_AVAILABLE) {
      fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile)
      }).then((response) => response.json()).then((plan) => {
        if (plan && plan.ok) {
          state.serverPlan = plan;
          APP.persist();
          syncStateToServer();
          if (plan.summary) APP.showToast(plan.summary);
          if (plan.warning) setTimeout(() => APP.showToast(plan.warning), 3200);
        }
      }).catch(() => {});
    } else {
      syncStateToServer();
    }
  }

  function youtubeId(url) {
    const match = String(url || '').match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([A-Za-z0-9_-]{6,})/);
    return match ? match[1] : '';
  }

  function escapeVideoHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function openVideo(resourceId) {
    const video = DATA.resources.videos.find((item) => item.id === resourceId);
    if (!video) return;
    const frame = $('#videoFrame');
    const yt = video.platform === 'YouTube' ? youtubeId(video.url) : '';
    const bv = video.platform === 'Bilibili' ? (String(video.url).match(/(BV[0-9A-Za-z]+)/) || [])[1] : '';
    if (yt) {
      frame.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${yt}?rel=0" title="${escapeVideoHtml(video.title)}" loading="lazy" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
    } else if (bv) {
      frame.innerHTML = `<iframe src="https://player.bilibili.com/player.html?bvid=${bv}&page=1&high_quality=1&danmaku=0" title="${escapeVideoHtml(video.title)}" loading="lazy" allowfullscreen></iframe>`;
    } else {
      frame.innerHTML = `<div class="video-external-fallback"><img src="${escapeVideoHtml(video.image)}" alt="${escapeVideoHtml(video.title)}" referrerpolicy="no-referrer" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 1200 675%27%3E%3Crect width=%271200%27 height=%27675%27 fill=%27%23edf2e9%27/%3E%3Ctext x=%27600%27 y=%27340%27 text-anchor=%27middle%27 font-family=%27sans-serif%27 font-size=%2724%27 fill=%27%236f8975%27%3E琴阶 PianoPath%3C/text%3E%3C/svg%3E'"><span>该来源需在平台内观看</span></div>`;
    }
    $('#videoTitle').textContent = video.title;
    $('#videoMeta').textContent = `${video.creator} · ${video.followers} · ${video.duration || '课程'} · ${video.credential || '专业课程'}`;
    $('#videoOpen').href = video.url;
    $('#videoModal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeVideo() {
    $('#videoFrame').innerHTML = '';
    $('#videoModal').classList.add('hidden');
    document.body.style.overflow = '';
  }

  let warmupTimer = null;
  let warmupBpm = 60;
  let warmupBeat = -1;
  let warmupPlaying = false;
  let rhythmGameHits = 0;
  let rhythmGameTotal = 0;
  let rhythmGameLastBeatAt = 0;

  function stopWarmup() {
    clearInterval(warmupTimer);
    warmupTimer = null;
    warmupPlaying = false;
    warmupBeat = -1;
    $$('#beatVisual span').forEach((beat) => beat.classList.remove('active'));
    $('#warmupToggle').textContent = '开始';
    $('#warmupToggle').classList.remove('is-playing');
  }

  function openWarmup() {
    stopWarmup();
    rhythmGameHits = 0;
    rhythmGameTotal = 0;
    $('#warmupModal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    updateRhythmScore();
  }

  function updateRhythmScore() {
    const score = rhythmGameTotal ? Math.round((rhythmGameHits / rhythmGameTotal) * 100) : 0;
    const scoreEl = $('#warmupScore');
    if (scoreEl) scoreEl.textContent = `${score}%`;
  }

  function tapRhythm() {
    if (!warmupPlaying) return;
    const now = performance.now();
    rhythmGameTotal += 1;
    if (rhythmGameLastBeatAt && Math.abs(now - rhythmGameLastBeatAt) < 260) rhythmGameHits += 1;
    updateRhythmScore();
  }

  function closeWarmup() {
    stopWarmup();
    $('#warmupModal').classList.add('hidden');
    document.body.style.overflow = '';
  }

  function toggleWarmup() {
    if (warmupPlaying) {
      stopWarmup();
      return;
    }
    warmupPlaying = true;
    $('#warmupToggle').textContent = '暂停';
    $('#warmupToggle').classList.add('is-playing');
    warmupBeat = -1;
    const tick = () => {
      warmupBeat = (warmupBeat + 1) % 4;
      $$('#beatVisual span').forEach((beat, index) => beat.classList.toggle('active', index === warmupBeat));
      rhythmGameLastBeatAt = performance.now();
      if (warmupBeat === 0) {
        rhythmGameLastBeatAt = performance.now();
        try {
          const AudioCtx = window.AudioContext || window.webkitAudioContext;
          if (AudioCtx) {
            const ctx = new AudioCtx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.frequency.value = 740;
            gain.gain.setValueAtTime(.05, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + .07);
            osc.connect(gain).connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + .08);
            osc.onended = () => ctx.close();
          }
        } catch (error) {}
      }
    };
    tick();
    warmupTimer = setInterval(tick, 60000 / warmupBpm);
  }

  window.addEventListener('beforeunload', () => rememberActiveSession(true));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && accountState.loggedIn) syncNow(); });

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    $$('.install-button').forEach((button) => button.classList.remove('hidden'));
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    $$('.install-button').forEach((button) => button.classList.add('hidden'));
    APP.showToast('琴阶已安装到桌面。');
  });

  async function installApp() {
    if (!deferredInstallPrompt) {
      APP.showToast('请使用 Chrome / Edge 并刷新后重试；也可用浏览器菜单“安装应用”。');
      return;
    }
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    $$('.install-button').forEach((button) => button.classList.add('hidden'));
  }

  function playTone(freq=440, duration=.24) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(.07, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + duration);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration + .01);
      osc.onended = () => ctx.close();
    } catch (error) {}
  }

  function updateNoteGame() {
    document.querySelector('#noteGameProgress').textContent = `${Math.min(noteGameIndex + 1, 10)} / 10`;
    document.querySelector('#noteGameScore').textContent = noteGameScore;
    document.querySelector('#noteGameCombo').textContent = noteGameCombo;
  }

  function newNoteQuestion() {
    const notes = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
    const pool = notes.filter((note) => note !== noteGameCurrent);
    noteGameCurrent = pool[Math.floor(Math.random() * pool.length)];
    noteGameLocked = false;
    const question = document.querySelector('#noteGameQuestion');
    const hint = document.querySelector('#noteGameHint');
    const replay = document.querySelector('#noteReplay');
    if (noteGameMode === 'ear') {
      question.textContent = '?';
      hint.textContent = '听声音，点击对应的琴键';
      replay?.classList.remove('hidden');
      setTimeout(() => playTone(NOTE_FREQ[noteGameCurrent], .38), 180);
    } else {
      question.textContent = noteGameCurrent;
      hint.textContent = '点击下方正确的白键';
      replay?.classList.add('hidden');
    }
    document.querySelector('#noteGameFeedback').textContent = noteGameMode === 'ear' ? '先听，再选。' : '点击下方正确的白键';
    document.querySelectorAll('.note-key').forEach((key) => key.classList.remove('correct', 'wrong'));
    updateNoteGame();
  }

  function setNoteGameMode(mode) {
    noteGameMode = mode === 'ear' ? 'ear' : 'note';
    document.querySelectorAll('.note-mode').forEach((button) => {
      const active = button.dataset.gameMode === noteGameMode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    const title = document.querySelector('#noteGameTitle');
    const eyebrow = document.querySelector('#noteGameEyebrow');
    if (title) title.textContent = noteGameMode === 'ear' ? '听出这个音' : '找出这个音';
    if (eyebrow) eyebrow.textContent = noteGameMode === 'ear' ? 'EAR TRAINING' : 'FIND THE KEY';
    noteGameIndex = 0;
    noteGameScore = 0;
    noteGameCombo = 0;
    newNoteQuestion();
  }

  function openNoteGame() {
    noteGameIndex = 0;
    noteGameScore = 0;
    noteGameCombo = 0;
    noteGameCurrent = 'C';
    setNoteGameMode(noteGameMode);
    const best = localStorage.getItem('pianopath-note-game-best') || localStorage.getItem('pianopath-ear-game-best');
    document.querySelector('#noteGameBest').textContent = best || '—';
    document.querySelector('#noteGameModal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeNoteGame() {
    document.querySelector('#noteGameModal').classList.add('hidden');
    document.body.style.overflow = '';
    const bestKey = noteGameMode === 'ear' ? 'pianopath-ear-game-best' : 'pianopath-note-game-best';
    const best = localStorage.getItem(bestKey);
    const gameBest = document.querySelector('#homeGameBest');
    if (gameBest) gameBest.textContent = best ? `${best} 分` : '—';
  }

  function chooseNote(note, keyElement) {
    if (noteGameLocked) return;
    if (note === noteGameCurrent) {
      noteGameLocked = true;
      noteGameCombo += 1;
      noteGameScore += 10 + (noteGameCombo - 1) * 2;
      keyElement.classList.add('correct');
      playTone(NOTE_FREQ[note], .28);
      document.querySelector('#noteGameFeedback').textContent = noteGameCombo >= 3 ? `连对 ${noteGameCombo} 题，漂亮！` : '答对了，继续！';
      noteGameIndex += 1;
      updateNoteGame();
      if (noteGameIndex >= 10) {
        setTimeout(finishNoteGame, 550);
      } else {
        setTimeout(newNoteQuestion, 620);
      }
    } else {
      noteGameCombo = 0;
      keyElement.classList.add('wrong');
      document.querySelector('#noteGameFeedback').textContent = noteGameMode === 'ear' ? '不是这个音，再听一次。' : `这是 ${note}，再找找 ${noteGameCurrent}`;
      updateNoteGame();
      setTimeout(() => keyElement.classList.remove('wrong'), 300);
    }
  }

  function finishNoteGame() {
    const today = localDateKey(new Date());
    state.gameSessions = [{ date: today, mode: noteGameMode, score: noteGameScore, completedAt: new Date().toISOString() }, ...(state.gameSessions || [])].slice(0, 120);
    if (!state.history.some((entry) => entry.date === today && entry.type === 'game')) {
      state.history = [{ id: `game-${Date.now()}`, type: 'game', title: noteGameMode === 'ear' ? '听声音辨音' : '看音名找键', week: 0, date: today, minutes: 3, rating: 4, ratingLabel: '小游戏', notes: `得分 ${noteGameScore}`, sightDone: 0, completedAt: new Date().toISOString() }, ...state.history].slice(0, 400);
    }
    APP.persist();
    const bestKey = noteGameMode === 'ear' ? 'pianopath-ear-game-best' : 'pianopath-note-game-best';
    const best = Number(localStorage.getItem(bestKey) || 0);
    if (noteGameScore > best) {
      localStorage.setItem(bestKey, String(noteGameScore));
      document.querySelector('#noteGameBest').textContent = noteGameScore;
    }
    document.querySelector('#noteGameFeedback').textContent = `完成 10 题，得分 ${noteGameScore}。${noteGameScore >= 120 ? '听辨很稳！' : '再来一局会更准。'}`;
    document.querySelector('#noteGameQuestion').textContent = '✓';
    document.querySelector('#noteGameProgress').textContent = '完成';
    APP.renderAll();
    updateProgressDisplay();
  }

  function playAlongKeyMarkup() {
    const white = PLAY_ALONG_PITCHES.filter((pitch) => !pitch.black);
    const black = PLAY_ALONG_PITCHES.filter((pitch) => pitch.black);
    const blackLeft = { 1: 10.2, 3: 24.5, 6: 52.8, 8: 67.0, 10: 81.3 };
    return white.map((pitch) => `<button class="playalong-key white" type="button" data-playalong-pc="${pitch.pc}" aria-label="${pitch.name} ${pitch.input.toUpperCase()} 键"><span>${pitch.name}</span><small>${pitch.input.toUpperCase()}</small></button>`).join('') + black.map((pitch) => `<button class="playalong-key black" type="button" style="left:${blackLeft[pitch.pc]}%" data-playalong-pc="${pitch.pc}" aria-label="${pitch.name} ${pitch.input.toUpperCase()} 键"><span>${pitch.name}</span><small>${pitch.input.toUpperCase()}</small></button>`).join('');
  }

  function renderPlayAlongSequence() {
    const sequence = document.querySelector('#playAlongSequence');
    if (!sequence) return;
    sequence.innerHTML = playAlongSequence.map((pc, index) => {
      const pitch = PLAY_ALONG_PITCHES.find((item) => item.pc === pc) || PLAY_ALONG_PITCHES[0];
      const className = index < playAlongIndex ? 'done' : index === playAlongIndex ? 'current' : '';
      return `<span class="playalong-note ${className}">${escapeUi(pitch.name)}</span>`;
    }).join('');
  }

  function updatePlayAlongStats() {
    const total = playAlongSequence.length || 10;
    const accuracy = playAlongCorrect + playAlongMistakes > 0 ? Math.round((playAlongCorrect / (playAlongCorrect + playAlongMistakes)) * 100) : 100;
    const progress = Math.min(total, playAlongIndex + (playAlongActive ? 1 : 0));
    const progressEl = document.querySelector('#playAlongProgress');
    const accuracyEl = document.querySelector('#playAlongAccuracy');
    const streakEl = document.querySelector('#playAlongStreak');
    if (progressEl) progressEl.textContent = `${Math.min(total, Math.max(1, progress || 1))} / ${total}`;
    if (accuracyEl) accuracyEl.textContent = `${accuracy}%`;
    if (streakEl) streakEl.textContent = String(playAlongStreak);
    renderPlayAlongSequence();
  }

  function currentPlayAlongNote() {
    return PLAY_ALONG_PITCHES.find((item) => item.pc === playAlongSequence[playAlongIndex]) || PLAY_ALONG_PITCHES[0];
  }

  function showPlayAlongTarget() {
    const target = document.querySelector('#playAlongTarget');
    if (!target) return;
    const pitch = currentPlayAlongNote();
    target.textContent = pitch.name;
    target.dataset.pc = String(pitch.pc);
    target.className = `playalong-target ${pitch.black ? 'sharp' : ''}`;
    document.querySelectorAll('.playalong-key').forEach((key) => key.classList.toggle('target', Number(key.dataset.playalongPc) === pitch.pc));
    updatePlayAlongStats();
  }

  function listenPlayAlongPattern() {
    const status = document.querySelector('#playAlongListenStatus');
    const button = document.querySelector('#playAlongListen');
    if (!button) return;
    button.disabled = true;
    if (status) status.textContent = '正在播放示范…';
    let index = 0;
    const playNext = () => {
      if (index >= playAlongSequence.length) {
        button.disabled = false;
        if (status) status.textContent = '示范结束，按你的速度开始。';
        return;
      }
      const pc = playAlongSequence[index];
      playTone(261.63 * Math.pow(2, pc / 12), .32);
      index += 1;
      setTimeout(playNext, 420);
    };
    playNext();
  }

  function openPlayAlong() {
    const stageIndex = Number.isInteger(stepIndex) ? Math.min(stepIndex, 2) : 0;
    playAlongPattern = PLAY_ALONG_PATTERNS[stageIndex % PLAY_ALONG_PATTERNS.length] || PLAY_ALONG_PATTERNS[0];
    playAlongSequence = [...playAlongPattern.notes];
    playAlongIndex = 0;
    playAlongCorrect = 0;
    playAlongMistakes = 0;
    playAlongStreak = 0;
    playAlongBestStreak = 0;
    playAlongActive = false;
    const keyboard = document.querySelector('#playAlongKeyboard');
    if (keyboard && !keyboard.children.length) keyboard.innerHTML = playAlongKeyMarkup();
    const title = document.querySelector('#playAlongPatternTitle');
    const cue = document.querySelector('#playAlongPatternCue');
    if (title) title.textContent = playAlongPattern.title;
    if (cue) cue.textContent = playAlongPattern.cue;
    document.querySelector('#playAlongReady')?.classList.remove('hidden');
    document.querySelector('#playAlongPractice')?.classList.add('hidden');
    document.querySelector('#playAlongResult')?.classList.add('hidden');
    document.querySelector('#playAlongModal')?.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closePlayAlong() {
    playAlongActive = false;
    document.querySelector('#playAlongModal')?.classList.add('hidden');
    const lessonOpen = document.querySelector('#lessonModal') && !document.querySelector('#lessonModal').classList.contains('hidden');
    document.body.style.overflow = lessonOpen ? 'hidden' : '';
  }

  function startPlayAlong() {
    playAlongIndex = 0;
    playAlongCorrect = 0;
    playAlongMistakes = 0;
    playAlongStreak = 0;
    playAlongBestStreak = 0;
    playAlongActive = true;
    document.querySelector('#playAlongReady')?.classList.add('hidden');
    document.querySelector('#playAlongPractice')?.classList.remove('hidden');
    document.querySelector('#playAlongResult')?.classList.add('hidden');
    document.querySelector('#playAlongFeedback').textContent = '慢一点，弹准比弹快重要。';
    showPlayAlongTarget();
  }

  function replayPlayAlongTarget() {
    const pitch = currentPlayAlongNote();
    const frequency = 261.63 * Math.pow(2, pitch.pc / 12);
    playTone(frequency, .35);
  }

  function answerPlayAlong(pc, source = 'pointer') {
    if (!playAlongActive) return;
    const expected = currentPlayAlongNote().pc;
    if (pc === expected) {
      playAlongCorrect += 1;
      playAlongStreak += 1;
      playAlongBestStreak = Math.max(playAlongBestStreak, playAlongStreak);
      document.querySelector('#playAlongFeedback').textContent = playAlongStreak >= 5 ? `连对 ${playAlongStreak} 音，节奏很稳。` : '对了，保持这个动作。';
      const key = document.querySelector(`.playalong-key[data-playalong-pc="${pc}"]`);
      key?.classList.add('hit');
      setTimeout(() => key?.classList.remove('hit'), 220);
      playAlongIndex += 1;
      if (playAlongIndex >= playAlongSequence.length) {
        finishPlayAlong();
        return;
      }
      showPlayAlongTarget();
      return;
    }
    playAlongMistakes += 1;
    playAlongStreak = 0;
    const targetName = currentPlayAlongNote().name;
    document.querySelector('#playAlongFeedback').textContent = `还差一步：目标音是 ${targetName}。听一遍，再来。`;
    const key = document.querySelector(`.playalong-key[data-playalong-pc="${pc}"]`);
    key?.classList.add('miss');
    setTimeout(() => key?.classList.remove('miss'), 260);
    updatePlayAlongStats();
    replayPlayAlongTarget();
  }

  function finishPlayAlong() {
    playAlongActive = false;
    const total = playAlongSequence.length;
    const accuracy = Math.round((playAlongCorrect / Math.max(1, playAlongCorrect + playAlongMistakes)) * 100);
    const stars = accuracy >= 92 ? 3 : accuracy >= 75 ? 2 : 1;
    const xp = stars === 3 ? 15 : stars === 2 ? 10 : 5;
    const key = session?.id || 'free-play';
    const old = state.playAlong?.[key] || { attempts: 0, bestAccuracy: 0, bestStreak: 0, xp: 0 };
    state.playAlong = {
      ...(state.playAlong || {}),
      [key]: {
        attempts: old.attempts + 1,
        bestAccuracy: Math.max(old.bestAccuracy, accuracy),
        bestStreak: Math.max(old.bestStreak, playAlongBestStreak),
        lastAccuracy: accuracy,
        xp: Math.max(old.xp, xp),
        updatedAt: new Date().toISOString()
      }
    };
    const today = localDateKey(new Date());
    state.history = [{
      id: `playalong-${Date.now()}`,
      type: 'playalong',
      title: `跟弹练习：${playAlongPattern.title}`,
      week: session?.week || 0,
      date: today,
      minutes: 2,
      rating: stars,
      ratingLabel: '跟弹',
      notes: `${playAlongCorrect}/${total} 音正确，连对 ${playAlongBestStreak}`,
      sightDone: 0,
      completedAt: new Date().toISOString()
    }, ...state.history].slice(0, 400);
    APP.persist();
    APP.renderAll();
    updateProgressDisplay();
    document.querySelector('#playAlongPractice')?.classList.add('hidden');
    document.querySelector('#playAlongResult')?.classList.remove('hidden');
    document.querySelector('#playAlongStars').textContent = '★ '.repeat(stars) + '☆ '.repeat(3 - stars);
    document.querySelector('#playAlongResultAccuracy').textContent = `${accuracy}%`;
    document.querySelector('#playAlongCorrect').textContent = String(playAlongCorrect);
    document.querySelector('#playAlongMistakes').textContent = String(playAlongMistakes);
    document.querySelector('#playAlongXp').textContent = `+${xp} XP`;
    document.querySelector('#playAlongResultMessage').textContent = accuracy >= 92 ? '每个音都听清了。' : accuracy >= 75 ? '节奏和音高已经稳定，再练一轮会更顺。' : '先把目标音看准，再慢速弹一次。';
  }

  async function connectPlayAlongMidi() {
    const note = document.querySelector('#playAlongInputNote');
    if (!navigator.requestMIDIAccess) {
      if (note) note.textContent = '此浏览器没有 MIDI 支持。仍可用电脑键盘或点击琴键。';
      return;
    }
    try {
      playAlongMidiAccess = await navigator.requestMIDIAccess();
      const inputs = Array.from(playAlongMidiAccess.inputs.values());
      if (!inputs.length) {
        if (note) note.textContent = '没有检测到 MIDI 键盘。插上设备后重试。';
        return;
      }
      playAlongMidi = inputs[0];
      playAlongMidi.onmidimessage = (event) => {
        const [command, noteNumber, velocity] = event.data;
        if ((command & 0xf0) === 0x90 && velocity > 0) answerPlayAlong(noteNumber % 12, 'midi');
      };
      if (note) note.textContent = `已连接：${playAlongMidi.name}。直接弹下对应琴键。`;
      document.querySelector('#playAlongDevice').textContent = 'MIDI 已连接';
    } catch (error) {
      if (note) note.textContent = 'MIDI 连接被浏览器拦截。检查权限后再试，或使用键盘。';
    }
  }

  function handlePlayAlongKeydown(event) {
    if (!playAlongActive || !document.querySelector('#playAlongModal') || document.querySelector('#playAlongModal').classList.contains('hidden')) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const pitch = PLAY_ALONG_PITCHES.find((item) => item.input === event.key.toLowerCase());
    if (!pitch) return;
    event.preventDefault();
    answerPlayAlong(pitch.pc, 'keyboard');
  }

  function stopMetronome() {
    clearInterval(metronomeTimer);
    metronomeTimer = null;
    metronomeIndex = 0;
    metronomeStep = 0;
    const button = document.querySelector('#metronomeToggle');
    const label = document.querySelector('#metronomeLabel');
    if (button) { button.classList.remove('active'); button.setAttribute('aria-pressed', 'false'); }
    if (label) label.textContent = '节拍';
  }

  function tickMetronome() {
    const bpm = metronomeBpms[metronomeIndex];
    if (!bpm) return;
    try {
      metronomeAudio = metronomeAudio || new (window.AudioContext || window.webkitAudioContext)();
      const osc = metronomeAudio.createOscillator();
      const gain = metronomeAudio.createGain();
      osc.frequency.value = metronomeStep % 4 === 0 ? 880 : 660;
      gain.gain.setValueAtTime(.035, metronomeAudio.currentTime);
      gain.gain.exponentialRampToValueAtTime(.001, metronomeAudio.currentTime + .045);
      osc.connect(gain).connect(metronomeAudio.destination);
      osc.start();
      osc.stop(metronomeAudio.currentTime + .05);
    } catch (error) {}
    metronomeStep += 1;
  }

  function cycleMetronome() {
    clearInterval(metronomeTimer);
    metronomeTimer = null;
    metronomeIndex = (metronomeIndex + 1) % metronomeBpms.length;
    const bpm = metronomeBpms[metronomeIndex];
    const button = document.querySelector('#metronomeToggle');
    const label = document.querySelector('#metronomeLabel');
    if (!bpm) {
      if (button) { button.classList.remove('active'); button.setAttribute('aria-pressed', 'false'); }
      if (label) label.textContent = '节拍';
      return;
    }
    if (button) { button.classList.add('active'); button.setAttribute('aria-pressed', 'true'); }
    if (label) label.textContent = `${bpm}`;
    metronomeStep = 0;
    tickMetronome();
    metronomeTimer = setInterval(tickMetronome, 60000 / bpm);
  }

  function bindEvents() {
    document.addEventListener('click', (event) => {
      const nav = event.target.closest('[data-nav]');
      if (nav) {
        event.preventDefault();
        APP.updateNav(nav.dataset.nav);
        return;
      }
      const sessionButton = event.target.closest('[data-session]');
      if (sessionButton) {
        if (sessionButton.getAttribute('aria-disabled') === 'true' || sessionButton.classList.contains('locked')) {
          APP.showToast('先完成前一课，下一课就会解锁。');
          return;
        }
        openSession(sessionButton.dataset.session);
        return;
      }
      const phase = event.target.closest('[data-phase]');
      if (phase) {
        $$('.phase-tab').forEach((item) => item.classList.toggle('active', item === phase));
        const value = phase.dataset.phase;
        const rows = $$('.week-row');
        rows.forEach((row, index) => {
          const week = DATA.weeks[index];
          row.style.display = value === '全部' || week.phase === value ? '' : 'none';
        });
        return;
      }
      const topic = event.target.closest('[data-topic]');
      if (topic) {
        $$('.filter-chip').forEach((item) => item.classList.toggle('active', item === topic));
        APP.renderLibrary(topic.dataset.topic);
        return;
      }
      const video = event.target.closest('[data-video]');
      if (video) {
        event.preventDefault();
        openVideo(video.dataset.video);
        return;
      }
      const repertoireOpen = event.target.closest('[data-repertoire-open]');
      if (repertoireOpen) {
        event.preventDefault();
        openRepertoirePiece(repertoireOpen.dataset.repertoireOpen);
        return;
      }
      const repertoireFilterButton = event.target.closest('[data-repertoire-filter]');
      if (repertoireFilterButton) {
        APP.renderRepertoire(repertoireFilterButton.dataset.repertoireFilter);
        return;
      }
    });

    $('#startToday').addEventListener('click', () => openSession(APP.currentSessionData().id));
    $('#openAccount')?.addEventListener('click', openAccount);
    $('#profileButton')?.addEventListener('click', openAccount);
    document.querySelectorAll('.account-tab').forEach((button) => button.addEventListener('click', () => setAccountMode(button.dataset.accountMode)));
    document.querySelector('#accountForm')?.addEventListener('submit', submitAccount);
    document.querySelector('#closeAccount')?.addEventListener('click', closeAccount);
    document.querySelector('#continueGuest')?.addEventListener('click', closeAccount);
    document.querySelector('#continueLocal')?.addEventListener('click', closeAccount);
    document.querySelector('#accountSyncNow')?.addEventListener('click', () => syncNow({ force: true }));
    document.querySelector('#accountLogout')?.addEventListener('click', logoutAccount);
    window.addEventListener('online', () => { if (accountState.loggedIn) syncNow(); });
    $('#routeReview')?.addEventListener('click', () => APP.updateNav('stats'));
    $('#startRhythmGame')?.addEventListener('click', openNoteGame);
    $('#startPlayAlongHome')?.addEventListener('click', openPlayAlong);
    document.querySelectorAll('#onboardingForm .choice-chip').forEach((button) => button.addEventListener('click', () => chooseOnboarding(button)));
    document.querySelector('#onboardingForm')?.addEventListener('submit', saveOnboarding);
    document.querySelector('#openPlacement')?.addEventListener('click', openPlacement);
    document.querySelector('#closePlacement')?.addEventListener('click', closePlacement);
    document.querySelector('#usePlacement')?.addEventListener('click', usePlacement);
    document.querySelector('#quickPractice')?.addEventListener('click', openQuickPractice);
    document.querySelector('#closeRepertoire')?.addEventListener('click', closeRepertoireModal);
    document.querySelector('#startRepertoirePractice')?.addEventListener('click', startRepertoirePractice);
    document.querySelector('#repertoireSearch')?.addEventListener('input', (event) => APP.renderRepertoire(undefined, event.target.value));
    document.querySelectorAll('.note-mode').forEach((button) => button.addEventListener('click', () => setNoteGameMode(button.dataset.gameMode)));
    document.querySelector('#noteReplay')?.addEventListener('click', () => playTone(NOTE_FREQ[noteGameCurrent], .38));
    document.querySelector('#closeOnboarding')?.addEventListener('click', closeOnboarding);
    document.querySelector('#levelButton')?.addEventListener('click', () => APP.updateNav('stats'));
    $('#openTodayDetail')?.addEventListener('click', () => APP.updateNav('path'));
    $('#searchButton')?.addEventListener('click', () => {
      APP.updateNav('library');
      setTimeout(() => { $('#librarySearch')?.focus(); }, 160);
    });
    $('#themeToggle')?.addEventListener('click', () => {
      const dark = document.documentElement.dataset.theme !== 'dark';
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      localStorage.setItem('pianopath-theme', dark ? 'dark' : 'light');
      if (document.querySelector('#themeToggle')) document.querySelector('#themeToggle').setAttribute('aria-label', dark ? '切换浅色模式' : '切换深色模式');
      document.documentElement.classList.add('theme-transition');
      setTimeout(() => document.documentElement.classList.remove('theme-transition'), 320);
    });
    $('#closeLesson').addEventListener('click', closeSession);
    $('#metronomeToggle')?.addEventListener('click', cycleMetronome);
    document.querySelector('#openPlayAlong')?.addEventListener('click', openPlayAlong);
    document.querySelector('#closePlayAlong')?.addEventListener('click', closePlayAlong);
    document.querySelector('#playAlongStart')?.addEventListener('click', startPlayAlong);
    document.querySelector('#playAlongListen')?.addEventListener('click', listenPlayAlongPattern);
    document.querySelector('#playAlongMidiConnect')?.addEventListener('click', connectPlayAlongMidi);
    document.querySelector('#playAlongRetry')?.addEventListener('click', startPlayAlong);
    document.querySelector('#playAlongReturn')?.addEventListener('click', closePlayAlong);
    document.querySelector('#playAlongKeyboard')?.addEventListener('click', (event) => {
      const key = event.target.closest('[data-playalong-pc]');
      if (key) answerPlayAlong(Number(key.dataset.playalongPc), 'pointer');
    });
    document.addEventListener('keydown', handlePlayAlongKeydown);
    document.querySelector('#openCheckpoint')?.addEventListener('click', openCheckpoint);
    document.querySelector('#closeCheckpoint')?.addEventListener('click', closeCheckpoint);
    document.querySelector('#checkpointNext')?.addEventListener('click', nextCheckpoint);
    document.querySelector('#checkpointFinish')?.addEventListener('click', () => { closeCheckpoint(); APP.renderAll(); });
    $('#completeStep').addEventListener('click', () => {
      if (stepIndex >= session.steps.length - 1) finishSession();
      else { stepIndex += 1; renderStep(); }
    });
    $('#timerToggle').addEventListener('click', () => {
      paused = !paused;
      $('#timerToggle').classList.toggle('paused', paused);
      $('#timerToggle').innerHTML = paused ? '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>';
    });
    $('#finishSession').addEventListener('click', finishSession);
    $('#saveCompletion').addEventListener('click', saveCompletion);
    $('#ratingRow').addEventListener('click', (event) => {
      const button = event.target.closest('[data-rating]');
      if (!button) return;
      rating = Number(button.dataset.rating);
      $$('#ratingRow button').forEach((item) => item.classList.toggle('selected', item === button));
    });
    $('#openSettings')?.addEventListener('click', openSettings);
    $('#streakButton')?.addEventListener('click', () => APP.updateNav('stats'));
    document.querySelector('#skillFocusButton')?.addEventListener('click', (event) => {
      const focus = event.currentTarget.dataset.skillFocus;
      if (focus === 'read' || focus === 'technique') APP.updateNav('today');
      else if (focus === 'repertoire') APP.updateNav('repertoire');
      else APP.updateNav('today');
    });
    $('#customizeTop')?.addEventListener('click', openSettings);
    $('#closeSettings')?.addEventListener('click', closeSettings);
    $('#planForm')?.addEventListener('submit', generatePlan);
    $$('select[name="weeklyMinutes"], select[name="daysPerWeek"]').forEach((select) => {
      select.addEventListener('change', updateDerivedMinutes);
    });
    $('#reopenOnboarding')?.addEventListener('click', () => {
      closeSettings();
      setTimeout(() => openOnboarding(true), 180);
    });
    $('#clearAllData')?.addEventListener('click', () => {
      if (!confirm('将清除计划、打卡和最佳成绩，且无法恢复。确认吗？')) return;
      localStorage.clear();
      location.reload();
    });
    $('#resetPlan')?.addEventListener('click', () => {
      state.profile = { weeklyMinutes: 240, daysPerWeek: 4, sessionMinutes: 60, level: 'zero', style: 'mixed', goal: '' };
      state.activeSession = null;
      APP.persist();
      APP.renderAll();
      updateProgressDisplay();
      closeSettings();
      APP.showToast('已恢复默认：每周 4 小时，4 次 × 60 分钟。');
    });
    $('#closeVideo')?.addEventListener('click', closeVideo);
    $('#closeWarmup')?.addEventListener('click', closeWarmup);
    $('#installApp')?.addEventListener('click', installApp);
    $('#installAppModal')?.addEventListener('click', installApp);
    $('#noteGameRestart')?.addEventListener('click', openNoteGame);
    $('#closeNoteGame')?.addEventListener('click', closeNoteGame);
    $$('.note-key').forEach((key) => key.addEventListener('click', () => chooseNote(key.dataset.note, key)));
    $$('#beatVisual span').forEach((beat) => beat.addEventListener('click', tapRhythm));
    $('#warmupToggle')?.addEventListener('click', toggleWarmup);
    $$('.warmup-options button').forEach((button) => {
      button.addEventListener('click', () => {
        warmupBpm = Number(button.dataset.bpm);
        $('#warmupBpm').textContent = `${warmupBpm} BPM`;
        $$('.warmup-options button').forEach((item) => item.classList.toggle('active', item === button));
        if (warmupPlaying) { stopWarmup(); toggleWarmup(); }
      });
    });
    $('#librarySearch')?.addEventListener('input', (event) => {
      APP.renderLibrary(undefined, event.target.value);
    });
    $('#clearHistory')?.addEventListener('click', () => {
      if (!confirm('只清除本浏览器中的练习记录，确认吗？')) return;
      state.completed = {};
      state.history = [];
      APP.persist();
      APP.renderAll();
      updateProgressDisplay();
      APP.showToast('本地练习记录已清除。');
    });
    $('#exportData')?.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pianopath-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
    $$('.modal-backdrop').forEach((backdrop) => {
      backdrop.addEventListener('click', (event) => {
        if (event.target !== backdrop) return;
        if (backdrop.id === 'accountModal') closeAccount();
        else if (backdrop.id === 'onboardingModal') closeOnboarding();
        else if (backdrop.id === 'settingsModal') closeSettings();
        else if (backdrop.id === 'warmupModal') closeWarmup();
        else if (backdrop.id === 'noteGameModal') closeNoteGame();
        else if (backdrop.id === 'playAlongModal') closePlayAlong();
        else if (backdrop.id === 'videoModal') closeVideo();
      });
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if (document.querySelector('#playAlongModal') && !document.querySelector('#playAlongModal').classList.contains('hidden')) { closePlayAlong(); return; }
        if (!$('#accountModal').classList.contains('hidden')) closeAccount();
        else if (!$('#onboardingModal').classList.contains('hidden')) closeOnboarding();
        else if (!$('#settingsModal').classList.contains('hidden')) closeSettings();
        else if (!$('#videoModal').classList.contains('hidden')) closeVideo();
        else if (!$('#warmupModal').classList.contains('hidden')) closeWarmup();
        else if (!$('#noteGameModal').classList.contains('hidden')) closeNoteGame();
      }
    });
  }

  APP.openSession = openSession;
  window.PIANO_OPEN_SESSION = openSession;
  APP.openSettings = openSettings;
  APP.openOnboarding = () => openOnboarding(true);
  APP.openPlacement = openPlacement;
  APP.usePlacement = usePlacement;
  APP.openQuickPractice = openQuickPractice;
  APP.openRepertoirePiece = openRepertoirePiece;
  APP.startRepertoirePractice = startRepertoirePractice;
  APP.getAccountState = () => ({ ...accountState });
  APP.updateProgressDisplay = updateProgressDisplay;
  APP.finishSession = finishSession;

  const accountState = {
    loggedIn: false,
    user: null,
    mode: 'login',
    syncRevision: 0,
    syncInFlight: null,
    syncRetryTimer: null,
    dirty: false
  };
  window.PIANO_ACCOUNT = {
    get loggedIn() { return accountState.loggedIn; },
    queueSync,
    syncNow,
    refresh
  };

  function setSyncStatus(text, type = '') {
    const bar = document.querySelector('#syncStatusBar');
    const label = document.querySelector('#syncStatusText');
    const accountLabel = document.querySelector('#accountSyncState');
    if (label) label.textContent = text;
    if (accountLabel) accountLabel.textContent = text;
    if (bar) bar.className = `sync-status-bar ${type}`;
  }

  function setAccountMode(mode) {
    accountState.mode = mode === 'register' ? 'register' : 'login';
    document.querySelectorAll('.account-tab').forEach((button) => button.classList.toggle('active', button.dataset.accountMode === accountState.mode));
    const nameField = document.querySelector('#accountNameField');
    if (nameField) nameField.classList.toggle('hidden', accountState.mode !== 'register');
    const submit = document.querySelector('#accountSubmit');
    if (submit) submit.textContent = accountState.mode === 'register' ? '创建账户并同步' : '登录并同步';
    const password = document.querySelector('#accountForm input[name="password"]');
    if (password) password.setAttribute('autocomplete', accountState.mode === 'register' ? 'new-password' : 'current-password');
    const error = document.querySelector('#accountError');
    if (error) error.textContent = '';
  }

  function showAccountView() {
    const form = document.querySelector('#accountForm');
    const tabs = document.querySelector('#accountTabs');
    const divider = document.querySelector('.account-divider');
    const guest = document.querySelector('#continueGuest');
    const logged = document.querySelector('#accountLoggedIn');
    const intro = document.querySelector('#accountIntro');
    const note = document.querySelector('.account-note');
    const localOnly = document.querySelector('#localOnlyPanel');
    if (!form) return;
    if (STATIC_HOST) {
      form.classList.add('hidden');
      tabs?.classList.add('hidden');
      divider?.classList.add('hidden');
      guest?.classList.add('hidden');
      note?.classList.add('hidden');
      logged?.classList.add('hidden');
      localOnly?.classList.remove('hidden');
      if (intro) intro.textContent = '在线体验版无需注册。你的学习进度会自动保存在当前浏览器。';
      document.querySelector('#sideUserName').textContent = '练琴人';
      document.querySelector('#sideAvatar').textContent = 'C';
      return;
    }
    localOnly?.classList.add('hidden');
    form.classList.toggle('hidden', accountState.loggedIn);
    tabs?.classList.toggle('hidden', accountState.loggedIn);
    divider?.classList.toggle('hidden', accountState.loggedIn);
    guest?.classList.toggle('hidden', accountState.loggedIn);
    note?.classList.toggle('hidden', accountState.loggedIn);
    logged?.classList.toggle('hidden', !accountState.loggedIn);
    if (intro) intro.textContent = accountState.loggedIn ? '账户已连接。离线时仍会先保存到本机，联网后再同步。' : '登录后，课程、XP 和每日任务会在设备间同步。游客模式也可以继续使用。';
    if (accountState.loggedIn && accountState.user) {
      const name = accountState.user.name || '练琴人';
      document.querySelector('#accountUserName').textContent = name;
      document.querySelector('#accountUserEmail').textContent = accountState.user.email || '';
      document.querySelector('#accountAvatar').textContent = name.slice(0, 1).toUpperCase();
      document.querySelector('#sideUserName').textContent = name;
      document.querySelector('#sideAvatar').textContent = name.slice(0, 1).toUpperCase();
    } else {
      document.querySelector('#sideUserName').textContent = '练琴人';
      document.querySelector('#sideAvatar').textContent = 'C';
    }
  }

  async function refresh() {
    if (STATIC_HOST) {
      accountState.loggedIn = false;
      accountState.user = null;
      showAccountView();
      setSyncStatus('本地保存', '');
      return accountState;
    }
    try {
      const response = await fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error('auth unavailable');
      const data = await response.json();
      accountState.loggedIn = Boolean(data.authenticated);
      accountState.user = data.user || null;
      showAccountView();
      setSyncStatus(accountState.loggedIn ? '账户已连接' : '本地保存', accountState.loggedIn ? 'synced' : '');
      if (accountState.loggedIn) await syncNow({ pull: true });
    } catch (error) {
      accountState.loggedIn = false;
      accountState.user = null;
      showAccountView();
      setSyncStatus('本地保存', '');
    }
    return accountState;
  }

  async function accountRequest(path, body) {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body)
    });
    let data = {};
    try { data = await response.json(); } catch (error) {}
    if (!response.ok) throw new Error(data.error || '请求失败，请稍后再试。');
    return data;
  }

  async function submitAccount(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const errorBox = document.querySelector('#accountError');
    if (errorBox) errorBox.textContent = '';
    const email = form.email.value.trim();
    const password = form.password.value;
    const name = form.name?.value.trim() || '练琴人';
    try {
      const path = accountState.mode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const data = await accountRequest(path, accountState.mode === 'register' ? { email, password, name } : { email, password });
      accountState.loggedIn = true;
      accountState.user = data.user;
      form.reset();
      showAccountView();
      setSyncStatus('正在同步', 'syncing');
      await pushLocalThenPull();
      APP.showToast(accountState.mode === 'register' ? '账户已创建，进度开始同步。' : '已登录，进度已同步。');
    } catch (error) {
      if (errorBox) errorBox.textContent = error.message;
    }
  }

  async function pullRemote() {
    const response = await fetch('/api/sync', { cache: 'no-store', credentials: 'same-origin' });
    if (response.status === 401) {
      accountState.loggedIn = false;
      accountState.user = null;
      showAccountView();
      setSyncStatus('本地保存', '');
      return null;
    }
    if (!response.ok) throw new Error('同步读取失败');
    return response.json();
  }

  async function pushLocalThenPull() {
    const remote = await pullRemote();
    if (!remote) return;
    const localHistoryCount = APP.state.history.length;
    const remoteHistoryCount = remote.state?.history?.length || 0;
    if (remote.state && remoteHistoryCount > localHistoryCount) {
      if (localHistoryCount > 0 || Object.keys(APP.state.completed || {}).length > 0) {
        try { localStorage.setItem(`pianopath-guest-backup-${new Date().toISOString().slice(0, 10)}`, JSON.stringify(APP.state)); } catch (error) {}
      }
      APP.replaceState(remote.state);
      APP.persist({ sync: false });
      APP.renderAll();
      updateProgressDisplay();
    } else if (localHistoryCount > 0 || Object.keys(APP.state.completed || {}).length > 0) {
      const result = await syncNow({ force: true });
      if (!result) return;
    }
    accountState.syncRevision = remote.revision || accountState.syncRevision;
    setSyncStatus('已同步', 'synced');
    await refreshAccountSummary();
  }

  async function syncNow({ pull = false, force = false } = {}) {
    if (!accountState.loggedIn) { setSyncStatus('本地保存', ''); return null; }
    if (pull && !force) {
      const remote = await pullRemote().catch(() => null);
      if (remote && remote.state && (remote.state.history?.length || 0) > (APP.state.history?.length || 0)) {
        APP.replaceState(remote.state);
        APP.persist({ sync: false });
        APP.renderAll();
        updateProgressDisplay();
      }
      accountState.syncRevision = remote?.revision || 0;
      setSyncStatus('已同步', 'synced');
      return remote;
    }
    if (accountState.syncInFlight) return accountState.syncInFlight;
    accountState.syncInFlight = (async () => {
      setSyncStatus('正在同步', 'syncing');
      try {
        let response = await fetch('/api/sync', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: APP.state, baseRevision: accountState.syncRevision })
        });
        let result = await response.json().catch(() => ({}));
        if (response.status === 409) {
          const remote = result.state;
          const localHistory = APP.state.history?.length || 0;
          const remoteHistory = remote?.history?.length || 0;
          if (remote && remoteHistory > localHistory) {
            try { localStorage.setItem(`pianopath-conflict-backup-${new Date().toISOString().slice(0, 10)}`, JSON.stringify(APP.state)); } catch (error) {}
            APP.replaceState(remote);
            APP.persist({ sync: false });
            APP.renderAll();
            updateProgressDisplay();
            accountState.syncRevision = result.revision;
            setSyncStatus('已恢复云端进度', 'synced');
            return result;
          }
          const latest = await fetch('/api/sync', { cache: 'no-store', credentials: 'same-origin' }).then((r) => r.json()).catch(() => null);
          accountState.syncRevision = latest?.revision ?? result.revision;
          const latestHistory = latest?.state?.history?.length || 0;
          if (latest?.state && latestHistory > localHistory) {
            try { localStorage.setItem(`pianopath-conflict-backup-${new Date().toISOString().slice(0, 10)}`, JSON.stringify(APP.state)); } catch (error) {}
            APP.replaceState(latest.state);
            APP.persist({ sync: false });
            APP.renderAll();
            updateProgressDisplay();
            setSyncStatus('已恢复云端进度', 'synced');
            return latest;
          }
          return syncNow();
        }
        if (response.status === 401) {
          accountState.loggedIn = false;
          accountState.user = null;
          showAccountView();
          setSyncStatus('本地保存', '');
          return null;
        }
        if (!response.ok) throw new Error(result.error || '同步失败');
        accountState.syncRevision = result.revision;
        setSyncStatus('已同步', 'synced');
        return result;
      } catch (error) {
        setSyncStatus('等待联网', 'error');
        accountState.dirty = true;
        clearTimeout(accountState.syncRetryTimer);
        accountState.syncRetryTimer = setTimeout(() => { if (accountState.loggedIn) syncNow(); }, 12000);
        return null;
      } finally {
        accountState.syncInFlight = null;
      }
    })();
    return accountState.syncInFlight;
  }

  async function queueSync() {
    if (!accountState.loggedIn) return;
    accountState.dirty = true;
    if (accountState.syncRetryTimer) return;
    accountState.syncRetryTimer = setTimeout(() => {
      accountState.syncRetryTimer = null;
      syncNow();
    }, 700);
  }

  async function logoutAccount() {
    try { await accountRequest('/api/auth/logout', {}); } catch (error) {}
    accountState.loggedIn = false;
    accountState.user = null;
    accountState.syncRevision = 0;
    showAccountView();
    setSyncStatus('本地保存', '');
    APP.showToast('已退出账户，本地进度仍保留。');
  }

  async function refreshAccountSummary() {
    setSyncStatus(accountState.loggedIn ? '已同步' : '本地保存', accountState.loggedIn ? 'synced' : '');
  }

  function openAccount() {
    showAccountView();
    document.querySelector('#accountModal')?.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    if (!accountState.loggedIn) setAccountMode(accountState.mode);
    refresh();
  }

  function closeAccount() {
    document.querySelector('#accountModal')?.classList.add('hidden');
    document.body.style.overflow = '';
  }

  async function init() {
    if (STATIC_HOST) {
      window.PIANO_BACKEND_AVAILABLE = false;
      bindEvents();
      APP.renderAll();
      updateProgressDisplay();
      if (localStorage.getItem('pianopath-onboarded') !== '1') setTimeout(() => openOnboarding(), 350);
      const page = (location.hash || '#today').replace('#', '');
      if (['today', 'path', 'library', 'repertoire', 'stats'].includes(page)) APP.updateNav(page);
      return;
    }

    try {
      const health = await fetch('/api/health', { cache: 'no-store' });
      window.PIANO_BACKEND_AVAILABLE = health.ok;
    } catch (error) {
      window.PIANO_BACKEND_AVAILABLE = false;
    }

    bindEvents();
    APP.renderAll();
    updateProgressDisplay();
    if (localStorage.getItem('pianopath-onboarded') !== '1') setTimeout(() => openOnboarding(), 350);
    const page = (location.hash || '#today').replace('#', '');
    if (['today', 'path', 'library', 'repertoire', 'stats'].includes(page)) APP.updateNav(page);

    if (window.PIANO_BACKEND_AVAILABLE) {
      await refresh();
    } else {
      setSyncStatus('本地保存', '');
    }
  }

  init();
})();
