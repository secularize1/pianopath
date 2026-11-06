(() => {
  const DATA = window.PIANO_DATA;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const STORAGE_KEY = 'pianopath-state-v1';
  const DAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
  const PHASE_COLORS = { '起步': '#5bbd78', '基础 I': '#f3cf66', '基础 II': '#ef8d78', '进阶 I': '#7ab6d9', '进阶 II': '#9d8ad6', '巩固': '#6eb98b', '展示': '#1f2a24' };

  const defaultState = {
    profile: { weeklyMinutes: 240, daysPerWeek: 4, sessionMinutes: 60, level: 'zero', style: 'mixed', goal: '' },
    completed: {},
    history: [],
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
  if (localStorage.getItem('pianopath-onboarded') === '1') {
    const onboarding = document.getElementById('onboardingStrip');
    if (onboarding) onboarding.classList.add('hidden');
  }
  let activePage = 'today';
  let currentPhase = '全部';
  let currentTopic = '国内可用';
  let searchTerm = '';
  let lessonSession = null;
  let lessonStepIndex = 0;
  let lessonTimer = null;
  let lessonRemaining = 0;
  let lessonPaused = false;
  let lessonStartedAt = null;
  let currentRating = 3;
  let backendAvailable = false;

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
    for (const week of DATA.weeks) {
      const sessions = sessionsForWeek(week);
      if (sessions.some((session) => !isComplete(session.id))) return { week, sessions };
    }
    const week = DATA.weeks[DATA.weeks.length - 1];
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

  function renderSidebar() {
    const streak = streakCount();
    $('#sideStreak').textContent = streak;
    $('#topStreak').textContent = streak;
    $('#verifiedDate').textContent = DATA.meta.verifiedAt.replaceAll('-', '.');
    const today = new Date();
    const monday = new Date(today);
    monday.setHours(12, 0, 0, 0);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    const practiced = new Set(state.history.map((entry) => entry.date));
    $('#sideWeekDots').innerHTML = DAY_LABELS.map((label, index) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + index);
      const done = practiced.has(localDateKey(date));
      const isToday = localDateKey(date) === localDateKey(today);
      return `<span class="streak-day ${done ? 'done' : ''}" title="${label}"><i>${done ? '✓' : isToday ? '•' : ''}</i>${label}</span>`;
    }).join('');
  }

  function renderHeader() {
    const now = new Date();
    $('#todayDate').textContent = formatChineseDate(now);
    $('#greeting').textContent = greetingForHour(now.getHours());
  }

  function renderDashboard() {
    const { week, sessions } = currentWeekData();
    const session = currentSessionData();
    const plan = getPlanProfile();
    const weekEntries = completedThisWeek();
    const weekDone = Math.min(sessions.filter((item) => isComplete(item.id)).length, sessions.length);
    const percent = Math.round((weekDone / Math.max(1, sessions.length)) * 100);
    const minutes = weekEntries.reduce((sum, entry) => sum + Number(entry.minutes || 0), 0);

    const weekStrip = $('#weekStrip');
    const today = new Date();
    weekStrip.innerHTML = Array.from({ length: 7 }, (_, index) => {
      const date = dateFromOffset(index - ((today.getDay() + 6) % 7));
      const done = state.history.some((entry) => entry.date === localDateKey(date));
      const isToday = localDateKey(date) === localDateKey(today);
      return `<span class="week-day ${done ? 'done' : ''} ${isToday ? 'today' : ''}"><i>${done ? '✓' : index + 1}</i>${DAY_LABELS[index]}</span>`;
    }).join('');
    $('#weeklyDone').textContent = weekDone;
    $('#weeklyMinutes').textContent = `${minutes} 分钟`;
    $('#weeklyPercent').textContent = `${percent}%`;
    $('#weeklyProgressBar').style.width = `${percent}%`;
    $('.floating-progress .progress-ring').style.setProperty('--p', percent);
    $('.floating-progress .progress-ring span').textContent = `${percent}%`;
    $('.floating-progress strong').textContent = `${weekDone} / ${sessions.length} 次`;

    if (session) {
      $('#todaySessionTitle').textContent = session.title;
      $('#todaySessionGoal').textContent = session.goal;
      $('#minutePlanPreview').innerHTML = session.steps.map((step) => `<div class="minute-block"><small>${String(step.start).padStart(2, '0')}–${String(step.end).padStart(2, '0')} 分</small><strong>${escapeHtml(step.title)}</strong><span>${escapeHtml(step.category)} · ${step.minutes} 分钟</span></div>`).join('');
      const firstSource = session.sources.map(resourceById).find((item) => item && item.region !== 'global') || session.sources.map(resourceById).find(Boolean);
      if (firstSource) {
        $('#sourceTeaser').href = firstSource.url;
        $('#sourceTeaser').target = '_blank';
        $('#sourceTeaser').rel = 'noreferrer noopener';
        $('#sourceTeaser').innerHTML = `<img src="${escapeHtml(firstSource.image)}" alt="${escapeHtml(firstSource.title)}" referrerpolicy="no-referrer" onerror="this.src='assets/fallback.svg'"><span><small>${escapeHtml(firstSource.creator)}</small><strong>${escapeHtml(firstSource.title)}</strong><em>${escapeHtml(firstSource.followers)} · 来源已核验</em></span>`;
      }
    }

    const heroMeta = $('.hero-meta');
    if (heroMeta) heroMeta.innerHTML = `<span><strong>${plan.sessionMinutes}</strong> 分钟</span><span><strong>${plan.daysPerWeek}</strong> 次 / 周</span><span><strong>${Number((plan.weeklyMinutes / 60).toFixed(1))}</strong> 小时 / 周</span>`;

    const phaseStarts = [0, 2, 4, 6, 8, 10];
    $('#miniPath').innerHTML = DATA.phases.map((phase, index) => `<div class="mini-stop ${index < Math.floor((week.id - 1) / 2) ? 'done' : ''} ${phase === week.phase ? 'current' : ''}"><span>${escapeHtml(phase)}</span><span>${week.id <= 2 ? 'W1–2' : `W${phaseStarts[index] + 1}`}</span></div>`).join('');
  }

  function renderPath() {
    const current = currentWeekData().week.id;
    $('#phaseTabs').innerHTML = ['全部', ...DATA.phases].map((phase) => `<button class="phase-tab ${currentPhase === phase ? 'active' : ''}" data-phase="${escapeHtml(phase)}">${escapeHtml(phase)}</button>`).join('');
    const filtered = DATA.weeks.filter((week) => currentPhase === '全部' || week.phase === currentPhase);
    $('#journey').innerHTML = filtered.map((week) => {
      const sessions = sessionsForWeek(week);
      const done = sessions.filter((session) => isComplete(session.id)).length;
      const locked = week.id > current;
      const nodeClass = done === sessions.length ? 'done' : week.id === current ? 'current' : '';
      const tags = [week.technique, week.sight].slice(0, 2).map((tag) => `<span class="week-tag">${escapeHtml(tag.split('；')[0])}</span>`).join('');
      const dayButtons = sessions.map((session) => `<button class="week-day-btn ${isComplete(session.id) ? 'done' : ''} ${locked ? 'locked' : ''}" data-session="${escapeHtml(session.id)}"><strong>${isComplete(session.id) ? '✓ ' : ''}${escapeHtml(session.title)}</strong><span>${session.duration} 分钟 · ${escapeHtml(session.goal)}</span></button>`).join('');
      return `<div class="week-row"><div class="week-node ${nodeClass}">${done === sessions.length ? '✓' : String(week.id).padStart(2, '0')}</div><article class="week-panel ${locked ? 'locked' : ''}"><div class="week-panel-head"><div><span class="eyebrow">${escapeHtml(week.phase)}</span><h3>${escapeHtml(week.title)}</h3><p>${escapeHtml(week.goal)}</p><div class="week-tags">${tags}</div></div><div class="week-meta"><strong>${done} / ${sessions.length}</strong>完成</div></div><div class="week-days">${dayButtons}</div></article></div>`;
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
    $('#resourceGrid').innerHTML = filtered.map((item) => `<article class="resource-card ${item.supplement ? 'supplement' : ''}"><div class="resource-image"><img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.src='assets/fallback.svg'"><span class="resource-platform">${escapeHtml(item.platform === 'Bilibili' ? 'B站 · 国内可看' : item.platform)}</span>${item.supplement ? '<span class="resource-badge">补充资源</span>' : ''}</div><div class="resource-body"><div class="resource-author"><strong>${escapeHtml(item.creator)}</strong><span>${item.region === 'global' ? '海外可选' : '✓ ' + escapeHtml(item.followers)}</span></div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p><div class="resource-footer"><span>${escapeHtml(item.duration || '')} · ${escapeHtml(item.credential || '来源已核验')}</span><a href="${escapeHtml(item.url)}" data-video="${escapeHtml(item.id)}">预览来源 ↗</a></div></div></article>`).join('') || `<div class="empty-history">当前筛选下没有匹配来源。</div>`;

    $('#methodGrid').innerHTML = DATA.resources.methodBooks.map((book) => `<article class="method-card"><div class="method-icon">${book.type.includes('曲谱') ? '♬' : book.type.includes('教材') ? '▤' : '§'}</div><div><strong>${escapeHtml(book.name)}</strong><span>${escapeHtml(book.note)}</span></div><a href="${escapeHtml(book.url)}" target="_blank" rel="noreferrer noopener">查看 ↗</a></article>`).join('');
  }

  function renderStats() {
    const total = totalMinutes();
    const sessions = Object.keys(state.completed).length;
    const sight = state.history.filter((entry) => Number(entry.sightDone || 0) > 0).length;
    $('#statMinutes').innerHTML = `${total} <small>分钟</small>`;
    $('#statMinutesHint').textContent = total ? `约 ${(total / 60).toFixed(1)} 小时` : '从今天开始';
    $('#statStreak').innerHTML = `${streakCount()} <small>天</small>`;
    $('#statSessions').innerHTML = `${sessions} <small>/ 48</small>`;
    $('#statSessionsHint').textContent = sessions ? `完成率 ${Math.round((sessions / 48) * 100)}%` : '第一周还在等你';
    $('#statSight').innerHTML = `${sight} <small>次</small>`;

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

  function renderExcluded() {
    $('#excludedList').innerHTML = DATA.resources.excluded.map((item) => `<div class="excluded-item"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.platform)} · ${escapeHtml(item.followers)}</span><p>${escapeHtml(item.reason)}</p></div>`).join('');
  }

  function renderAll() {
    renderHeader();
    renderSidebar();
    renderDashboard();
    renderPath();
    renderLibrary();
    renderStats();
  }

  function updateNav(page) {
    activePage = page;
    ['today', 'path', 'library', 'stats'].forEach((name) => {
      $(`#${name}Page`).classList.toggle('hidden', name !== page);
      $$(`[data-nav="${name}"]`).forEach((link) => link.classList.toggle('active', name === page));
    });
    if (location.hash !== `#${page}` && page !== 'today') history.replaceState(null, '', `#${page}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (page === 'today') renderDashboard();
    if (page === 'path') renderPath();
    if (page === 'library') renderLibrary();
    if (page === 'stats') renderStats();
  }

  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    $('#toastRegion').appendChild(toast);
    setTimeout(() => toast.remove(), 2800);
  }

  window.PIANO_APP = { state, DATA, persist, renderAll, updateNav, showToast, findSession, sessionsForWeek, currentWeekData, currentSessionData, streakCount, renderLibrary };
})();

(() => {
  const APP = window.PIANO_APP;
  const DATA = APP.DATA;
  const state = APP.state;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const RATING_LABELS = { 1: '需要帮助', 2: '有点卡', 3: '刚刚好', 4: '很顺' };
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

  function renderStep() {
    if (!session) return;
    if (stepIndex >= session.steps.length) {
      finishSession();
      return;
    }
    const step = session.steps[stepIndex];
    remaining = step.minutes * 60;
    paused = false;
    $('#stepIndex').textContent = String(stepIndex + 1).padStart(2, '0');
    $('#stepTitle').textContent = step.title;
    $('#stepDetail').textContent = step.detail;
    $('#stepCue').textContent = step.cue;
    const firstSource = session.sources.map((id) => DATA.resources.videos.find((item) => item.id === id)).find(Boolean);
    $('#lessonSource').innerHTML = firstSource ? `对应来源：<a href="${firstSource.url}" target="_blank" rel="noreferrer noopener">${firstSource.creator} · ${firstSource.title}</a>` : '';
    $('#timerToggle').classList.remove('paused');
    $('#timerToggle').innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>';
    $$('.lesson-step').forEach((element, index) => {
      element.classList.toggle('active', index === stepIndex);
      element.classList.toggle('done', index < stepIndex);
    });
    updateLessonProgress();
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
    }, 1000);
  }

  function openSession(sessionId) {
    const found = APP.findSession(sessionId);
    if (!found) {
      APP.showToast('找不到这节课，请刷新页面。');
      return;
    }
    session = found;
    stepIndex = 0;
    paused = false;
    startedAt = Date.now();
    $('#lessonKicker').textContent = `第 ${session.week} 周 · 第 ${session.day} 次`;
    $('#lessonTitle').textContent = session.title;
    $('#lessonGoal').textContent = session.goal;
    $('#lessonSteps').innerHTML = session.steps.map((step, index) => `<div class="lesson-step" data-step="${index}"><span class="lesson-step-num">${String(index + 1).padStart(2, '0')}</span><span><strong>${step.title}</strong><small>${step.start}–${step.end} 分 · ${step.minutes} 分钟</small></span></div>`).join('');
    $('#lessonModal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    renderStep();
    startTimer();
  }

  function closeSession() {
    clearInterval(intervalId);
    intervalId = null;
    $('#lessonModal').classList.add('hidden');
    document.body.style.overflow = '';
    session = null;
  }

  function finishSession() {
    if (!session) return;
    clearInterval(intervalId);
    intervalId = null;
    const elapsed = Math.max(1, Math.round((Date.now() - (startedAt || Date.now())) / 60000));
    completionPreview = { session: { ...session }, elapsed };
    $('#lessonModal').classList.add('hidden');
    $('#completeSummary').textContent = `${session.duration} 分钟 · ${session.steps.length} 个练习段落 · ${session.title}`;
    $('#completeStreak').textContent = APP.streakCount();
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
    state.completed[finished.id] = { ...entry, completedAt: entry.completedAt };
    state.history = [entry, ...state.history.filter((item) => item.id !== finished.id || item.date !== entry.date)];
    state.history = state.history.slice(0, 400);
    APP.persist();
    APP.renderAll();
    $('#completeModal').classList.add('hidden');
    completionPreview = null;
    APP.showToast('已保存。今天的练习成为路径上的一格。');
    APP.updateNav('path');
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

  function openExcluded() {
    $('#excludedModal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeExcluded() {
    $('#excludedModal').classList.add('hidden');
    document.body.style.overflow = '';
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
      frame.innerHTML = `<div class="video-external-fallback"><img src="${escapeVideoHtml(video.image)}" alt="${escapeVideoHtml(video.title)}" referrerpolicy="no-referrer" onerror="this.src='assets/fallback.svg'"><span>该来源需在平台内观看</span></div>`;
    }
    $('#videoTitle').textContent = video.title;
    $('#videoMeta').textContent = `${video.creator} · ${video.followers} · ${video.duration || '课程'} · ${video.credential || '来源已核验'}`;
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
    $('#warmupModal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
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
      if (warmupBeat === 0) {
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
    });

    $('#startToday').addEventListener('click', () => openSession(APP.currentSessionData().id));
    $('#startSessionCircle').addEventListener('click', () => openSession(APP.currentSessionData().id));
    $('#openTodayDetail').addEventListener('click', () => openSession(APP.currentSessionData().id));
    $('#previewPlan').addEventListener('click', () => APP.updateNav('path'));
    $('#searchButton').addEventListener('click', () => {
      APP.updateNav('library');
      setTimeout(() => { $('#librarySearch')?.focus(); }, 160);
    });
    $('#themeToggle').addEventListener('click', () => {
      const dark = document.documentElement.dataset.theme !== 'dark';
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      localStorage.setItem('pianopath-theme', dark ? 'dark' : 'light');
      document.documentElement.classList.add('theme-transition');
      setTimeout(() => document.documentElement.classList.remove('theme-transition'), 320);
    });
    $('#onboardingStart').addEventListener('click', () => {
      localStorage.setItem('pianopath-onboarded', '1');
      openWarmup();
    });
    $('#onboardingClose').addEventListener('click', () => {
      localStorage.setItem('pianopath-onboarded', '1');
      $('#onboardingStrip').classList.add('hidden');
    });
    $('#activityWarmup').addEventListener('click', openWarmup);
    $('#openDailyChallenge').addEventListener('click', openWarmup);
    $('#activitySight').addEventListener('click', () => openSession(APP.currentSessionData().id));
    $('#activityRecord').addEventListener('click', () => openSession(APP.currentSessionData().id));
    $('#activityCourse').addEventListener('click', () => APP.updateNav('library'));
    $('#closeLesson').addEventListener('click', closeSession);
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
    $('#openSettings').addEventListener('click', openSettings);
    $('#profileButton').addEventListener('click', openSettings);
    $('#streakButton').addEventListener('click', () => APP.updateNav('stats'));
    $('#customizeTop').addEventListener('click', openSettings);
    $('#closeSettings').addEventListener('click', closeSettings);
    $('#planForm').addEventListener('submit', generatePlan);
    $$('select[name="weeklyMinutes"], select[name="daysPerWeek"]').forEach((select) => {
      select.addEventListener('change', updateDerivedMinutes);
    });
    $('#resetPlan').addEventListener('click', () => {
      state.profile = { weeklyMinutes: 240, daysPerWeek: 4, sessionMinutes: 60, level: 'zero', style: 'mixed', goal: '' };
      APP.persist();
      APP.renderAll();
      closeSettings();
      APP.showToast('已恢复默认：每周 4 小时，4 次 × 60 分钟。');
    });
    $('#showExcluded').addEventListener('click', openExcluded);
    $('#closeExcluded').addEventListener('click', closeExcluded);
    $('#closeVideo').addEventListener('click', closeVideo);
    $('#closeWarmup').addEventListener('click', closeWarmup);
    $('#installApp')?.addEventListener('click', installApp);
    $('#installAppModal')?.addEventListener('click', installApp);
    $('#warmupToggle').addEventListener('click', toggleWarmup);
    $$('.warmup-options button').forEach((button) => {
      button.addEventListener('click', () => {
        warmupBpm = Number(button.dataset.bpm);
        $('#warmupBpm').textContent = `${warmupBpm} BPM`;
        $$('.warmup-options button').forEach((item) => item.classList.toggle('active', item === button));
        if (warmupPlaying) { stopWarmup(); toggleWarmup(); }
      });
    });
    $('#librarySearch').addEventListener('input', (event) => {
      APP.renderLibrary(undefined, event.target.value);
    });
    $('#clearHistory').addEventListener('click', () => {
      if (!confirm('只清除本浏览器中的练习记录，确认吗？')) return;
      state.completed = {};
      state.history = [];
      APP.persist();
      APP.renderAll();
      APP.showToast('本地练习记录已清除。');
    });
    $('#exportData').addEventListener('click', () => {
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
        if (backdrop.id === 'settingsModal') closeSettings();
        else if (backdrop.id === 'excludedModal') closeExcluded();
        else if (backdrop.id === 'warmupModal') closeWarmup();
        else if (backdrop.id === 'videoModal') closeVideo();
      });
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if (!$('#settingsModal').classList.contains('hidden')) closeSettings();
        else if (!$('#excludedModal').classList.contains('hidden')) closeExcluded();
        else if (!$('#videoModal').classList.contains('hidden')) closeVideo();
        else if (!$('#warmupModal').classList.contains('hidden')) closeWarmup();
      }
    });
  }

  APP.openSession = openSession;
  APP.openSettings = openSettings;
  APP.finishSession = finishSession;

  async function init() {
    if (location.protocol === 'file:') {
      bindEvents();
      APP.renderAll();
      const page = (location.hash || '#today').replace('#', '');
      if (['today', 'path', 'library', 'stats'].includes(page)) APP.updateNav(page);
      return;
    }
    try {
      const response = await fetch('/api/health', { cache: 'no-store' });
      if (response.ok) {
        window.PIANO_BACKEND_AVAILABLE = true;
        $('#backendNote').textContent = '已连接本地服务：计划与练习记录会同步到 data/state.json。';
        const saved = await fetch('/api/state', { cache: 'no-store' });
        if (saved.ok) {
          const serverState = await saved.json();
          if (serverState && serverState.history && !state.history.length) {
            Object.assign(state, serverState);
            APP.persist();
          }
        }
      }
    } catch (error) {
      window.PIANO_BACKEND_AVAILABLE = false;
    }
    bindEvents();
    APP.renderAll();
    const page = (location.hash || '#today').replace('#', '');
    if (['today', 'path', 'library', 'stats'].includes(page)) APP.updateNav(page);
  }

  init();
})();
