const fs = require('fs');
const vm = require('vm');
const context = { window: {} };
vm.createContext(context);
vm.runInContext(fs.readFileSync('data.js', 'utf8'), context);
const data = context.window.PIANO_DATA;
const issues = [];
const videos = new Map((data.resources?.videos || []).map((item) => [item.id, item]));
let sessions = 0;
let steps = 0;
for (const week of data.weeks || []) {
  for (const session of week.sessions || []) {
    sessions += 1;
    if (!Array.isArray(session.steps) || !session.steps.length) issues.push(`${session.id}: no steps`);
    if (!Array.isArray(session.sources) || !session.sources.length) issues.push(`${session.id}: no sources`);
    const resolvedSources = (session.sources || []).map((source) => videos.get(source)).filter(Boolean);
    for (const source of session.sources || []) {
      if (!videos.has(source)) issues.push(`${session.id}: missing source ${source}`);
    }
    if (!resolvedSources.some((source) => source.region === 'cn' || source.region === 'institution')) {
      issues.push(`${session.id}: no domestic or official primary source`);
    }
    if (resolvedSources.some((source) => source.region === 'global' || source.platform === 'YouTube')) {
      issues.push(`${session.id}: global or YouTube source leaked into main path`);
    }
    const sum = (session.steps || []).reduce((total, step) => total + Number(step.minutes || 0), 0);
    steps += (session.steps || []).length;
    if (sum !== 60) issues.push(`${session.id}: steps sum ${sum}, expected 60`);
    if ((session.steps || []).some((step) => !step.title || !step.detail || !step.cue)) issues.push(`${session.id}: incomplete step copy`);
  }
}
const pieces = data.repertoire || [];
for (const piece of pieces) {
  if (!piece.score && !piece.scoreUrl && !piece.url) issues.push(`${piece.id}: no score link`);
  if ((piece.phases || []).length !== 5) issues.push(`${piece.id}: phases ${(piece.phases || []).length}`);
}
console.log(JSON.stringify({ weeks: (data.weeks || []).length, sessions, steps, totalMinutes: steps * 0 + sessions * 60, videos: videos.size, repertoire: pieces.length, issues }, null, 2));
if (issues.length) process.exit(1);
