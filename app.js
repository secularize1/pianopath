(() => {
  const DATA = window.PIANO_DATA;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const STORAGE_KEY = 'pianopath-state-v1';
  const DAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
  const PHASE_COLORS = { '起步': '#5bbd78', '基础 I': '#f3cf66', '基础 II': '#ef8d78', '进阶 I': '#7ab6d9', '进阶 II': '#9d8ad6', '巩固': '#6eb98b', '展示': '#1f2a24' };
  const MASTERY_PASS_PERCENT = 67;

  const defaultState = {
    profile: { weeklyMinutes: 240, daysPerWeek: 4, sessionMinutes: 60, level: 'zero', style: 'mixed', goal: '', startWeek: 1, practiceDays: [1, 3, 5, 6], practiceTime: '20:00' },
    completed: {},
    history: [],
    activeSession: null,
    gameSessions: [],
    repertoire: {},
    placement: null,
    quickPractice: null,
    mastery: {},
    playAlong: {},
    reviews: {},
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

  function dateKeyFromOffset(offset) {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + offset);
    return localDateKey(date);
  }

  function addReviewItem(sourceId, title, reason, dueInDays = 0, details = {}) {
    if (!sourceId) return;
    const previous = state.reviews?.[sourceId] || {};
    const candidateDueAt = dateKeyFromOffset(Math.max(0, Number(dueInDays) || 0));
    const dueAt = previous.dueAt && previous.dueAt < candidateDueAt ? previous.dueAt : candidateDueAt;
    state.reviews = {
      ...(state.reviews || {}),
      [sourceId]: {
        sourceId,
        title,
        reason,
        level: 0,
        dueAt,
        lapseCount: (Number(previous.lapseCount) || 0) + 1,
        lastReviewedAt: previous.lastReviewedAt || null,
        createdAt: previous.createdAt || new Date().toISOString(),
        ...details
      }
    };
  }

  function dueReviewItems() {
    const today = localDateKey(new Date());
    return Object.values(state.reviews || {})
      .filter((item) => item && item.dueAt && item.dueAt <= today)
      .sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt)));
  }

  function reviewIsDue(item) {
    return Boolean(item && item.dueAt && item.dueAt <= localDateKey(new Date()));
  }

  function completeReviewItem(sourceId, success) {
    const previous = state.reviews?.[sourceId];
    if (!previous) return;
    if (success) {
      const nextLevel = Math.min(5, (Number(previous.level) || 0) + 1);
      const intervals = [1, 2, 4, 8, 15, 31];
      state.reviews = {
        ...state.reviews,
        [sourceId]: {
          ...previous,
          level: nextLevel,
          dueAt: dateKeyFromOffset(intervals[nextLevel]),
          lastReviewedAt: new Date().toISOString(),
          lastResult: 'passed'
        }
      };
    } else {
      state.reviews = {
        ...state.reviews,
        [sourceId]: {
          ...previous,
          level: 0,
          dueAt: dateKeyFromOffset(0),
          lastReviewedAt: new Date().toISOString(),
          lastResult: 'retry'
        }
      };
    }
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

  const PRACTICE_DAYS = [
    { value: 1, label: '周一', short: '一' },
    { value: 2, label: '周二', short: '二' },
    { value: 3, label: '周三', short: '三' },
    { value: 4, label: '周四', short: '四' },
    { value: 5, label: '周五', short: '五' },
    { value: 6, label: '周六', short: '六' },
    { value: 0, label: '周日', short: '日' }
  ];

  function defaultPracticeDays(count = 4) {
    const presets = { 1: [1], 2: [2, 6], 3: [1, 3, 6], 4: [1, 3, 5, 6], 5: [1, 2, 4, 5, 6], 6: [1, 2, 3, 4, 5, 6], 7: PRACTICE_DAYS.map((day) => day.value) };
    return presets[Math.max(1, Math.min(7, Number(count) || 4))];
  }

  function sanitizePracticeDays(value) {
    const allowed = new Set(PRACTICE_DAYS.map((day) => day.value));
    return Array.from(new Set(Array.isArray(value) ? value.map(Number).filter((day) => allowed.has(day)) : [])).slice(0, 7);
  }

  function normalizePracticeDays(value, count = 4) {
    const wanted = Math.max(1, Math.min(7, Number(count) || 4));
    const unique = sanitizePracticeDays(value).slice(0, wanted);
    if (!unique.length) return defaultPracticeDays(wanted);
    const defaults = defaultPracticeDays(wanted).filter((day) => !unique.includes(day));
    return [...unique, ...defaults].slice(0, wanted);
  }

  function sanitizePracticeTime(value) {
    const match = String(value || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    return match ? `${match[1]}:${match[2]}` : '20:00';
  }

  function relativePracticeDayLabel(practiceDay) {
    const now = new Date();
    now.setHours(12, 0, 0, 0);
    const delta = (Number(practiceDay) - now.getDay() + 7) % 7;
    if (delta === 0) return '今天';
    if (delta === 1) return '明天';
    return practiceDayLabel(practiceDay);
  }

  function formattedNextPracticeDay(practiceDay) {
    const date = dateForPracticeDay(practiceDay);
    return `${relativePracticeDayLabel(practiceDay)} · ${date.getMonth() + 1}/${date.getDate()}`;
  }

  function icsEscape(value) {
    return String(value ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  }

  function icsDateTime(date) {
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}00Z`;
  }

  function calendarEventsForProfile(profile) {
    const time = sanitizePracticeTime(profile.practiceTime).split(':').map(Number);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const events = [];
    for (let week = 0; week < 12; week += 1) {
      for (const practiceDay of profile.practiceDays) {
        const date = new Date(today);
        const delta = (practiceDay - today.getDay() + 7) % 7;
        date.setDate(today.getDate() + delta + week * 7);
        date.setHours(time[0], time[1], 0, 0);
        events.push({ date, minutes: profile.sessionMinutes, day: practiceDay });
      }
    }
    return events.sort((a, b) => a.date - b.date);
  }

  function buildPracticeCalendar(profile) {
    const events = calendarEventsForProfile(profile);
    const stamp = icsDateTime(new Date());
    const body = events.map((event, index) => {
      const end = new Date(event.date.getTime() + event.minutes * 60000);
      return [
        'BEGIN:VEVENT',
        `UID:pianopath-${localDateKey(event.date)}-${index}@local`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${icsDateTime(event.date)}`,
        `DTEND:${icsDateTime(end)}`,
        `SUMMARY:${icsEscape('琴阶 · 钢琴练习')}`,
        `DESCRIPTION:${icsEscape('打开琴阶，完成今天的钢琴练习。')}`,
        'END:VEVENT'
      ].join('\r\n');
    }).join('\r\n');
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//PianoPath//Practice Schedule//ZH-CN', 'CALSCALE:GREGORIAN', body, 'END:VCALENDAR', ''].join('\r\n');
  }

  function exportPracticeCalendar(profileOverride = null) {
    const profile = profileOverride && typeof profileOverride === 'object' ? profileOverride : getPlanProfile();
    const blob = new Blob([buildPracticeCalendar(profile)], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'pianopath-practice.ics';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    window.PIANO_APP?.showToast('日历文件已生成，打开它即可加入系统日历。');
  }

  function practiceDayLabel(dayValue) {
    return PRACTICE_DAYS.find((day) => day.value === Number(dayValue))?.label || '';
  }

  function getPlanProfile() {
    const days = Math.max(1, Math.min(7, Number(state.profile.daysPerWeek) || 4));
    const practiceDays = normalizePracticeDays(state.profile.practiceDays, days);
    const practiceTime = sanitizePracticeTime(state.profile.practiceTime);
    const sessionMinutes = Math.max(10, Number(state.profile.sessionMinutes) || 60);
    return { ...state.profile, daysPerWeek: days, practiceDays, practiceTime, sessionMinutes, weeklyMinutes: days * sessionMinutes };
  }

  function dateForPracticeDay(practiceDay) {
    const now = new Date();
    now.setHours(12, 0, 0, 0);
    const delta = (Number(practiceDay) - now.getDay() + 7) % 7;
    const date = new Date(now);
    date.setDate(now.getDate() + delta);
    return date;
  }

  function formattedPracticeDay(practiceDay) {
    const date = dateForPracticeDay(practiceDay);
    return `${practiceDayLabel(practiceDay)} · ${date.getMonth() + 1}/${date.getDate()}`;
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
    const orderedDays = [...profile.practiceDays].sort((a, b) => {
      const nowDay = new Date().getDay();
      return ((a - nowDay + 7) % 7) - ((b - nowDay + 7) % 7);
    });
    const indices = sessionIndicesForDays(profile.daysPerWeek, week.sessions.length);
    return indices.map((baseIndex, index) => {
      const base = week.sessions[baseIndex];
      const duplicate = profile.daysPerWeek > week.sessions.length && index >= week.sessions.length;
      return {
        ...base,
        id: duplicate ? `${base.id}-p${index + 1}` : base.id,
        day: index + 1,
        practiceDay: orderedDays[index % orderedDays.length],
        practiceTime: profile.practiceTime,
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
      setText('#homeLessonIndex', `${resumable ? '继续 · ' : ''}${formattedNextPracticeDay(current.practiceDay)} · ${current.practiceTime} · 第 ${current.day} 次`);
      setText('#homeLessonTitle', current.title);
      setText('#homeLessonGoal', current.goal);
      setText('#homeLessonDuration', `${current.duration} 分钟`);
      setText('#homeWeekProgress', `${weekDone} / ${sessions.length}`);
      setText('#homeArtWeek', `${weekDone} / ${sessions.length}`);
      setText('#homeWeekTitle', `${sessions.length} 次练习，按你的练习日完成`);

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
          <span class="trail-copy"><small>${escapeHtml(formattedPracticeDay(item.practiceDay))} · ${escapeHtml(item.practiceTime)} · ${item.duration} 分钟</small><strong>${escapeHtml(item.title)}</strong><em>${escapeHtml(item.goal)}</em></span>
          ${isCurrent ? '<span class="trail-now">现在</span>' : ''}
        </button>`;
      }).join('');
    }

    const todayKey = localDateKey(new Date());
    const gameToday = (state.gameSessions || []).filter((item) => item.date === todayKey);
    const playAlongToday = state.history.filter((entry) => entry.date === todayKey && entry.type === 'playalong');
    const freePlayToday = state.history.filter((entry) => entry.date === todayKey && entry.type === 'freeplay');
    const todayMinutes = minutesForDate(todayKey);
    const todayLesson = state.history.some((entry) => entry.date === todayKey && !['game', 'playalong', 'freeplay'].includes(entry.type));
    const todayGame = gameToday.length > 0 || playAlongToday.length > 0 || freePlayToday.length > 0;
    const dueReviews = dueReviewItems();
    const quests = [
      { done: todayLesson, label: '完成 1 次课程练习', detail: todayLesson ? '已完成' : '开始今日课程' },
      { done: todayGame, label: '完成一次短练或音乐游戏', detail: gameToday.length || playAlongToday.length || freePlayToday.length ? `今日 ${gameToday.length + playAlongToday.length + freePlayToday.length} 次` : '约 2 分钟' },
      { done: todayMinutes >= 20, label: '累计练习 20 分钟', detail: `${Math.min(todayMinutes, 20)} / 20 分钟` }
    ];
    const questList = document.querySelector('#dailyQuestList');
    if (questList) {
      questList.innerHTML = quests.map((quest) => `<div class="daily-quest ${quest.done ? 'done' : ''}"><span class="quest-check">${quest.done ? '✓' : ''}</span><span><strong>${escapeHtml(quest.label)}</strong><small>${escapeHtml(quest.detail)}</small></span></div>`).join('');
      const questCount = document.querySelector('#dailyQuestCount');
      const completedQuests = quests.filter((quest) => quest.done).length;
      if (questCount) questCount.textContent = `${completedQuests} / 3`;
      document.querySelector('#dailyQuestCelebration')?.classList.toggle('hidden', completedQuests < quests.length);
    }

    const todayEntries = state.history.filter((entry) => entry.date === todayKey);
    const todayLessonAttempts = todayEntries.filter((entry) => !['quick', 'playalong', 'game', 'repertoire', 'freeplay'].includes(entry.type));
    const todayMasteryEntry = todayLessonAttempts.find((entry) => Number(state.mastery?.[entry.id]?.best || 0) >= MASTERY_PASS_PERCENT);
    const mainDone = todayLessonAttempts.length > 0;
    const checkDone = Boolean(todayMasteryEntry);
    const routeMain = document.querySelector('#routeMain');
    const routeCheck = document.querySelector('#routeCheck');
    const routeDone = document.querySelector('#routeDone');
    if (routeMain) routeMain.className = mainDone ? 'done' : 'active';
    if (routeCheck) routeCheck.className = checkDone ? 'done' : mainDone ? 'active' : '';
    if (routeDone) routeDone.className = checkDone ? 'done active' : '';

    const dueReviewLink = document.querySelector('#dueReviewLink');
    if (dueReviewLink) {
      dueReviewLink.textContent = dueReviews.length ? `有 ${dueReviews.length} 个到期复习 →` : '复习队列已清空';
      dueReviewLink.disabled = !dueReviews.length;
    }
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

  function stagePractice(stage) {
    return {
      id: `stage-${stage.id}-${Date.now()}`,
      sourceId: `stage-${stage.id}`,
      title: `阶段训练：${stage.label}`,
      week: 0,
      day: 1,
      duration: 60,
      quick: true,
      stageId: stage.id,
      stageLabel: stage.label,
      goal: `${stage.focus || stage.description} · 晋级标准：${stage.advanceRule}`,
      steps: [
        { start: 0, end: 8, minutes: 8, title: '热身与听感', category: '热身', detail: '先做肩膀、手腕和坐姿校准，再跟 60 BPM 空拍 2 小节。', cue: '松肩、踩实、先听再动' },
        { start: 8, end: 20, minutes: 12, title: '技术与音阶', category: '技术', detail: `围绕“${stage.focus}”练一个技术单元：分手、慢速、连续三次正确。`, cue: '慢练不是走流程' },
        { start: 20, end: 38, minutes: 18, title: '核心曲目拆解', category: '曲目', detail: `从 ${stage.repertoire?.join(' / ') || '当前阶段曲目'} 选 2–4 小节，拆分难点并逐步合手。`, cue: '一次只处理一个难点' },
        { start: 38, end: 48, minutes: 10, title: '陌生谱视奏', category: '读谱', detail: '选 8–16 小节陌生谱，先看调号、拍号与节奏，再不停顿地走一遍。', cue: '连续比完美重要' },
        { start: 48, end: 56, minutes: 8, title: '连接与表达', category: '曲目', detail: '把今天拆解的片段接回前后文，加入一个清楚的起句和收束。', cue: '让音乐先发生' },
        { start: 56, end: 60, minutes: 4, title: '录音与晋级记录', category: '反馈', detail: `录下 20–30 秒，并对照晋级标准：${stage.advanceRule}`, cue: '只记录一个下一步' }
      ],
      sources: DATA.weeks[0]?.sessions?.[0]?.sources || []
    };
  }

  function startStagePractice(stageId) {
    const stage = (DATA.stages || []).find((item) => item.id === stageId);
    if (!stage) return;
    window.PIANO_OPEN_SESSION?.(stagePractice(stage));
  }

  function renderStages() {
    const stageGrid = $('#stageGrid');
    if (!stageGrid) return;
    const colors = { mint: '#5bbd78', sun: '#d6ad2f', coral: '#e6806a', violet: '#9581ce', ink: '#4d6856' };
    stageGrid.innerHTML = (DATA.stages || []).map((stage, index) => `<button type="button" class="stage-card" data-stage-practice="${escapeHtml(stage.id)}" style="--stage-color:${colors[stage.color] || colors.mint}"><div class="stage-rank"><span>${escapeHtml(stage.range)}</span><em>${escapeHtml(stage.grade)}</em></div><h3>${escapeHtml(stage.label)}</h3><p>${escapeHtml(stage.description)}</p><div class="stage-focus">${escapeHtml(stage.focus || '')}</div><ul>${(stage.goals || []).map((goal) => `<li>${escapeHtml(goal)}</li>`).join('')}</ul><span class="stage-start">开始 60 分钟训练 →</span></button>`).join('');
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
    const reviewEntries = (state.history || []).filter((entry) => !['game', 'freeplay'].includes(entry.type) && (entry.rating <= 2 || entry.notes)).length;
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

    const reviewItems = dueReviewItems();
    const reviewList = document.querySelector('#reviewList');
    if (reviewList) {
      reviewList.innerHTML = reviewItems.length ? reviewItems.slice(0, 4).map((item, index) => `<button type="button" class="review-item" data-review-id="${escapeHtml(item.sourceId)}"><span class="review-number">${index + 1}</span><span><strong>${escapeHtml(String(item.title || '复习内容').replace('5 分钟快练：',''))}</strong><small>${escapeHtml(item.reason || '到期复习')} · 复习阶段 ${Math.min(5, Number(item.level) || 0)}/5</small></span><em>开始 →</em></button>`).join('') : '<div class="review-empty">今天的复习队列已清空。完成新课或记录卡点后，这里会自动排期。</div>';
      document.querySelector('#reviewCount').textContent = `${reviewItems.length} 项`;
      reviewList.querySelectorAll('[data-review-id]').forEach((button) => button.addEventListener('click', () => {
        const item = reviewItems.find((candidate) => candidate.sourceId === button.dataset.reviewId);
        if (!item) return;
        const found = window.PIANO_APP.findSession(item.sourceId);
        const piece = (window.PIANO_APP.DATA.repertoire || []).find((candidate) => candidate.id === item.sourceId);
        const source = found || piece;
        if (!source) {
          APP.showToast('这项复习的原始课程暂时找不到。');
          return;
        }
        const reviewSession = { ...source, id: `${source.id}-review-${Date.now()}`, sourceId: source.id, title: `复习：${source.title}`, duration: 10, quick: true, steps: [
          { start: 0, end: 2, minutes: 2, title: '旧问题定位', category: '复习', detail: item.notes || item.reason || '先找到上次最不稳的两小节。', cue: '不从头弹' },
          { start: 2, end: 7, minutes: 5, title: '慢速重练', category: '技术', detail: found?.steps?.[2]?.detail || source.goal, cue: '分手、慢速、连续三次正确' },
          { start: 7, end: 9, minutes: 2, title: '接回前后连接', category: '曲目', detail: '从问题小节前一小节进入，再接到后一小节。', cue: '连接比单点更重要' },
          { start: 9, end: 10, minutes: 1, title: '记录新状态', category: '反馈', detail: '再听/再弹一次，写下现在的感受。', cue: '只记一个变化' }
        ] };
        window.PIANO_OPEN_SESSION?.(reviewSession);
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
      $('#historyList').innerHTML = state.history.slice(0, 12).map((entry) => { const duration = entry.durationSeconds && Number(entry.durationSeconds) < 60 ? `${entry.durationSeconds} 秒` : `${entry.minutes} 分钟`; const context = entry.week ? `第 ${entry.week} 周` : entry.type === 'freeplay' ? '自由练习' : entry.type === 'playalong' ? '跟弹练习' : entry.type === 'game' ? '音乐游戏' : entry.type === 'quick' ? '短练' : entry.type === 'repertoire' ? '曲目训练' : '自主练习'; return `<div class="history-item"><span class="history-icon">♪</span><div><strong>${escapeHtml(entry.title)}</strong><small>${context} · ${entry.date} · ${entry.ratingLabel || '已记录'}${entry.notes ? ` · ${escapeHtml(entry.notes)}` : ''}</small></div><span>${duration}</span></div>`; }).join('');
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
    sessionsForWeek, currentWeekData, currentSessionData, streakCount,
    addReviewItem, completeReviewItem, dueReviewItems,
    renderLibrary, renderRepertoire, repertoireProgress, isSessionComplete: isComplete, totalXp, levelForXp,
    getPlanProfile, PRACTICE_DAYS, defaultPracticeDays, sanitizePracticeDays, normalizePracticeDays, sanitizePracticeTime, practiceDayLabel, relativePracticeDayLabel, dateForPracticeDay, formattedPracticeDay, formattedNextPracticeDay, buildPracticeCalendar, exportPracticeCalendar, startStagePractice,
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
  const LEGAL_VERSION = '2026-11-07';
  const LEGAL_SUMMARIES = {
    privacy: {
      eyebrow: 'PRIVACY',
      title: '隐私政策',
      items: [
        ['保存什么', '学习计划、进度、练习记录与可选账户信息。注册账户时，服务端保存邮箱、昵称和密码哈希，不保存明文密码。'],
        ['保存在哪里', '游客数据默认保存在当前浏览器。只有注册并连接账户服务后，进度才会同步到服务端。'],
        ['用于什么', '课程进度、跨设备同步、复习提醒、数据恢复与账户安全。不接入广告画像，不出售个人数据。'],
        ['你能做什么', '随时导出备份、清除本机数据、退出登录或删除账户与云端进度。删除账户不会自动清除本机记录。'],
        ['政策版本', '2026-11-07']
      ]
    },
    terms: {
      eyebrow: 'TERMS',
      title: '服务条款',
      items: [
        ['服务范围', '琴阶提供钢琴学习路径、练习工具与资源索引，不替代合格教师、考级认证或医疗建议。'],
        ['账户责任', '请妥善保管密码，并对账户下的操作负责。发现异常时立即退出登录并联系我们。'],
        ['内容与版权', '不托管受版权保护的完整曲谱，只链接公共领域或官方来源。第三方内容由其权利人负责。'],
        ['练习安全', '出现疼痛、麻木、眩晕或其他不适时立即停止，并寻求教师或医疗专业人员帮助。'],
        ['条款版本', '2026-11-07']
      ]
    }
  };
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
    { name: 'C', pc: 0, input: 'z', black: false },
    { name: 'C♯', pc: 1, input: 's', black: true },
    { name: 'D', pc: 2, input: 'x', black: false },
    { name: 'D♯', pc: 3, input: 'd', black: true },
    { name: 'E', pc: 4, input: 'c', black: false },
    { name: 'F', pc: 5, input: 'v', black: false },
    { name: 'F♯', pc: 6, input: 'g', black: true },
    { name: 'G', pc: 7, input: 'b', black: false },
    { name: 'G♯', pc: 8, input: 'h', black: true },
    { name: 'A', pc: 9, input: 'n', black: false },
    { name: 'A♯', pc: 10, input: 'j', black: true },
    { name: 'B', pc: 11, input: 'm', black: false }
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
      if (state.reviews?.[key]) APP.completeReviewItem(key, percent >= MASTERY_PASS_PERCENT);
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
        group.querySelectorAll('.choice-chip').forEach((chip) => {
          const active = Number(chip.dataset.value) === Number(activeValue) || chip.dataset.value === String(activeValue);
          chip.classList.toggle('active', active);
          chip.setAttribute('aria-pressed', String(active));
        });
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
    group.querySelectorAll('.choice-chip').forEach((chip) => {
      const active = chip === button;
      chip.classList.toggle('active', active);
      chip.setAttribute('aria-pressed', String(active));
    });
  }

  function saveOnboarding(event) {
    event.preventDefault();
    const weeklyMinutes = Number(onboardingChoices.weeklyMinutes) || 240;
    const daysPerWeek = weeklyMinutes >= 360 ? 6 : weeklyMinutes >= 300 ? 5 : 4;
    const profile = APP.getPlanProfile();
    APP.state.profile = {
      ...APP.state.profile,
      weeklyMinutes,
      daysPerWeek,
      practiceDays: APP.defaultPracticeDays(daysPerWeek),
      practiceTime: APP.sanitizePracticeTime(APP.state.profile.practiceTime),
      sessionMinutes: Math.round(weeklyMinutes / daysPerWeek),
      level: onboardingChoices.level,
      style: onboardingChoices.style,
      startWeek: Number(profile.startWeek) || 1
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
    if (planLength) planLength.textContent = session.repertoireId ? `曲目训练 · ${session.duration} 分钟` : session.stageId ? `阶段训练 · ${session.duration} 分钟` : session.quick ? '5 分钟快练' : `今天的 ${session.duration} 分钟`;
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
    } else if (session.stageId) {
      $('#completeSummary').textContent = `阶段训练完成 · ${session.stageLabel || session.title.replace('阶段训练：','')}`;
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
    const projectedDays = new Set([...APP.state.history.map((entry) => entry.date), localDateKey(new Date())]);
    $('#completeStreak').textContent = (() => {
      let cursor = new Date();
      cursor.setHours(12, 0, 0, 0);
      if (!projectedDays.has(localDateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
      let count = 0;
      while (projectedDays.has(localDateKey(cursor))) {
        count += 1;
        cursor.setDate(cursor.getDate() - 1);
      }
      return count;
    })();
    $('#completeXp').textContent = session.repertoireId ? '+15' : session.stageId ? '+15' : session.quick ? '+5' : passed ? '+20' : '+0';
    const saveButton = document.querySelector('#saveCompletion');
    if (saveButton) saveButton.textContent = !passed ? '保存练习，继续巩固' : session.repertoireId ? '保存阶段并返回曲目' : session.stageId ? '保存阶段训练' : session.quick ? '保存快练' : '保存，继续下一课';
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
      entry.needsReview = true;
      entry.notes = entry.notes || '掌握检查未通过：先复习错题对应的动作与听感，再重测。';
      entry.mastery = state.mastery?.[finished.id] || null;
      APP.addReviewItem(finished.id, finished.title, '掌握检查未通过', 0, { notes: entry.notes });
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
    if (finished.quick) entry.type = finished.repertoireId ? 'repertoire' : finished.stageId ? 'stage' : 'quick';
    if (finished.stageId) { entry.stageId = finished.stageId; entry.stageLabel = finished.stageLabel || ''; }
    const reviewSourceId = finished.sourceId || finished.id.replace(/-quick$/, '').replace(/-review-.*$/, '');
    if (finished.sourceId && /^复习：/.test(finished.title)) {
      APP.completeReviewItem(reviewSourceId, rating >= 3);
    } else if (entry.rating <= 2 || entry.notes) {
      APP.addReviewItem(reviewSourceId, finished.title.replace(/^5 分钟快练：/, ''), entry.rating <= 2 ? '练习感觉很卡' : '留下了具体问题', 1, { notes: entry.notes });
    }
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
    APP.showToast(finished.repertoireId ? '曲目阶段已保存，继续下一阶段。' : finished.stageId ? '阶段训练已保存，继续积累这次的关键动作。' : '已保存。下一课已经准备好。');
    if (finished.repertoireId) {
      APP.updateNav('repertoire');
      setTimeout(() => APP.renderRepertoire(), 180);
    } else if (finished.stageId) {
      APP.updateNav('path');
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

  let draftPracticeDays = [];

  function renderPracticeDayPicker(days = draftPracticeDays) {
    const selected = APP.sanitizePracticeDays(days);
    draftPracticeDays = selected;
    const picker = document.querySelector('#practiceDayPicker');
    if (picker) {
      picker.innerHTML = APP.PRACTICE_DAYS.map((day) => {
        const active = selected.includes(day.value);
        return `<button type="button" class="practice-day-chip ${active ? 'active' : ''}" data-practice-day="${day.value}" aria-pressed="${active}"><strong>${day.label}</strong><small>${APP.dateForPracticeDay(day.value).getMonth() + 1}/${APP.dateForPracticeDay(day.value).getDate()}</small></button>`;
      }).join('');
    }
    const summary = document.querySelector('#practiceDaySummary');
    if (summary) summary.textContent = selected.length ? `已选 ${selected.length} 天：${selected.map(APP.practiceDayLabel).join('、')}` : '至少选择 1 天';
    updateCalendarHint();
  }

  function updateCalendarHint() {
    const hint = document.querySelector('#calendarHint');
    if (!hint) return;
    const form = $('#planForm');
    const days = APP.sanitizePracticeDays(draftPracticeDays);
    const time = APP.sanitizePracticeTime(form?.practiceTime?.value);
    hint.textContent = `${days.length ? `每周 ${days.map(APP.practiceDayLabel).join('、')}` : '尚未选择练习日'} ${time} · 未来 12 周`;
  }

  function openSettings() {
    const profile = APP.getPlanProfile();
    const form = $('#planForm');
    form.weeklyMinutes.value = String(profile.weeklyMinutes || 240);
    form.daysPerWeek.value = String(profile.daysPerWeek || 4);
    form.level.value = profile.level || 'zero';
    form.style.value = profile.style || 'mixed';
    form.goal.value = profile.goal || '';
    form.practiceTime.value = profile.practiceTime;
    draftPracticeDays = profile.practiceDays;
    renderPracticeDayPicker(draftPracticeDays);
    updateDerivedMinutes();
    updateCalendarHint();
    const picker = document.querySelector('#practiceDayPicker');
    if (picker && !picker.children.length) renderPracticeDayPicker(APP.defaultPracticeDays(Number(profile.daysPerWeek) || 4));
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
    const practiceDays = APP.sanitizePracticeDays(draftPracticeDays);
    const practiceTime = APP.sanitizePracticeTime(form.practiceTime.value);
    if (practiceDays.length !== daysPerWeek) {
      draftPracticeDays = practiceDays;
      renderPracticeDayPicker(practiceDays);
      APP.showToast(`请选择 ${daysPerWeek} 个练习日；当前为 ${practiceDays.length} 天。`);
      return;
    }
    const profile = {
      weeklyMinutes,
      daysPerWeek,
      practiceDays,
      practiceTime,
      sessionMinutes: Math.max(10, Math.round(weeklyMinutes / daysPerWeek)),
      level: form.level.value,
      style: form.style.value,
      goal: form.goal.value.trim(),
      startWeek: Math.max(1, Math.min(12, Number(state.profile.startWeek) || 1))
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


  const RHYTHM_LEAD_BEATS = 3.5;
  // Two physical keyboard rows. Each row is a continuous chromatic run from low to high.
  // Lower row: C3-C4 (Z X C V B N M , . / ; ' Enter)
  // Upper row: C#4-D5 (Q W E R T Y U I O P [ ] \)
  const RHYTHM_KEYBOARD_ROWS = [
    {
      label: '下排 · 低音 C3–C4',
      keys: ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/', ';', "'", 'Enter'],
      codes: ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash', 'Semicolon', 'Quote', 'Enter'],
      notes: [48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60]
    },
    {
      label: '上排 · 高音 C#4–D5',
      keys: ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '[', ']', '\\'],
      codes: ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft', 'BracketRight', 'Backslash'],
      notes: [61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 74]
    }
  ];
  const RHYTHM_KEY_BY_NOTE = new Map(RHYTHM_KEYBOARD_ROWS.flatMap((row) => row.notes.map((note, index) => [note, row.keys[index]])));
  const RHYTHM_CODE_BY_NOTE = new Map(RHYTHM_KEYBOARD_ROWS.flatMap((row) => row.notes.map((note, index) => [note, row.codes[index]])));
  const RHYTHM_WHITE_KEYS = [
    { note: 48, name: 'C3', pc: 0 }, { note: 50, name: 'D3', pc: 2 }, { note: 52, name: 'E3', pc: 4 },
    { note: 53, name: 'F3', pc: 5 }, { note: 55, name: 'G3', pc: 7 }, { note: 57, name: 'A3', pc: 9 },
    { note: 59, name: 'B3', pc: 11 }, { note: 60, name: 'C4', pc: 0 }, { note: 62, name: 'D4', pc: 2 },
    { note: 64, name: 'E4', pc: 4 }, { note: 65, name: 'F4', pc: 5 }, { note: 67, name: 'G4', pc: 7 },
    { note: 69, name: 'A4', pc: 9 }, { note: 71, name: 'B4', pc: 11 }, { note: 72, name: 'C5', pc: 0 },
    { note: 74, name: 'D5', pc: 2 }
  ].map((key) => ({ ...key, key: RHYTHM_KEY_BY_NOTE.get(key.note), code: RHYTHM_CODE_BY_NOTE.get(key.note) }));
  const RHYTHM_BLACK_KEYS = [
    { note: 49, name: 'C#3', pc: 1 }, { note: 51, name: 'D#3', pc: 3 }, { note: 54, name: 'F#3', pc: 6 },
    { note: 56, name: 'G#3', pc: 8 }, { note: 58, name: 'A#3', pc: 10 }, { note: 61, name: 'C#4', pc: 1 },
    { note: 63, name: 'D#4', pc: 3 }, { note: 66, name: 'F#4', pc: 6 }, { note: 68, name: 'G#4', pc: 8 },
    { note: 70, name: 'A#4', pc: 10 }
  ].map((key) => ({ ...key, key: RHYTHM_KEY_BY_NOTE.get(key.note), code: RHYTHM_CODE_BY_NOTE.get(key.note) }));
  const FREE_PLAY_MIN_OFFSET = -2;
  const FREE_PLAY_MAX_OFFSET = 2;

  function rhythmKeysForOffset(offset = 0) {
    const delta = offset * 12;
    const rename = (name) => name.replace(/\d+/, (octave) => String(Number(octave) + offset));
    return {
      white: RHYTHM_WHITE_KEYS.map((key) => ({ ...key, note: key.note + delta, name: rename(key.name) })),
      black: RHYTHM_BLACK_KEYS.map((key) => ({ ...key, note: key.note + delta, name: rename(key.name) }))
    };
  }

  const RHYTHM_SONGS = [
    { id: 'twinkle', title: '小星星', composer: '法国民谣', difficulty: '入门', bpm: 82, color: '#5bbd78', notes: [[0, 60, .8], [.8, 60, .4], [1.2, 67, .8], [2, 67, .4], [2.4, 69, .8], [3.2, 69, .4], [3.6, 67, 1.2], [5.2, 65, .8], [6, 65, .4], [6.4, 64, .8], [7.2, 64, .4], [7.6, 62, .8], [8.4, 62, .4], [8.8, 60, 1.4]] },
    { id: 'ode', title: '欢乐颂', composer: '贝多芬', difficulty: '入门', bpm: 88, color: '#e7b44f', notes: [[0, 64, .7], [.7, 64, .7], [1.4, 65, .7], [2.1, 67, .7], [2.8, 67, .7], [3.5, 65, .7], [4.2, 64, .7], [4.9, 62, .7], [5.6, 60, .7], [6.3, 60, .7], [7, 62, .7], [7.7, 64, .7], [8.4, 64, 1.2]] },
    { id: 'mary', title: '玛丽有只小羔羊', composer: '美国民谣', difficulty: '入门', bpm: 76, color: '#8db9d6', notes: [[0, 64, .8], [.8, 62, .8], [1.6, 60, .8], [2.4, 62, .8], [3.2, 64, .8], [4, 64, .8], [4.8, 64, 1.2], [6.4, 62, .8], [7.2, 62, .8], [8, 62, 1.2]] },
    { id: 'jingle', title: 'Jingle Bells', composer: 'James Lord Pierpont', difficulty: '进阶', bpm: 96, color: '#e58c77', notes: [[0, 64, .6], [.6, 64, .6], [1.2, 64, 1], [2.6, 64, .6], [3.2, 64, .6], [3.8, 64, 1], [5.2, 64, .6], [5.8, 67, .6], [6.4, 60, .8], [7.2, 62, .6], [7.8, 64, 1.4]] },
    { id: 'frere', title: '雅克兄弟', composer: '法国民谣', difficulty: '入门', bpm: 84, color: '#82b9a3', notes: [[0, 60, .7], [.8, 62, .7], [1.6, 64, .7], [2.4, 60, .7], [3.2, 60, .7], [4, 62, .7], [4.8, 64, .7], [5.6, 60, 1.2], [7.2, 64, .7], [8, 65, .7], [8.8, 67, 1.4]] },
    { id: 'london', title: '伦敦桥', composer: '英国民谣', difficulty: '入门', bpm: 86, color: '#a88fc6', notes: [[0, 67, .7], [.8, 69, .7], [1.6, 67, .7], [2.4, 65, .7], [3.2, 64, .7], [4, 65, .7], [4.8, 67, 1.2], [6.4, 62, .7], [7.2, 64, .7], [8, 65, 1.4]] },
    { id: 'oldmacdonald', title: '老麦克唐纳', composer: '美国民谣', difficulty: '入门', bpm: 78, color: '#d19b67', notes: [[0, 67, .7], [.8, 67, .7], [1.6, 67, .7], [2.4, 62, .7], [3.2, 64, .7], [4, 64, .7], [4.8, 62, 1.2], [6.4, 71, .7], [7.2, 71, .7], [8, 69, .7], [8.8, 69, .7], [9.6, 67, 1.4]] },
    { id: 'auld', title: '友谊地久天长', composer: '苏格兰民谣', difficulty: '进阶', bpm: 74, color: '#729db5', notes: [[0, 60, .8], [.8, 65, .7], [1.6, 65, .7], [2.4, 65, .7], [3.2, 69, .7], [4, 67, .7], [4.8, 65, .7], [5.6, 67, .7], [6.4, 69, .7], [7.2, 65, .7], [8, 65, .7], [8.8, 69, .7], [9.6, 72, .7], [10.4, 74, 1.4]] }
  ];
  let rhythmDifficulty = '全部';
  let rhythmSong = null;
  let rhythmEvents = [];
  let rhythmStartedAt = 0;
  let rhythmTimer = null;
  let rhythmPaused = false;
  let rhythmScore = 0;
  let rhythmCombo = 0;
  let rhythmMaxCombo = 0;
  let rhythmHits = 0;
  let rhythmMisses = 0;
  let rhythmActive = false;
  let rhythmJudgementTimer = null;
  let rhythmCountdownTimer = null;
  let rhythmPausedAt = 0;
  let freePlayActive = false;
  let freePlayOctaveOffset = 0;
  let freePlayStartedAt = 0;
  let freePlayKeyCount = 0;
  let freePlayNotes = new Set();
  let freePlaySaved = false;
  let freeMetronomeActive = false;
  let freeMetronomeTimer = null;
  let freeMetronomeAudio = null;
  let freeMetronomeStep = 0;
  let freeMetronomeNextTime = 0;
  let freeTempo = Math.max(40, Math.min(208, Number(localStorage.getItem('pianopath-free-tempo')) || 80));
  let pianoLandscapeRequested = false;
  let pianoFullscreenOwned = false;
  let keyboardGuideOrigin = 'general';
  let keyboardGuidePracticed = new Set();

  const RHYTHM_NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  function computerKeyLabel(value) {
    return value === 'Enter' ? '↵' : value === '\\' ? '\\' : value.toUpperCase();
  }

  function pianoKeyboardMarkup(whiteKeys, blackKeys) {
    const blackLeft = [4.0, 10.25, 22.75, 29.0, 35.25, 47.75, 54.0, 66.5, 72.75, 79.0];
    const keyMarkup = (key, extra = '') => `<button type="button" class="rhythm-key ${key.black ? 'black' : 'white'}" data-note="${key.note}" data-key="${key.key}" data-code="${key.code}" ${extra} aria-label="${key.name}，键盘 ${computerKeyLabel(key.key)}" aria-keyshortcuts="${computerKeyLabel(key.key)}"><span>${key.name.replace(/\d/, '')}</span><small>${computerKeyLabel(key.key)}</small></button>`;
    const white = whiteKeys.map((key) => keyMarkup(key)).join('');
    const black = blackKeys.map((key, index) => keyMarkup({ ...key, black: true }, `style="left:${blackLeft[index]}%"`)).join('');
    return white + black;
  }

  function keyboardGuideMarkup() {
    return RHYTHM_KEYBOARD_ROWS.map((row) => {
      const keys = row.keys.map((key, index) => {
        const note = row.notes[index];
        const code = row.codes[index];
        const black = [1, 3, 6, 8, 10].includes(note % 12);
        const noteName = `${RHYTHM_NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}`;
        return `<button type="button" class="keyboard-guide-key ${black ? 'black' : 'white'}" data-guide-note="${note}" data-guide-code="${code}" aria-label="${noteName}，键盘 ${computerKeyLabel(key)}"><b>${computerKeyLabel(key)}</b><small>${noteName}</small></button>`;
      }).join('');
      return `<div class="keyboard-guide-row"><header><strong>${row.label.split(' · ')[0]}</strong><span>${row.label.split(' · ')[1]}</span></header><div class="keyboard-guide-keys">${keys}</div></div>`;
    }).join('');
  }

  function guideKeyForEvent(event) {
    return RHYTHM_KEYBOARD_ROWS.flatMap((row) => row.keys.map((key, index) => ({
      key,
      code: row.codes[index],
      note: row.notes[index],
      name: `${RHYTHM_NOTE_NAMES[row.notes[index] % 12]}${Math.floor(row.notes[index] / 12) - 1}`
    }))).find((candidate) => candidate.code === event.code || candidate.key.toLowerCase() === event.key.toLowerCase());
  }

  function previewKeyboardGuideKey(note, key) {
    playTone(261.63 * Math.pow(2, (note - 60) / 12), .28);
    const target = document.querySelector(`.keyboard-guide-key[data-guide-note="${note}"]`);
    target?.classList.add('pressed');
    setTimeout(() => target?.classList.remove('pressed'), 180);
    keyboardGuidePracticed.add(note);
    const status = document.querySelector('#keyboardGuideStatus');
    if (status) status.textContent = `${key.name} · ${computerKeyLabel(key.key)}`;
    const count = document.querySelector('#keyboardGuideCount');
    const progress = document.querySelector('.keyboard-guide-progress');
    if (count) count.textContent = keyboardGuidePracticed.size >= 3 ? '3 / 3 ✓' : `${keyboardGuidePracticed.size} / 3`;
    if (progress) progress.classList.toggle('complete', keyboardGuidePracticed.size >= 3);
  }

  function handleKeyboardGuideKeydown(event) {
    const modal = document.querySelector('#keyboardGuideModal');
    if (!modal || modal.classList.contains('hidden')) return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    const key = guideKeyForEvent(event);
    if (!key) return;
    event.preventDefault();
    previewKeyboardGuideKey(key.note, key);
  }

  function rhythmKeyboardMarkup() {
    return pianoKeyboardMarkup(RHYTHM_WHITE_KEYS, RHYTHM_BLACK_KEYS);
  }

  function renderRhythmSongs() {
    const grid = document.querySelector('#rhythmSongGrid');
    if (!grid) return;
    document.querySelectorAll('[data-rhythm-filter]').forEach((button) => {
      const active = button.dataset.rhythmFilter === rhythmDifficulty;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const songs = rhythmDifficulty === '全部' ? RHYTHM_SONGS : RHYTHM_SONGS.filter((song) => song.difficulty === rhythmDifficulty);
    grid.innerHTML = songs.map((song) => {
      const progress = state.playAlong?.[`rhythm-${song.id}`];
      const best = Math.max(0, Math.min(100, Number(progress?.bestAccuracy) || 0));
      const bestText = progress ? `最佳 ${best}%` : '开始';
      return `<button type="button" class="rhythm-song-card" data-rhythm-song="${song.id}" data-best="${best}" data-difficulty="${escapeUi(song.difficulty)}" style="--song-color:${song.color}"><span class="rhythm-song-art"><i></i><b>♪</b></span><span class="rhythm-song-copy"><small>${escapeUi(song.difficulty)}</small><strong>${escapeUi(song.title)}</strong><em>${escapeUi(song.composer)} · ${song.bpm} BPM</em></span><span class="rhythm-song-best">${bestText}</span><span class="rhythm-song-play">▶</span></button>`;
    }).join('') || '<div class="rhythm-song-empty">这个难度还没有曲目。</div>';
    grid.querySelectorAll('[data-rhythm-song]').forEach((button) => button.addEventListener('click', () => startRhythmPiano(button.dataset.rhythmSong)));
  }

  function freePlayRangeLabel() {
    return `C${3 + freePlayOctaveOffset}–D${5 + freePlayOctaveOffset}`;
  }

  function renderFreePlayKeyboard() {
    const keyboard = document.querySelector('#freePlayKeyboard');
    if (!keyboard) return;
    const keys = rhythmKeysForOffset(freePlayOctaveOffset);
    keyboard.innerHTML = pianoKeyboardMarkup(keys.white, keys.black);
    const label = document.querySelector('#freePlayOctaveLabel');
    if (label) label.textContent = freePlayRangeLabel();
    const down = document.querySelector('#freeOctaveDown');
    const up = document.querySelector('#freeOctaveUp');
    if (down) down.disabled = freePlayOctaveOffset <= FREE_PLAY_MIN_OFFSET;
    if (up) up.disabled = freePlayOctaveOffset >= FREE_PLAY_MAX_OFFSET;
  }

  function playFreePianoNote(note) {
    const keys = rhythmKeysForOffset(freePlayOctaveOffset);
    const key = [...keys.white, ...keys.black].find((candidate) => candidate.note === note);
    if (!key) return;
    playTone(261.63 * Math.pow(2, (note - 60) / 12), .34);
    freePlayKeyCount += 1;
    freePlayNotes.add(note);
    const keyCountLabel = document.querySelector('#freePlayKeyCount');
    const uniqueCountLabel = document.querySelector('#freePlayUniqueCount');
    if (keyCountLabel) keyCountLabel.textContent = `${freePlayKeyCount} 次触键`;
    if (uniqueCountLabel) uniqueCountLabel.textContent = `${freePlayNotes.size} 个音`;
    const keyElement = document.querySelector(`#freePlayKeyboard .rhythm-key[data-note="${note}"]`);
    keyElement?.classList.add('pressed');
    setTimeout(() => keyElement?.classList.remove('pressed'), 130);
    const noteLabel = document.querySelector('#freePlayNote');
    const lastLabel = document.querySelector('#freePlayLastNote');
    if (noteLabel) noteLabel.textContent = key.name;
    if (lastLabel) lastLabel.textContent = `刚刚弹了 ${key.name}`;
  }

  function pianoIsLandscape() {
    return window.matchMedia?.('(orientation: landscape)').matches || document.querySelector('#rhythmPianoModal')?.classList.contains('piano-force-landscape');
  }

  function syncPianoLandscapeState() {
    const modal = document.querySelector('#rhythmPianoModal');
    const button = document.querySelector('#freePlayLandscape');
    if (!modal || !button) return;
    if (pianoLandscapeRequested && !window.matchMedia?.('(orientation: landscape)').matches) modal.classList.add('piano-force-landscape');
    else modal.classList.remove('piano-force-landscape');
    const active = pianoLandscapeRequested || pianoIsLandscape();
    button.textContent = active ? '退出横屏' : '横屏弹奏';
    button.setAttribute('aria-pressed', String(active));
  }

  async function exitPianoLandscape() {
    const modal = document.querySelector('#rhythmPianoModal');
    pianoLandscapeRequested = false;
    modal?.classList.remove('piano-force-landscape');
    try { screen.orientation?.unlock?.(); } catch (error) {}
    if (pianoFullscreenOwned && document.fullscreenElement) {
      try { await document.exitFullscreen?.(); } catch (error) {}
    }
    pianoFullscreenOwned = false;
    syncPianoLandscapeState();
  }

  async function enterPianoLandscape() {
    const modal = document.querySelector('#rhythmPianoModal');
    const card = document.querySelector('#rhythmPianoCard');
    if (!modal || !card) return;
    if (pianoLandscapeRequested) {
      await exitPianoLandscape();
      APP.showToast('已退出横屏弹奏。');
      return;
    }
    pianoLandscapeRequested = true;
    let orientationLocked = false;
    const canLockOrientation = typeof screen.orientation?.lock === 'function';
    try {
      if (canLockOrientation && !document.fullscreenElement && card.requestFullscreen) {
        await card.requestFullscreen({ navigationUI: 'hide' });
        pianoFullscreenOwned = true;
      }
    } catch (error) {}
    try {
      if (canLockOrientation) {
        await screen.orientation.lock('landscape');
        orientationLocked = true;
      }
    } catch (error) {}
    await new Promise((resolve) => setTimeout(resolve, 220));
    // Fullscreen applies a fixed viewport-sized box. If orientation lock failed,
    // release it before using the rotated fallback; otherwise the two layouts fight.
    if (!orientationLocked && !window.matchMedia?.('(orientation: landscape)').matches && pianoFullscreenOwned && document.fullscreenElement) {
      try { await document.exitFullscreen?.(); } catch (error) {}
      pianoFullscreenOwned = false;
    }
    syncPianoLandscapeState();
    if (modal.classList.contains('piano-force-landscape')) APP.showToast('横屏模式已开启；请把手机横过来弹奏。');
  }

  function setFreeTempo(nextTempo) {
    freeTempo = Math.max(40, Math.min(208, Math.round(Number(nextTempo) / 4) * 4));
    localStorage.setItem('pianopath-free-tempo', String(freeTempo));
    const label = document.querySelector('#freeTempoValue');
    if (label) label.textContent = String(freeTempo);
    if (freeMetronomeActive && freeMetronomeAudio) {
      freeMetronomeNextTime = Math.max(freeMetronomeNextTime, freeMetronomeAudio.currentTime + 60 / freeTempo);
    }
  }

  function flashFreeMetronomeBeat(beat) {
    document.querySelectorAll('#freeBeatDots i').forEach((dot, index) => {
      dot.classList.toggle('active', index === beat);
    });
    const button = document.querySelector('#freeMetronomeToggle');
    if (button) button.dataset.beat = String(beat);
  }

  function scheduleFreeMetronomeClick(time, beat) {
    const context = freeMetronomeAudio;
    if (!context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(beat === 0 ? 1050 : 760, time);
    gain.gain.setValueAtTime(beat === 0 ? .055 : .032, time);
    gain.gain.exponentialRampToValueAtTime(.001, time + .045);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(time);
    oscillator.stop(time + .05);
  }

  function freeMetronomeScheduler() {
    if (!freeMetronomeActive || !freeMetronomeAudio) return;
    const context = freeMetronomeAudio;
    while (freeMetronomeNextTime < context.currentTime + .12) {
      const beat = freeMetronomeStep % 4;
      const delay = Math.max(0, (freeMetronomeNextTime - context.currentTime) * 1000);
      setTimeout(() => {
        if (freeMetronomeActive) flashFreeMetronomeBeat(beat);
      }, delay);
      scheduleFreeMetronomeClick(freeMetronomeNextTime, beat);
      freeMetronomeNextTime += 60 / freeTempo;
      freeMetronomeStep += 1;
    }
  }

  async function toggleFreeMetronome() {
    if (freeMetronomeActive) {
      stopFreeMetronome();
      return;
    }
    try {
      freeMetronomeAudio = freeMetronomeAudio || new (window.AudioContext || window.webkitAudioContext)();
      await freeMetronomeAudio.resume();
      freeMetronomeActive = true;
      freeMetronomeStep = 0;
      freeMetronomeNextTime = freeMetronomeAudio.currentTime + .08;
      freeMetronomeScheduler();
      freeMetronomeTimer = setInterval(freeMetronomeScheduler, 25);
      const button = document.querySelector('#freeMetronomeToggle');
      if (button) {
        button.classList.add('active');
        button.setAttribute('aria-pressed', 'true');
        button.setAttribute('aria-label', '关闭节拍器');
      }
    } catch (error) {
      APP.showToast('当前浏览器无法播放节拍器，请检查声音权限。');
    }
  }

  function stopFreeMetronome() {
    clearInterval(freeMetronomeTimer);
    freeMetronomeTimer = null;
    freeMetronomeActive = false;
    freeMetronomeStep = 0;
    const button = document.querySelector('#freeMetronomeToggle');
    if (button) {
      button.classList.remove('active');
      button.removeAttribute('data-beat');
      button.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-label', '开启节拍器');
    }
    document.querySelectorAll('#freeBeatDots i').forEach((dot) => dot.classList.remove('active'));
  }

  function openKeyboardGuide(origin = 'general') {
    const modal = document.querySelector('#keyboardGuideModal');
    const rows = document.querySelector('#keyboardGuideRows');
    if (!modal || !rows) return;
    keyboardGuideOrigin = origin;
    rows.innerHTML = keyboardGuideMarkup();
    const start = document.querySelector('#keyboardGuideStart');
    if (start) start.textContent = origin === 'freeplay' ? '开始自由弹' : origin === 'rhythm' ? '去选曲目' : '知道了';
    keyboardGuidePracticed = new Set();
    const status = document.querySelector('#keyboardGuideStatus');
    if (status) status.textContent = '按任意琴键试听；手机可直接点。';
    const count = document.querySelector('#keyboardGuideCount');
    if (count) count.textContent = '0 / 3';
    document.querySelector('.keyboard-guide-progress')?.classList.remove('complete');
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeKeyboardGuide() {
    const modal = document.querySelector('#keyboardGuideModal');
    if (!modal || modal.classList.contains('hidden')) return;
    modal.classList.add('hidden');
    localStorage.setItem('pianopath-keyboard-guide-seen', '1');
    document.body.style.overflow = document.querySelector('#rhythmPianoModal:not(.hidden)') ? 'hidden' : '';
  }

  function openFreePiano(showGuide = true) {
    stopRhythmPiano();
    stopFreePlay();
    freePlayActive = true;
    freePlayStartedAt = performance.now();
    freePlayKeyCount = 0;
    freePlayNotes = new Set();
    freePlaySaved = false;
    const keyCountLabel = document.querySelector('#freePlayKeyCount');
    const uniqueCountLabel = document.querySelector('#freePlayUniqueCount');
    if (keyCountLabel) keyCountLabel.textContent = '0 次触键';
    if (uniqueCountLabel) uniqueCountLabel.textContent = '0 个音';
    document.querySelector('#rhythmPianoHome')?.classList.add('hidden');
    document.querySelector('#rhythmPianoStage')?.classList.add('hidden');
    document.querySelector('#rhythmPianoResult')?.classList.add('hidden');
    document.querySelector('#rhythmFreePlay')?.classList.remove('hidden');
    const noteLabel = document.querySelector('#freePlayNote');
    const lastLabel = document.querySelector('#freePlayLastNote');
    if (noteLabel) noteLabel.textContent = '—';
    if (lastLabel) lastLabel.textContent = '按下琴键开始';
    renderFreePlayKeyboard();
    setFreeTempo(freeTempo);
    syncPianoLandscapeState();
    const guideShown = showGuide && localStorage.getItem('pianopath-keyboard-guide-seen') !== '1';
    if (guideShown) openKeyboardGuide('freeplay');
    return guideShown;
  }

  function saveFreePlaySession() {
    if (freePlaySaved || !freePlayStartedAt) return;
    freePlaySaved = true;
    const durationSeconds = Math.max(1, Math.min(1800, Math.round((performance.now() - freePlayStartedAt) / 1000) || 1));
    const elapsedMinutes = Math.floor(durationSeconds / 60);
    if (!freePlayKeyCount) return;
    const uniqueNotes = freePlayNotes.size;
    const today = localDateKey(new Date());
    const reviewsBeforeFreePlay = JSON.stringify(state.reviews || {});
    state.history = [{
      id: `free-play-${Date.now()}`,
      type: 'freeplay',
      title: '自由弹电子琴',
      week: 0,
      date: today,
      minutes: elapsedMinutes,
      durationSeconds,
      rating: 3,
      ratingLabel: '自由弹',
      notes: `${freePlayKeyCount} 次触键 · ${uniqueNotes} 个不同音 · ${durationSeconds} 秒`,
      sightDone: 0,
      freePlayKeys: freePlayKeyCount,
      freePlayUniqueNotes: uniqueNotes,
      completedAt: new Date().toISOString()
    }, ...state.history].slice(0, 400);
    state.reviews = JSON.parse(reviewsBeforeFreePlay);
    APP.persist();
    APP.renderAll();
    updateProgressDisplay();
    APP.showToast('自由弹练习已记入学习记录。');
  }

  function closeFreePiano() {
    closeKeyboardGuide();
    saveFreePlaySession();
    stopFreePlay();
    pianoLandscapeRequested = false;
    const modal = document.querySelector('#rhythmPianoModal');
    modal?.classList.remove('piano-force-landscape');
    try { screen.orientation?.unlock?.(); } catch (error) {}
    if (pianoFullscreenOwned && document.fullscreenElement) document.exitFullscreen?.().catch?.(() => {});
    pianoFullscreenOwned = false;
    document.querySelector('#rhythmFreePlay')?.classList.add('hidden');
    document.querySelector('#rhythmPianoHome')?.classList.remove('hidden');
    syncPianoLandscapeState();
    return false;
  }

  function stopFreePlay() {
    freePlayActive = false;
    freePlayStartedAt = 0;
    stopFreeMetronome();
    document.querySelectorAll('#freePlayKeyboard .rhythm-key.pressed').forEach((key) => key.classList.remove('pressed'));
  }

  function changeFreePlayOctave(delta) {
    const next = Math.max(FREE_PLAY_MIN_OFFSET, Math.min(FREE_PLAY_MAX_OFFSET, freePlayOctaveOffset + delta));
    if (next === freePlayOctaveOffset) return;
    freePlayOctaveOffset = next;
    renderFreePlayKeyboard();
    const noteLabel = document.querySelector('#freePlayNote');
    const lastLabel = document.querySelector('#freePlayLastNote');
    if (noteLabel) noteLabel.textContent = '—';
    if (lastLabel) lastLabel.textContent = `音域 ${freePlayRangeLabel()}`;
  }

  function openRhythmPiano() {
    stopRhythmPiano();
    stopFreePlay();
    document.querySelector('#rhythmFreePlay')?.classList.add('hidden');
    document.querySelector('#rhythmPianoHome')?.classList.remove('hidden');
    document.querySelector('#rhythmPianoStage')?.classList.add('hidden');
    document.querySelector('#rhythmPianoResult')?.classList.add('hidden');
    document.querySelector('#rhythmPianoModal')?.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    renderRhythmSongs();
  }

  function closeRhythmPiano() {
    closeKeyboardGuide();
    if (freePlayActive) saveFreePlaySession();
    stopRhythmPiano();
    stopFreePlay();
    pianoLandscapeRequested = false;
    document.querySelector('#rhythmPianoModal')?.classList.remove('piano-force-landscape');
    try { screen.orientation?.unlock?.(); } catch (error) {}
    if (pianoFullscreenOwned && document.fullscreenElement) document.exitFullscreen?.().catch?.(() => {});
    pianoFullscreenOwned = false;
    document.querySelector('#rhythmPianoModal')?.classList.add('hidden');
    document.body.style.overflow = '';
  }

  function stopRhythmPiano() {
    rhythmActive = false;
    rhythmPaused = false;
    clearInterval(rhythmTimer);
    clearInterval(rhythmCountdownTimer);
    clearTimeout(rhythmJudgementTimer);
    rhythmTimer = null;
    rhythmCountdownTimer = null;
    rhythmJudgementTimer = null;
    document.querySelectorAll('.rhythm-note').forEach((note) => note.remove());
    document.querySelectorAll('.rhythm-key.pressed').forEach((key) => key.classList.remove('pressed'));
    document.querySelector('#rhythmPauseLayer')?.classList.add('hidden');
    document.querySelector('#rhythmCountdown')?.classList.add('hidden');
    const pauseButton = document.querySelector('#rhythmPause');
    if (pauseButton) pauseButton.textContent = '暂停';
  }

  function startRhythmPiano(songId) {
    stopRhythmPiano();
    rhythmSong = RHYTHM_SONGS.find((song) => song.id === songId) || RHYTHM_SONGS[0];
    rhythmEvents = rhythmSong.notes.map(([beat, note, duration], index) => ({ beat, note, duration, index, hit: false, missed: false, element: null }));
    rhythmScore = 0;
    rhythmCombo = 0;
    rhythmMaxCombo = 0;
    rhythmHits = 0;
    rhythmMisses = 0;
    rhythmPaused = false;
    rhythmActive = false;
    rhythmPausedAt = 0;
    document.querySelector('#rhythmNowPlaying').textContent = rhythmSong.title;
    document.querySelector('#rhythmScore').textContent = '0';
    document.querySelector('#rhythmCombo').textContent = '0';
    document.querySelector('#rhythmAccuracy').textContent = '100%';
    document.querySelector('#rhythmJudgement').textContent = '';
    const keyboard = document.querySelector('#rhythmKeyboard');
    if (keyboard) keyboard.innerHTML = rhythmKeyboardMarkup();
    const lanes = document.querySelector('#rhythmLanes');
    if (!lanes) return;
    lanes.innerHTML = RHYTHM_WHITE_KEYS.map((key) => `<div class="rhythm-lane" data-lane="${key.note}"><span class="rhythm-lane-key">${key.name.replace(/\d/, '')}</span></div>`).join('');
    document.querySelector('#rhythmPianoHome')?.classList.add('hidden');
    document.querySelector('#rhythmPianoResult')?.classList.add('hidden');
    document.querySelector('#rhythmPianoStage')?.classList.remove('hidden');
    startRhythmCountdown();
  }

  function startRhythmCountdown() {
    let value = 3;
    const layer = document.querySelector('#rhythmCountdown');
    layer?.classList.remove('hidden');
    if (layer) layer.textContent = String(value);
    clearInterval(rhythmCountdownTimer);
    rhythmCountdownTimer = setInterval(() => {
      value -= 1;
      if (value > 0) {
        if (layer) layer.textContent = String(value);
        return;
      }
      clearInterval(rhythmCountdownTimer);
      rhythmCountdownTimer = null;
      layer?.classList.add('hidden');
      rhythmStartedAt = performance.now() + (RHYTHM_LEAD_BEATS / rhythmSong.bpm) * 60000;
      rhythmActive = true;
      beginRhythmClock();
    }, 650);
  }

  function beginRhythmClock() {
    clearInterval(rhythmTimer);
    rhythmTimer = setInterval(() => {
      if (!rhythmActive || rhythmPaused) return;
      const elapsedBeats = ((performance.now() - rhythmStartedAt) / 60000) * rhythmSong.bpm;
      for (const event of rhythmEvents) {
        if (!event.element) {
          const lane = document.querySelector(`.rhythm-lane[data-lane="${event.note}"]`) || document.querySelector(`.rhythm-lane[data-lane="${event.note - 1}"]`) || document.querySelector(`.rhythm-lane[data-lane="${event.note + 1}"]`);
          if (!lane) continue;
          const note = document.createElement('span');
          const isSharp = RHYTHM_BLACK_KEYS.some((key) => key.note === event.note);
          note.className = `rhythm-note ${isSharp ? 'sharp' : ''}`;
          note.dataset.note = String(event.note);
          note.dataset.eventIndex = String(event.index);
          note.style.height = `${Math.min(48, 18 + event.duration * 15)}px`;
          lane.appendChild(note);
          event.element = note;
        }
        const hitLine = 88;
        const position = hitLine - ((event.beat - elapsedBeats) / RHYTHM_LEAD_BEATS) * hitLine;
        event.element.style.top = `${Math.max(-10, Math.min(100, position))}%`;
        if (!event.hit && !event.missed && elapsedBeats > event.beat + 0.32) {
          event.missed = true;
          rhythmMisses += 1;
          rhythmCombo = 0;
          event.element.classList.add('missed');
          updateRhythmHud('miss');
        }
      }
      if (elapsedBeats > rhythmEvents[rhythmEvents.length - 1].beat + 1.2) finishRhythmPiano();
    }, 36);
  }

  function updateRhythmHud(judgement = '') {
    document.querySelector('#rhythmScore').textContent = String(rhythmScore);
    document.querySelector('#rhythmCombo').textContent = String(rhythmCombo);
    const total = rhythmHits + rhythmMisses;
    document.querySelector('#rhythmAccuracy').textContent = `${total ? Math.round((rhythmHits / total) * 100) : 100}%`;
    if (judgement) {
      const label = document.querySelector('#rhythmJudgement');
      if (label) {
        label.textContent = judgement === 'perfect' ? 'PERFECT' : judgement === 'good' ? 'GOOD' : 'MISS';
        label.className = `rhythm-judgement ${judgement} show`;
        clearTimeout(rhythmJudgementTimer);
        rhythmJudgementTimer = setTimeout(() => label.classList.remove('show'), 480);
      }
    }
  }

  function pressRhythmKey(note) {
    if (!rhythmActive || rhythmPaused) return;
    const key = [...RHYTHM_WHITE_KEYS, ...RHYTHM_BLACK_KEYS].find((candidate) => candidate.note === note);
    if (!key) return;
    const nowBeat = ((performance.now() - rhythmStartedAt) / 60000) * rhythmSong.bpm;
    let target = null;
    let best = Infinity;
    for (const event of rhythmEvents) {
      if (event.hit || event.missed || event.note !== note) continue;
      const distance = Math.abs(event.beat - nowBeat);
      if (distance < best && distance <= 0.52) {
        best = distance;
        target = event;
      }
    }
    playTone(261.63 * Math.pow(2, (note - 60) / 12), .22);
    const keyElement = document.querySelector(`.rhythm-key[data-note="${note}"]`);
    keyElement?.classList.add('pressed');
    setTimeout(() => keyElement?.classList.remove('pressed'), 130);
    if (!target) {
      rhythmCombo = 0;
      updateRhythmHud('miss');
      return;
    }
    target.hit = true;
    rhythmHits += 1;
    rhythmCombo += 1;
    rhythmMaxCombo = Math.max(rhythmMaxCombo, rhythmCombo);
    const perfect = best <= 0.16;
    rhythmScore += perfect ? 100 : 65;
    rhythmScore += Math.min(50, rhythmCombo * 2);
    target.element?.classList.add('hit');
    updateRhythmHud(perfect ? 'perfect' : 'good');
  }

  function finishRhythmPiano() {
    if (!rhythmActive) return;
    rhythmActive = false;
    rhythmPaused = false;
    clearInterval(rhythmTimer);
    clearInterval(rhythmCountdownTimer);
    rhythmTimer = null;
    rhythmCountdownTimer = null;
    document.querySelector('#rhythmPauseLayer')?.classList.add('hidden');
    document.querySelector('#rhythmCountdown')?.classList.add('hidden');
    const pauseButton = document.querySelector('#rhythmPause');
    if (pauseButton) pauseButton.textContent = '暂停';
    const total = rhythmEvents.length;
    const accuracy = Math.round((rhythmHits / Math.max(1, total)) * 100);
    const xp = Math.max(5, Math.round(accuracy / 10));
    const stateKey = `rhythm-${rhythmSong.id}`;
    const old = state.playAlong?.[stateKey] || { attempts: 0, bestAccuracy: 0, bestStreak: 0, xp: 0 };
    state.playAlong = { ...(state.playAlong || {}), [stateKey]: { attempts: old.attempts + 1, bestAccuracy: Math.max(old.bestAccuracy, accuracy), bestStreak: Math.max(old.bestStreak, rhythmMaxCombo), lastAccuracy: accuracy, xp: Math.max(old.xp, xp), updatedAt: new Date().toISOString() } };
    state.history = [{ id: `rhythm-${Date.now()}`, type: 'playalong', title: `节奏钢琴：${rhythmSong.title}`, week: session?.week || 0, date: localDateKey(new Date()), minutes: 2, rating: accuracy >= 85 ? 4 : accuracy >= 60 ? 3 : 2, ratingLabel: '节奏钢琴', notes: `${accuracy}% 准确率，最高连击 ${rhythmMaxCombo}`, sightDone: 0, completedAt: new Date().toISOString() }, ...state.history].slice(0, 400);
    APP.persist();
    APP.renderAll();
    updateProgressDisplay();
    document.querySelector('#rhythmPianoStage')?.classList.add('hidden');
    document.querySelector('#rhythmPianoResult')?.classList.remove('hidden');
    document.querySelector('#rhythmResultTitle').textContent = rhythmSong.title;
    document.querySelector('#rhythmResultScore').textContent = String(rhythmScore);
    document.querySelector('#rhythmResultCombo').textContent = String(rhythmMaxCombo);
    document.querySelector('#rhythmResultAccuracy').textContent = `${accuracy}%`;
    document.querySelector('#rhythmResultXp').textContent = `+${xp} XP`;
    document.querySelector('#rhythmResultMessage').textContent = accuracy >= 90 ? '节奏非常稳，再来一遍挑战全连。' : accuracy >= 65 ? '旋律已经成形，下一次把落点接得更稳。' : '先慢速看清每条音轨，再来一次。';
  }

  function handleRhythmKeydown(event) {
    const modal = document.querySelector('#rhythmPianoModal');
    if (!rhythmActive || rhythmPaused || !modal || modal.classList.contains('hidden')) return;
    if (document.querySelector('#keyboardGuideModal:not(.hidden)')) return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    if (event.code === 'Space') {
      event.preventDefault();
      toggleRhythmPause();
      return;
    }
    const keys = [...RHYTHM_WHITE_KEYS, ...RHYTHM_BLACK_KEYS];
    const key = event.key.toLowerCase();
    const target = keys.find((candidate) => candidate.code === event.code) || keys.find((candidate) => candidate.key.toLowerCase() === key);
    if (!target) return;
    event.preventDefault();
    pressRhythmKey(target.note);
  }

  function handleFreePianoKeydown(event) {
    const modal = document.querySelector('#rhythmPianoModal');
    if (!freePlayActive || !modal || modal.classList.contains('hidden')) return;
    if (document.querySelector('#keyboardGuideModal:not(.hidden)')) return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    const keys = rhythmKeysForOffset(freePlayOctaveOffset);
    const key = event.key.toLowerCase();
    const candidates = [...keys.white, ...keys.black];
    const target = candidates.find((candidate) => candidate.code === event.code) || candidates.find((candidate) => candidate.key.toLowerCase() === key);
    if (!target) return;
    event.preventDefault();
    playFreePianoNote(target.note);
  }

  function toggleRhythmPause() {
    if (!rhythmActive) return;
    rhythmPaused = !rhythmPaused;
    if (rhythmPaused) rhythmPausedAt = performance.now();
    else if (rhythmPausedAt) {
      rhythmStartedAt += performance.now() - rhythmPausedAt;
      rhythmPausedAt = 0;
    }
    document.querySelector('#rhythmPauseLayer')?.classList.toggle('hidden', !rhythmPaused);
    const pauseButton = document.querySelector('#rhythmPause');
    if (pauseButton) pauseButton.textContent = rhythmPaused ? '继续' : '暂停';
  }

  function bindRhythmPianoEvents() {
    document.querySelector('#startRhythmPianoHome')?.addEventListener('click', openRhythmPiano);
    document.querySelector('#closeRhythmPiano')?.addEventListener('click', closeRhythmPiano);
    document.querySelector('#startFreePiano')?.addEventListener('click', () => {
      const guideShown = openFreePiano();
      if (!guideShown && window.matchMedia?.('(pointer: coarse)').matches && !window.matchMedia?.('(orientation: landscape)').matches) enterPianoLandscape();
    });
    document.querySelector('#freePlayBack')?.addEventListener('click', closeFreePiano);
    document.querySelector('#freePlayBackBottom')?.addEventListener('click', closeFreePiano);
    document.querySelector('#freePlayLandscape')?.addEventListener('click', enterPianoLandscape);
    document.querySelector('#freePlayKeyboard')?.addEventListener('pointerdown', (event) => {
      const key = event.target.closest('.rhythm-key');
      if (!key) return;
      event.preventDefault();
      playFreePianoNote(Number(key.dataset.note));
    });
    document.querySelector('#freeOctaveDown')?.addEventListener('click', () => changeFreePlayOctave(-1));
    document.querySelector('#freeOctaveUp')?.addEventListener('click', () => changeFreePlayOctave(1));
    document.querySelector('#freeTempoDown')?.addEventListener('click', () => setFreeTempo(freeTempo - 4));
    document.querySelector('#freeTempoUp')?.addEventListener('click', () => setFreeTempo(freeTempo + 4));
    document.querySelector('#freeMetronomeToggle')?.addEventListener('click', toggleFreeMetronome);
    document.querySelector('#rhythmHowTo')?.addEventListener('click', () => openKeyboardGuide('rhythm'));
    document.querySelector('#freePlayKeyboardGuide')?.addEventListener('click', () => openKeyboardGuide('freeplay'));
    document.querySelector('#closeKeyboardGuide')?.addEventListener('click', closeKeyboardGuide);
    document.querySelector('#keyboardGuideRows')?.addEventListener('click', (event) => {
      const button = event.target.closest('.keyboard-guide-key');
      if (!button) return;
      const key = guideKeyForEvent({ code: button.dataset.guideCode, key: '' });
      if (key) previewKeyboardGuideKey(Number(button.dataset.guideNote), key);
    });
    document.addEventListener('keydown', handleKeyboardGuideKeydown);
    document.querySelector('#keyboardGuideStart')?.addEventListener('click', () => {
      const startFromFreePlay = keyboardGuideOrigin === 'freeplay';
      closeKeyboardGuide();
      if (startFromFreePlay && window.matchMedia?.('(pointer: coarse)').matches && !window.matchMedia?.('(orientation: landscape)').matches) enterPianoLandscape();
    });
    document.addEventListener('keydown', handleFreePianoKeydown);
    document.querySelector('#rhythmKeyboard')?.addEventListener('pointerdown', (event) => {
      const key = event.target.closest('.rhythm-key');
      if (!key) return;
      event.preventDefault();
      pressRhythmKey(Number(key.dataset.note));
    });
    document.querySelector('#rhythmPlayAgain')?.addEventListener('click', () => startRhythmPiano(rhythmSong?.id));
    document.querySelector('#rhythmChooseAnother')?.addEventListener('click', openRhythmPiano);
    document.querySelector('#rhythmPause')?.addEventListener('click', toggleRhythmPause);
    document.querySelector('#rhythmQuit')?.addEventListener('click', openRhythmPiano);
    document.querySelector('#rhythmFullscreen')?.addEventListener('click', async () => {
      try { await document.querySelector('#rhythmPianoCard')?.requestFullscreen?.(); } catch (error) {}
    });
    document.querySelectorAll('[data-open-keyboard-guide]').forEach((button) => button.addEventListener('click', () => openKeyboardGuide('rhythm')));
    document.querySelector('#keyboardGuideModal')?.addEventListener('click', (event) => {
      if (event.target === event.currentTarget) closeKeyboardGuide();
    });
    document.querySelectorAll('[data-rhythm-filter]').forEach((button) => {
      button.addEventListener('click', () => {
        rhythmDifficulty = button.dataset.rhythmFilter;
        renderRhythmSongs();
      });
    });
    document.addEventListener('keydown', handleRhythmKeydown);
    window.addEventListener('orientationchange', syncPianoLandscapeState);
    window.addEventListener('resize', syncPianoLandscapeState);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') stopFreeMetronome();
    });
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement) pianoFullscreenOwned = false;
    });
  }

  function playAlongKeyMarkup() {
    const white = PLAY_ALONG_PITCHES.filter((pitch) => !pitch.black);
    const black = PLAY_ALONG_PITCHES.filter((pitch) => pitch.black);
    const blackLeft = { 1: 10.2, 3: 24.5, 6: 52.8, 8: 67.0, 10: 81.3 };
    const whiteKeys = white.map((pitch) => `<button class="playalong-key white" type="button" data-playalong-pc="${pitch.pc}" aria-label="${pitch.name} ${pitch.input.toUpperCase()} 键"><span>${pitch.name}</span><small>${pitch.input.toUpperCase()}</small></button>`).join('');
    const blackKeys = black.map((pitch) => `<button class="playalong-key black" type="button" style="left:${blackLeft[pitch.pc]}%" data-playalong-pc="${pitch.pc}" aria-label="${pitch.name} ${pitch.input.toUpperCase()} 键"><span>${pitch.name}</span><small>${pitch.input.toUpperCase()}</small></button>`).join('');
    return whiteKeys + blackKeys;
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

  let pendingConfirmation = null;

  function confirmAction({ title, body, confirmLabel = '确认', onConfirm }) {
    const modal = document.querySelector('#confirmActionModal');
    if (!modal || typeof onConfirm !== 'function') return;
    pendingConfirmation = { onConfirm };
    document.querySelector('#confirmActionTitle').textContent = title;
    document.querySelector('#confirmActionBody').textContent = body;
    document.querySelector('#confirmActionButton').textContent = confirmLabel;
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    syncModalFocus();
  }

  function closeConfirmAction() {
    pendingConfirmation = null;
    document.querySelector('#confirmActionModal')?.classList.add('hidden');
    document.body.style.overflow = (() => { const visible = document.querySelectorAll('.modal-backdrop:not(.hidden)'); return visible.length ? 'hidden' : ''; })();
    syncModalFocus();
  }

  function runConfirmedAction() {
    const action = pendingConfirmation;
    if (!action) return;
    pendingConfirmation = null;
    const button = document.querySelector('#confirmActionButton');
    if (button) button.disabled = true;
    try {
      const shouldClose = action.onConfirm();
      if (shouldClose !== false) closeConfirmAction();
    } catch (error) {
      APP.showToast('操作失败，请稍后再试。');
    } finally {
      if (button) button.disabled = false;
    }
  }
  const modalFocusState = { lastTrigger: null, currentModal: null };

  function isElementVisible(element) {
    if (!element || element.disabled || element.getAttribute('aria-hidden') === 'true') return false;
    if (element.closest('.hidden')) return false;
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function modalFocusables(modal) {
    return Array.from(modal.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'))
      .filter(isElementVisible);
  }

  function activateModalFocus(modal) {
    if (!modal || !modal.matches('.modal-backdrop')) return;
    if (modalFocusState.currentModal !== modal) {
      const active = document.activeElement;
      if (active && active !== document.body && !active.closest('.modal-backdrop')) modalFocusState.lastTrigger = active;
      modalFocusState.currentModal = modal;
      modal.setAttribute('aria-hidden', 'false');
    }
    window.requestAnimationFrame(() => {
      if (!modal || modal.classList.contains('hidden')) return;
      const preferred = modal.querySelector('[data-autofocus], .modal-close, button, input, select, textarea, a[href]');
      const first = isElementVisible(preferred) ? preferred : modalFocusables(modal)[0];
      first?.focus({ preventScroll: true });
    });
  }

  function releaseModalFocus(modal) {
    if (!modal) return;
    if (modalFocusState.currentModal === modal) {
      modalFocusState.currentModal = null;
      modal.setAttribute('aria-hidden', 'true');
      const trigger = modalFocusState.lastTrigger;
      modalFocusState.lastTrigger = null;
      if (trigger && document.contains(trigger) && isElementVisible(trigger)) {
        window.requestAnimationFrame(() => trigger.focus({ preventScroll: true }));
      }
    }
  }

  function syncModalFocus() {
    const visible = $$('.modal-backdrop').filter((modal) => !modal.classList.contains('hidden'));
    visible.forEach((modal) => modal.setAttribute('aria-hidden', 'false'));
    const target = visible[visible.length - 1] || null;
    const shell = document.querySelector('#appShell');
    if (shell) shell.inert = Boolean(target);
    if (target && target !== modalFocusState.currentModal) activateModalFocus(target);
    else if (!target && modalFocusState.currentModal) releaseModalFocus(modalFocusState.currentModal);
  }

  function trapModalTab(event) {
    if (event.key !== 'Tab') return;
    const modal = modalFocusState.currentModal;
    if (!modal || modal.classList.contains('hidden')) return;
    const focusables = modalFocusables(modal);
    if (!focusables.length) {
      event.preventDefault();
      modal.focus({ preventScroll: true });
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
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
      const stagePracticeButton = event.target.closest('[data-stage-practice]');
      if (stagePracticeButton) {
        APP.startStagePractice(stagePracticeButton.dataset.stagePractice);
        return;
      }
    });

    $('#startToday').addEventListener('click', () => openSession(APP.currentSessionData().id));
    $('#openAccount')?.addEventListener('click', openAccount);
    $('#profileButton')?.addEventListener('click', openAccount);
    document.querySelector('#accountPlanSettings')?.addEventListener('click', () => { closeAccount(); openSettings(); });
    document.querySelectorAll('[data-legal-view]').forEach((link) => link.addEventListener('click', (event) => {
      event.preventDefault();
      openLegalView(link.dataset.legalView);
    }));
    document.querySelector('#closeLegalView')?.addEventListener('click', closeLegalView);
    document.querySelectorAll('.account-tab').forEach((button) => button.addEventListener('click', () => setAccountMode(button.dataset.accountMode)));
    document.querySelector('#accountForm')?.addEventListener('submit', submitAccount);
    document.querySelector('#accountSubmit')?.addEventListener('click', () => {
      if (accountState.mode !== 'register' || document.querySelector('#accountForm input[name="consent"]')?.checked) return;
      const errorBox = document.querySelector('#accountError');
      if (errorBox) errorBox.textContent = '创建账户前，请先阅读并同意服务条款与隐私政策。';
    });
    document.querySelector('#closeAccount')?.addEventListener('click', closeAccount);
    document.querySelector('#continueGuest')?.addEventListener('click', closeAccount);
    document.querySelector('#continueLocal')?.addEventListener('click', closeAccount);
    document.querySelector('#accountSyncNow')?.addEventListener('click', () => syncNow({ force: true }));
    document.querySelector('#accountLogout')?.addEventListener('click', logoutAccount);
    document.querySelector('#accountDelete')?.addEventListener('click', openDeleteAccountConfirm);
    document.querySelector('#closeDeleteAccount')?.addEventListener('click', closeDeleteAccountConfirm);
    document.querySelector('#cancelDeleteAccount')?.addEventListener('click', closeDeleteAccountConfirm);
    document.querySelector('#confirmDeleteAccount')?.addEventListener('click', deleteAccount);
    document.querySelector('#closeConfirmAction')?.addEventListener('click', () => closeConfirmAction());
    document.querySelector('#cancelConfirmAction')?.addEventListener('click', () => closeConfirmAction());
    document.querySelector('#confirmActionButton')?.addEventListener('click', () => runConfirmedAction());
    window.addEventListener('online', () => { if (accountState.loggedIn) syncNow(); });
    const modalObserver = new MutationObserver(syncModalFocus);
    $$('.modal-backdrop').forEach((modal) => modalObserver.observe(modal, { attributes: true, attributeFilter: ['class'] }));
    document.addEventListener('focusin', (event) => {
      const modal = modalFocusState.currentModal;
      if (!modal || modal.classList.contains('hidden')) return;
      if (event.target.closest('.modal-backdrop') !== modal) activateModalFocus(modal);
    });
    $('#dueReviewLink')?.addEventListener('click', () => APP.updateNav('stats'));
    $('#startRhythmGame')?.addEventListener('click', openNoteGame);
    $('#startPlayAlongHome')?.addEventListener('click', openPlayAlong);
    document.querySelectorAll('#onboardingForm .choice-chip').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.classList.contains('active')));
      button.addEventListener('click', () => chooseOnboarding(button));
    });
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
      if (document.querySelector('#themeToggle')) {
        document.querySelector('#themeToggle').setAttribute('aria-label', dark ? '切换浅色模式' : '切换深色模式');
        document.querySelector('#themeToggle').setAttribute('aria-pressed', String(dark));
      }
      document.documentElement.classList.add('theme-transition');
      setTimeout(() => document.documentElement.classList.remove('theme-transition'), 320);
    });
    $('#closeLesson').addEventListener('click', closeSession);
    $('#metronomeToggle')?.addEventListener('click', cycleMetronome);
    document.querySelector('#openPlayAlong')?.addEventListener('click', openPlayAlong);
    document.querySelector('#closePlayAlong')?.addEventListener('click', closePlayAlong);
    document.querySelector('#playAlongStart')?.addEventListener('click', startPlayAlong);
    document.querySelector('#playAlongListen')?.addEventListener('click', listenPlayAlongPattern);
    document.querySelector('#playAlongRetry')?.addEventListener('click', startPlayAlong);
    document.querySelector('#playAlongReturn')?.addEventListener('click', closePlayAlong);
    document.querySelector('#playAlongKeyboard')?.addEventListener('click', (event) => {
      const key = event.target.closest('[data-playalong-pc]');
      if (key) answerPlayAlong(Number(key.dataset.playalongPc), 'pointer');
    });
    document.addEventListener('keydown', handlePlayAlongKeydown);
    bindRhythmPianoEvents();
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
    $('#planForm input[name="practiceTime"]')?.addEventListener('input', updateCalendarHint);
    $('#exportCalendar')?.addEventListener('click', () => {
      const form = $('#planForm');
      const weeklyMinutes = Number(form.weeklyMinutes.value) || 240;
      const daysPerWeek = Number(form.daysPerWeek.value) || 4;
      APP.exportPracticeCalendar({
        ...APP.getPlanProfile(),
        practiceDays: APP.sanitizePracticeDays(draftPracticeDays),
        practiceTime: APP.sanitizePracticeTime(form.practiceTime.value),
        daysPerWeek,
        sessionMinutes: Math.max(10, Math.round(weeklyMinutes / daysPerWeek)),
        weeklyMinutes
      });
    });
    $$('select[name="weeklyMinutes"], select[name="daysPerWeek"]').forEach((select) => {
      select.addEventListener('change', () => {
        updateDerivedMinutes();
        if (select.name === 'daysPerWeek') {
          const count = Number(select.value) || 4;
          const selected = APP.sanitizePracticeDays(draftPracticeDays);
          let next = selected.slice(0, count);
          if (next.length < count) {
            const fill = APP.defaultPracticeDays(count).filter((day) => !next.includes(day));
            next = [...next, ...fill].slice(0, count);
          }
          draftPracticeDays = next;
          renderPracticeDayPicker(draftPracticeDays);
          updateCalendarHint();
        }
      });
    });
    document.querySelector('#practiceDayPicker')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-practice-day]');
      if (!button) return;
      const day = Number(button.dataset.practiceDay);
      const limit = Number($('#planForm select[name="daysPerWeek"]').value) || 4;
      if (draftPracticeDays.includes(day)) draftPracticeDays = draftPracticeDays.filter((item) => item !== day);
      else if (draftPracticeDays.length < limit) draftPracticeDays = [...draftPracticeDays, day];
      else APP.showToast(`这个计划每周练 ${limit} 天，请先取消一天。`);
      renderPracticeDayPicker(draftPracticeDays);
      updateCalendarHint();
    });
    $('#reopenOnboarding')?.addEventListener('click', () => {
      closeSettings();
      setTimeout(() => openOnboarding(true), 180);
    });
    document.querySelector('#clearAllData')?.addEventListener('click', () => {
      confirmAction({
        title: '清除全部本地数据？',
        body: '计划、打卡、最佳成绩与账户同步队列都会从这台设备移除，且无法恢复。',
        confirmLabel: '清除全部数据',
        onConfirm: () => {
          localStorage.clear();
          location.reload();
          return false;
        }
      });
    });
    $('#resetPlan')?.addEventListener('click', () => {
      state.profile = { weeklyMinutes: 240, daysPerWeek: 4, sessionMinutes: 60, level: 'zero', style: 'mixed', goal: '', startWeek: 1, practiceDays: APP.defaultPracticeDays(4), practiceTime: '20:00' };
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
    document.querySelector('#clearHistory')?.addEventListener('click', () => {
      confirmAction({
        title: '清除练习记录？',
        body: '课程完成、掌握成绩、曲目阶段、最佳成绩、复习队列和练习历史会从这台设备清除，计划设置会保留。',
        confirmLabel: '清除练习记录',
        onConfirm: () => {
          state.completed = {};
          state.mastery = {};
          state.repertoire = {};
          state.playAlong = {};
          state.history = [];
          state.reviews = {};
          state.gameSessions = [];
          state.quickPractice = null;
          state.activeSession = null;
          APP.persist();
          APP.renderAll();
          updateProgressDisplay();
          APP.showToast('本地练习记录已清除。');
        }
      });
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
    $('#importData')?.addEventListener('click', () => $('#importDataInput')?.click());
    $('#importDataInput')?.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) {
        APP.showToast('备份文件过大，无法导入。');
        return;
      }
      try {
        const parsed = JSON.parse(await file.text());
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
        if (!parsed.profile || typeof parsed.profile !== 'object' || Array.isArray(parsed.profile)) throw new Error('invalid');
        const normalizeMap = (value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).slice(0, 500)) : {};
        const normalizeList = (value) => Array.isArray(value) ? value.slice(0, 500).filter((item) => item && typeof item === 'object') : [];
        const weeklyMinutes = Math.max(60, Math.min(1200, Number(parsed.profile.weeklyMinutes) || 240));
        const daysPerWeek = Math.max(1, Math.min(7, Number(parsed.profile.daysPerWeek) || 4));
        const sessionMinutes = Math.max(10, Math.min(180, Number(parsed.profile.sessionMinutes) || Math.round(weeklyMinutes / daysPerWeek)));
        const next = {
          profile: {
            weeklyMinutes: 240, daysPerWeek: 4, sessionMinutes: 60, level: 'zero', style: 'mixed', goal: '', startWeek: 1,
            weeklyMinutes,
            daysPerWeek,
            sessionMinutes,
            level: ['zero', 'basic', 'return'].includes(parsed.profile.level) ? parsed.profile.level : 'zero',
            style: ['classical', 'pop', 'mixed'].includes(parsed.profile.style) ? parsed.profile.style : 'mixed',
            goal: String(parsed.profile.goal || '').slice(0, 80),
            startWeek: Math.max(1, Math.min(12, Number(parsed.profile.startWeek) || 1)),
            practiceDays: APP.normalizePracticeDays(parsed.profile.practiceDays, daysPerWeek),
            practiceTime: APP.sanitizePracticeTime(parsed.profile.practiceTime)
          },
          completed: normalizeMap(parsed.completed),
          mastery: normalizeMap(parsed.mastery),
          repertoire: normalizeMap(parsed.repertoire),
          playAlong: normalizeMap(parsed.playAlong),
          reviews: normalizeMap(parsed.reviews),
          history: normalizeList(parsed.history),
          gameSessions: normalizeList(parsed.gameSessions),
          activeSession: null,
          placement: parsed.placement && typeof parsed.placement === 'object' ? parsed.placement : null,
          quickPractice: parsed.quickPractice && typeof parsed.quickPractice === 'object' ? parsed.quickPractice : null,
          serverPlan: null,
          settingsSource: 'local'
        };
        APP.replaceState(next);
        APP.persist();
        APP.renderAll();
        updateProgressDisplay();
        APP.showToast('备份已导入。当前课程进度已恢复。');
      } catch (error) {
        APP.showToast('这个文件不是有效的琴阶备份。');
      }
    });
    $$('.modal-backdrop').forEach((backdrop) => {
      backdrop.addEventListener('click', (event) => {
        if (event.target !== backdrop) return;
        if (backdrop.id === 'confirmActionModal') closeConfirmAction();
        else if (backdrop.id === 'accountModal') closeAccount();
        else if (backdrop.id === 'onboardingModal') closeOnboarding();
        else if (backdrop.id === 'settingsModal') closeSettings();
        else if (backdrop.id === 'warmupModal') closeWarmup();
        else if (backdrop.id === 'noteGameModal') closeNoteGame();
        else if (backdrop.id === 'playAlongModal') closePlayAlong();
        else if (backdrop.id === 'keyboardGuideModal') closeKeyboardGuide();
        else if (backdrop.id === 'rhythmPianoModal') closeRhythmPiano();
        else if (backdrop.id === 'legalViewModal') closeLegalView();
        else if (backdrop.id === 'videoModal') closeVideo();
      });
    });
    document.addEventListener('keydown', (event) => {
      trapModalTab(event);
      if (event.key === 'Escape') {
        if (document.querySelector('#confirmActionModal') && !document.querySelector('#confirmActionModal').classList.contains('hidden')) { closeConfirmAction(); return; }
        if (document.querySelector('#deleteAccountModal') && !document.querySelector('#deleteAccountModal').classList.contains('hidden')) { closeDeleteAccountConfirm(); return; }
        if (document.querySelector('#legalViewModal') && !document.querySelector('#legalViewModal').classList.contains('hidden')) { closeLegalView(); return; }
        if (document.querySelector('#keyboardGuideModal') && !document.querySelector('#keyboardGuideModal').classList.contains('hidden')) { closeKeyboardGuide(); return; }
        if (freePlayActive) { closeFreePiano(); return; }
        if (document.querySelector('#rhythmPianoModal') && !document.querySelector('#rhythmPianoModal').classList.contains('hidden')) { closeRhythmPiano(); return; }
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

  APP.openPlayAlong = openPlayAlong;
  APP.getModalFocusState = () => ({ currentModal: modalFocusState.currentModal?.id || null, lastTrigger: modalFocusState.lastTrigger?.id || null });
  APP.openRhythmPiano = openRhythmPiano;
  APP.finishRhythmPiano = finishRhythmPiano;
  APP.openFreePiano = openFreePiano;
  APP.openKeyboardGuide = openKeyboardGuide;
  APP.closeKeyboardGuide = closeKeyboardGuide;
  APP.enterPianoLandscape = enterPianoLandscape;
  APP.exitPianoLandscape = exitPianoLandscape;
  APP.getPianoLandscapeSnapshot = () => ({
    requested: pianoLandscapeRequested,
    fallback: document.querySelector('#rhythmPianoModal')?.classList.contains('piano-force-landscape') || false,
    orientation: window.matchMedia?.('(orientation: landscape)').matches ? 'landscape' : 'portrait'
  });
  APP.getFreeMetronomeSnapshot = () => ({
    active: freeMetronomeActive,
    bpm: freeTempo,
    beat: freeMetronomeStep % 4,
    beats: Array.from(document.querySelectorAll('#freeBeatDots i')).map((dot) => dot.classList.contains('active'))
  });
  APP.getFreePianoSnapshot = () => ({
    active: freePlayActive,
    octaveOffset: freePlayOctaveOffset,
    range: freePlayRangeLabel(),
    lastNote: document.querySelector('#freePlayLastNote')?.textContent || '',
    keyCount: freePlayKeyCount,
    uniqueNotes: freePlayNotes.size
  });
  APP.getRhythmSnapshot = () => ({
    active: rhythmActive,
    paused: rhythmPaused,
    songId: rhythmSong?.id || null,
    currentBeat: rhythmActive && rhythmSong ? ((performance.now() - rhythmStartedAt) / 60000) * rhythmSong.bpm : null,
    hits: rhythmHits,
    misses: rhythmMisses,
    score: rhythmScore,
    combo: rhythmCombo,
    events: rhythmEvents.map(({ beat, note, hit, missed }) => ({ beat, note, hit, missed }))
  });
  APP.openSession = openSession;
  window.PIANO_OPEN_SESSION = openSession;
  APP.openSettings = openSettings;
  APP.getPracticeSchedule = () => APP.currentWeekData().sessions.map((item) => ({ id: item.id, day: item.day, practiceDay: item.practiceDay, minutes: item.duration }));
  APP.openOnboarding = () => openOnboarding(true);
  APP.openPlacement = openPlacement;
  APP.usePlacement = usePlacement;
  APP.openQuickPractice = openQuickPractice;
  APP.openRepertoirePiece = openRepertoirePiece;
  APP.startRepertoirePractice = startRepertoirePractice;
  APP.getAccountState = () => ({ ...accountState });
  APP.openLegalView = openLegalView;
  APP.closeLegalView = closeLegalView;
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
    const consentField = document.querySelector('#accountConsentField');
    const consentInput = consentField?.querySelector('input[name="consent"]');
    if (consentField) consentField.classList.toggle('hidden', accountState.mode !== 'register');
    if (consentInput) {
      consentInput.required = accountState.mode === 'register';
      consentInput.disabled = accountState.mode !== 'register';
      if (accountState.mode !== 'register') consentInput.checked = false;
    }
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
    if (accountState.mode === 'register' && !form.consent?.checked) {
      if (errorBox) errorBox.textContent = '创建账户前，请先阅读并同意服务条款与隐私政策。';
      return;
    }
    try {
      const path = accountState.mode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const payload = accountState.mode === 'register'
        ? { email, password, name, consentVersion: LEGAL_VERSION, consentAccepted: true }
        : { email, password };
      const data = await accountRequest(path, payload);
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

  function openDeleteAccountConfirm() {
    if (!accountState.loggedIn) return;
    const error = document.querySelector('#deleteAccountError');
    if (error) error.textContent = '';
    document.querySelector('#deleteAccountModal')?.classList.remove('hidden');
  }

  function closeDeleteAccountConfirm() {
    document.querySelector('#deleteAccountModal')?.classList.add('hidden');
  }

  function openLegalView(kind = 'privacy') {
    const content = LEGAL_SUMMARIES[kind] || LEGAL_SUMMARIES.privacy;
    const modal = document.querySelector('#legalViewModal');
    if (!modal) return;
    document.querySelector('#legalViewEyebrow').textContent = content.eyebrow;
    document.querySelector('#legalViewTitle').textContent = content.title;
    document.querySelector('#legalViewBody').innerHTML = content.items.map(([title, body]) => `<section><strong>${escapeUi(title)}</strong><p>${escapeUi(body)}</p></section>`).join('');
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeLegalView() {
    document.querySelector('#legalViewModal')?.classList.add('hidden');
    document.body.style.overflow = document.querySelector('.modal-backdrop:not(.hidden)') ? 'hidden' : '';
  }

  async function deleteAccount() {
    if (!accountState.loggedIn) return;
    const confirmButton = document.querySelector('#confirmDeleteAccount');
    const errorBox = document.querySelector('#deleteAccountError');
    if (confirmButton) {
      confirmButton.disabled = true;
      confirmButton.textContent = '正在删除…';
    }
    if (errorBox) errorBox.textContent = '';
    try {
      await accountRequest('/api/auth/delete', { confirmation: 'DELETE' });
      accountState.loggedIn = false;
      accountState.user = null;
      accountState.syncRevision = 0;
      closeDeleteAccountConfirm();
      closeAccount();
      showAccountView();
      setSyncStatus('本地保存', '');
      APP.showToast('账户与云端进度已删除，本机练习记录仍保留。');
    } catch (error) {
      if (errorBox) errorBox.textContent = error.message || '删除失败，请稍后再试。';
    } finally {
      if (confirmButton) {
        confirmButton.disabled = false;
        confirmButton.textContent = '永久删除';
      }
    }
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
