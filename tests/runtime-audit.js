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
  pianoSynthFallback: 'function playSynthPiano(freq, duration)'
};
for (const [label, fragment] of Object.entries(expected)) {
  if (!app.includes(fragment)) issues.push(`app.js: missing ${label} keyboard mapping`);
}
if (!app.includes('data-key="${key.key}"')) issues.push('app.js: rhythm keys must expose data-key');
if (!app.includes('data-code="${key.code}"')) issues.push('app.js: rhythm keys must expose physical key codes');
if (!app.includes('function blackKeyGeometry(')) issues.push('app.js: black keys must use piano geometry');
if (!fs.existsSync('assets/audio/piano/C4.mp3')) issues.push('assets: piano samples missing');
if (!fs.readFileSync('index.html', 'utf8').includes('id="keyboardGuideModal"')) issues.push('index.html: keyboard guide modal missing');
console.log(JSON.stringify({ checked: runtimeFiles, webMidiReferences: issues.filter((issue) => issue.includes('Web MIDI')).length, nativeDialogReferences: issues.filter((issue) => issue.includes('native dialog')).length, keyboardMapping: 'piano-layers-numpad', issues }, null, 2));
assert.deepEqual(issues, []);