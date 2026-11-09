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
  whiteKeyboardRow: "keys: ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/', ';'",
  blackKeyboardRow: "keys: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']",
  keyboardGuide: 'function keyboardGuideMarkup()',
  keyboardGuidePreview: 'function previewKeyboardGuideKey(note, key)',
  whitePhysicalCodes: "codes: ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash', 'Semicolon', 'Quote', 'Enter', 'NumpadDecimal', 'NumpadEnter', 'NumpadAdd']",
  blackPhysicalCodes: "codes: ['Numpad1', 'Numpad2', 'Numpad3', 'Numpad4', 'Numpad5', 'Numpad6', 'Numpad7', 'Numpad8', 'Numpad9', 'Numpad0']",
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
console.log(JSON.stringify({ checked: runtimeFiles, webMidiReferences: issues.filter((issue) => issue.includes('Web MIDI')).length, nativeDialogReferences: issues.filter((issue) => issue.includes('native dialog')).length, keyboardMapping: 'piano-layers-numpad', issues }, null, 2));
assert.deepEqual(issues, []);