const fs = require('fs');
const assert = require('assert');

const runtimeFiles = ['index.html', 'app.js', 'data.js', 'styles.css', 'server.py'];
const midiPatterns = [
  /navigator\.requestMIDIAccess/i,
  /navigator\.requestMidiAccess/i,
  /navigator\.midi\b/i,
  /requestMIDIAccess\s*\(/i
];
const nativeDialogPatterns = [/\bconfirm\s*\(/, /\balert\s*\(/];
const issues = [];
for (const file of runtimeFiles) {
  const source = fs.readFileSync(file, 'utf8');
  for (const pattern of midiPatterns) {
    if (pattern.test(source)) issues.push(`${file}: forbidden Web MIDI runtime reference ${pattern}`);
  }
  for (const pattern of nativeDialogPatterns) {
    if (pattern.test(source)) issues.push(`${file}: forbidden native dialog ${pattern}`);
  }
}
const app = fs.readFileSync('app.js', 'utf8');
const expected = {
  playAlongLowerBlack: "input: 's'",
  whiteKeyboardRow: "keys: ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/', 'N1', 'N2', 'N3', 'N4', 'N5', 'N6']",
  blackKeyboardRow: "keys: ['a', 's', 'f', 'g', 'h', 'k', 'l', ';', \"'\", 'Enter']",
  keyboardGuide: 'function keyboardGuideMarkup()',
  keyboardGuidePreview: 'function previewKeyboardGuideKey(note, key)',
  whitePhysicalCodes: "codes: ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash', 'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4', 'Numpad5', 'Numpad6']",
  blackPhysicalCodes: "codes: ['KeyA', 'KeyS', 'KeyF', 'KeyG', 'KeyH', 'KeyK', 'KeyL', 'Semicolon', 'Quote', 'Enter']",
  pianoSampleEngine: 'PIANO_SAMPLE_SOURCES',
  pianoVelocityLayers: 'const PIANO_VELOCITY_LAYERS = [3, 7, 11, 13, 16]',
  pianoRoom: 'function createPianoRoomImpulse(context)',
  pianoPointerVelocity: 'function pianoVelocityFromPointer(event)',
  pianoCacheCap: 'const PIANO_SAMPLE_CACHE_BYTES = 150 * 1024 * 1024',
  pianoSynthFallback: 'function playSynthPiano(freq, duration, velocity = .68)',
  checkpointMistakeRetry: 'function retryCheckpointMistakes()',
  checkpointMistakePersistence: 'lastMissedSkills:',
  checkpointSnapshotBridge: 'APP.getCheckpointSnapshot',
  homeMistakeCoach: 'function recentMistakeCoach()',
  homeMistakeCoachBridge: 'APP.getMistakeCoach = () => APP.recentMistakeCoach()',
  checkpointCategoryQuestions: 'function checkpointSignatureQuestion(step)',
  checkpointCategoryContext: 'checkpointStep.category',
  reviewFocus: 'reviewFocus: focus',
  reviewMistakeDetails: 'mistakes: masteryMistakes.slice(0, 3)'
};
for (const [label, fragment] of Object.entries(expected)) {
  if (!app.includes(fragment)) issues.push(`app.js: missing ${label} keyboard mapping`);
}
if (!app.includes('data-key="${key.key}"')) issues.push('app.js: rhythm keys must expose data-key');
if (!app.includes('data-code="${key.code}"')) issues.push('app.js: rhythm keys must expose physical key codes');
if (!app.includes('function blackKeyGeometry(')) issues.push('app.js: black keys must use piano geometry');
for (const layer of [3, 7, 11, 13, 16]) {
  for (const zone of ['A0', 'C4', 'C8']) {
    if (!fs.existsSync(`assets/audio/piano/${zone}v${layer}.mp3`)) issues.push(`assets: Salamander piano layer ${layer} ${zone} missing`);
  }
}
if (!fs.readFileSync('index.html', 'utf8').includes('id="keyboardGuideModal"')) issues.push('index.html: keyboard guide modal missing');
if (!fs.readFileSync('index.html', 'utf8').includes('id="keyboardGuideComputerMap"')) issues.push('index.html: computer-key diagram missing');
if (!app.includes('function keyboardGuideComputerMapMarkup()')) issues.push('app.js: computer-key diagram markup missing');
if (!app.includes('data-computer-code="${code}"')) issues.push('app.js: computer-key diagram physical codes missing');
if (!app.includes('navigator.mediaDevices.getUserMedia')) issues.push('app.js: microphone permission flow missing');
if (!app.includes('new Blob(recordingState.chunks')) issues.push('app.js: local audio blob creation missing');
if (!app.includes('putRecordingRecord')) issues.push('app.js: local recording persistence missing');
if (!app.includes('uploadsRecording: false')) issues.push('app.js: recording upload boundary missing');
if (app.includes('recordingState.metadata =') && !app.includes('recording: recordingState.metadata ?')) issues.push('app.js: recording metadata not attached to completion');
if (!app.includes('function analyzeRecordingBuffer(')) issues.push('app.js: local recording analysis missing');
if (!app.includes('renderRecordingAnalysis(')) issues.push('app.js: recording analysis UI missing');
if (!app.includes('analysis: recordingState.analysis || null')) issues.push('app.js: recording analysis snapshot missing');
if (!app.includes('function compareRecordingAnalysis(')) issues.push('app.js: recording A/B comparison missing');
if (!app.includes('renderRecordingCompare(')) issues.push('app.js: recording comparison UI missing');
if (!app.includes('comparison: recordingState.comparison || null')) issues.push('app.js: recording comparison snapshot missing');
if (!app.includes('function recordingTaskFor(')) issues.push('app.js: practice-specific recording task missing');
if (!app.includes('task: recordingState.metadata?.task || syncRecordingTask()')) issues.push('app.js: recording task snapshot missing');
if (!app.includes('function weeklyRecapData(')) issues.push('app.js: weekly recap calculation missing');
if (!app.includes('function renderWeeklyRecap(')) issues.push('app.js: weekly recap rendering missing');
if (!app.includes('APP.getWeeklyRecap = () => APP.weeklyRecapData()')) issues.push('app.js: weekly recap test bridge missing');

const packageMeta = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const dataSource = fs.readFileSync('data.js', 'utf8');
const indexSource = fs.readFileSync('index.html', 'utf8');
const serviceWorker = fs.readFileSync('sw.js', 'utf8');
const serverSource = fs.readFileSync('server.py', 'utf8');
const appVersion = dataSource.match(/"appVersion":\s*"([^"]+)"/)?.[1];
const cacheVersion = serviceWorker.match(/const CACHE = 'pianopath-v([^']+)'/)?.[1];
const displayVersion = indexSource.match(/琴阶\s*([0-9.]+)/)?.[1];
const serverVersion = serverSource.match(/server_version = "PianoPath\/([0-9.]+)"/)?.[1];
const installBlock = serviceWorker.substring(serviceWorker.indexOf("self.addEventListener('install'"), serviceWorker.indexOf("self.addEventListener('activate'"));
if (appVersion !== packageMeta.version) issues.push(`release version mismatch: data ${appVersion} vs package ${packageMeta.version}`);
if (cacheVersion !== packageMeta.version) issues.push(`release version mismatch: cache ${cacheVersion} vs package ${packageMeta.version}`);
if (displayVersion !== packageMeta.version) issues.push(`release version mismatch: index ${displayVersion} vs package ${packageMeta.version}`);
if (serverVersion !== packageMeta.version) issues.push(`release version mismatch: server ${serverVersion} vs package ${packageMeta.version}`);
if (serviceWorker.includes('cache.addAll(APP_SHELL)')) issues.push('sw.js: monolithic app-shell precache can stall installation');
if (!serviceWorker.includes('CORE_SHELL') || !serviceWorker.includes('PIANO_SHELL')) issues.push('sw.js: core and piano precache must be separated');
if (!serviceWorker.includes('cacheWithRetry(')) issues.push('sw.js: precache retry missing');
if (!installBlock.includes('precacheInBatches(cache, CORE_SHELL')) issues.push('sw.js: mandatory core shell precache missing');
const styleSource = fs.readFileSync('styles.css', 'utf8');
if (!styleSource.includes('/* === 1.43 readable secondary contrast === */')) issues.push('styles.css: mobile secondary contrast pass missing');
for (const selector of ['.week-day-btn span', '.repertoire-head p', '.stat-card em', '.resource-footer span']) {
  if (!styleSource.includes(selector)) issues.push(`styles.css: contrast selector missing ${selector}`);
}

console.log(JSON.stringify({ checked: runtimeFiles, releaseVersion: packageMeta.version, webMidiReferences: issues.filter((issue) => issue.includes('Web MIDI')).length, nativeDialogReferences: issues.filter((issue) => issue.includes('native dialog')).length, keyboardMapping: 'piano-layers-numpad', offlinePrecache: 'batched-retry', issues }, null, 2));
assert.deepEqual(issues, []);