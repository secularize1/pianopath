const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const counts = {};
for (const id of ids) counts[id] = (counts[id] || 0) + 1;
const duplicates = Object.entries(counts).filter(([, count]) => count > 1);
console.log('duplicate_ids', JSON.stringify(duplicates));
if (duplicates.length) process.exitCode = 1;
const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
const unnamed = buttons.filter(([, attrs, body]) => !/(aria-label|aria-labelledby)=/.test(attrs) && !body.replace(/<[^>]+>/g, '').trim());
console.log('buttons', buttons.length, 'unnamed', unnamed.length);
if (unnamed.length) process.exitCode = 1;
for (const [, attrs, body] of unnamed) console.log(attrs.trim(), body.trim().slice(0, 80));

for (const page of ['privacy.html', 'terms.html']) {
  const source = fs.readFileSync(page, 'utf8');
  if (!/<h1>[^<]+<\/h1>/.test(source)) {
    console.error(`${page}: missing h1`);
    process.exitCode = 1;
  }
  if (!/href="privacy\.html"/.test(source) || !/href="terms\.html"/.test(source)) {
    console.error(`${page}: legal navigation incomplete`);
    process.exitCode = 1;
  }
}
console.log('legal_pages_checked');
