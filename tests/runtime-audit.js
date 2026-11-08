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
  lowerKeyboardRow: "keys: ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/', ';'",
  upperKeyboardRow: "keys: ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '[', ']'",
  keyboardGuide: 'function keyboardGuideMarkup()',
  keyboardGuidePreview: 'function previewKeyboardGuideKey(note, key)',
  lowerPhysicalCodes: "codes: ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash', 'Semicolon', 'Quote', 'Enter']",
  upperPhysicalCodes: "codes: ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft', 'BracketRight', 'Backslash']"
};
for (const [label, fragment] of Object.entries(expected)) {
  if (!app.includes(fragment)) issues.push(`app.js: missing ${label} keyboard mapping`);
}
if (!app.includes('data-key="${key.key}"')) issues.push('app.js: rhythm keys must expose data-key');
if (!app.includes('data-code="${key.code}"')) issues.push('app.js: rhythm keys must expose physical key codes');
if (!fs.readFileSync('index.html', 'utf8').includes('id="keyboardGuideModal"')) issues.push('index.html: keyboard guide modal missing');
console.log(JSON.stringify({ checked: runtimeFiles, webMidiReferences: issues.filter((issue) => issue.includes('Web MIDI')).length, nativeDialogReferences: issues.filter((issue) => issue.includes('native dialog')).length, keyboardMapping: 'two-row-chromatic', issues }, null, 2));
assert.deepEqual(issues, []);