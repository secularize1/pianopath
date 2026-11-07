const fs = require('fs');
const assert = require('assert');

const runtimeFiles = ['index.html', 'app.js', 'data.js', 'styles.css', 'server.py'];
const forbidden = [
  /navigator\.requestMIDIAccess/i,
  /navigator\.requestMidiAccess/i,
  /navigator\.midi\b/i,
  /requestMIDIAccess\s*\(/i
];
const issues = [];
for (const file of runtimeFiles) {
  const source = fs.readFileSync(file, 'utf8');
  for (const pattern of forbidden) {
    if (pattern.test(source)) issues.push(`${file}: forbidden Web MIDI runtime reference ${pattern}`);
  }
}
const app = fs.readFileSync('app.js', 'utf8');
const expected = {
  playAlongLowerBlack: "input: 's'",
  rhythmLowerBlackEnd: "key: 'j'",
  rhythmUpperWhiteEnd: "key: 'o'",
  rhythmUpperBlackEnd: "key: '7'"
};
for (const [label, fragment] of Object.entries(expected)) {
  if (!app.includes(fragment)) issues.push(`app.js: missing ${label} keyboard mapping`);
}
if ((app.match(/data-key="\$\{key\.key\}"/g) || []).length < 2) issues.push('app.js: rhythm keys must expose data-key');
console.log(JSON.stringify({ checked: runtimeFiles, webMidiReferences: issues.filter((issue) => issue.includes('Web MIDI')).length, keyboardMapping: 'two-octave', issues }, null, 2));
assert.deepEqual(issues, []);