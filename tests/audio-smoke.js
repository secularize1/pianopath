const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const assert = require('assert');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const executablePath = process.env.CHROME_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

async function waitForServer(base) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch (error) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('PianoPath audio test server did not start');
}

(async () => {
  let server;
  let browser;
  let dataDir;
  try {
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pianopath-audio-'));
    server = spawn(process.env.PYTHON || 'python', ['server.py'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(port), PIANOPATH_DATA_DIR: dataDir, PIANOPATH_NO_BROWSER: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    await waitForServer(base);

    browser = await chromium.launch({ executablePath, headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
    await context.addInitScript(() => {
      localStorage.setItem('pianopath-onboarded', '1');
      localStorage.setItem('pianopath-keyboard-guide-seen', '1');
    });
    const page = await context.newPage();
    await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(() => Boolean(window.PIANO_APP), null, { timeout: 15000 });
    await page.evaluate(() => window.PIANO_APP.openRhythmPiano());
    await page.locator('#startFreePiano').click();
    await page.waitForFunction(() => window.PIANO_APP.getAudioSnapshot().loadedZones >= 10, null, { timeout: 20000 });
    await page.locator('#freePlayKeyboard .rhythm-key[data-note="60"]').click();
    await page.waitForTimeout(200);
    const audio = await page.evaluate(() => window.PIANO_APP.getAudioSnapshot());
    assert.equal(audio.samples, 30, 'piano sample manifest should contain 30 zones');
    assert.equal(audio.totalSamples, 150, 'piano sample manifest should contain five layers per zone');
    assert.ok(audio.loadedZones >= 10, 'the common range should preload across several pitch zones');
    assert.equal(audio.sampleSource, 'Salamander Grand Piano V3', 'unexpected piano sample source');
    assert.equal(audio.sampleRange, 'A0–C8', 'unexpected piano sample range');
    assert.deepEqual(audio.velocityLayers, [3, 7, 11, 13, 16], 'unexpected piano velocity layers');
    assert.equal(audio.room, 'subtle-concert-room', 'unexpected piano room treatment');
    assert.ok(audio.sampledPlaybackCount >= 1, 'sampled piano should play at least once');
    assert.equal(audio.lastPlaybackEngine, 'sample', 'last piano note should use a sample');
    const rangePlayback = [];
    for (const midi of [21, 24, 36, 48, 72, 84, 96, 108]) {
      const before = await page.evaluate(() => window.PIANO_APP.getAudioSnapshot().sampledPlaybackCount);
      const played = await page.evaluate((note) => window.PIANO_APP.previewPianoLayer(note, .62), midi);
      await page.waitForTimeout(40);
      const after = await page.evaluate(() => window.PIANO_APP.getAudioSnapshot());
      rangePlayback.push({ midi, played, count: after.sampledPlaybackCount - before, engine: after.lastPlaybackEngine });
    }
    assert.equal(rangePlayback.every((item) => item.played && item.count === 1 && item.engine === 'sample'), true, 'every sampled piano zone should load and stay on the sampled engine');
    const velocityLayers = [];
    for (const velocity of [.12, .38, .6, .78, .95]) {
      const played = await page.evaluate(({ note, velocity: value }) => window.PIANO_APP.previewPianoLayer(note, value), { note: 60, velocity });
      await page.waitForTimeout(100);
      const take = await page.evaluate(() => window.PIANO_APP.getAudioSnapshot());
      velocityLayers.push({ velocity, played, layer: take.velocityLayer, engine: take.lastPlaybackEngine });
    }
    assert.deepEqual(velocityLayers.map((item) => item.layer), [3, 7, 11, 13, 16], 'soft-to-hard touch should select distinct recorded layers');
    assert.equal(velocityLayers.every((item) => item.played && item.engine === 'sample'), true, 'every velocity layer should load and stay on the sampled engine');
    const cache = await page.evaluate(() => window.PIANO_APP.getPianoCacheSnapshot());
    assert.ok(cache.entries >= 34, 'piano cache should retain preload and played samples');
    assert.ok(cache.bytes <= cache.limitBytes, 'piano decoded cache should stay within its memory cap');
    console.log(JSON.stringify({ ok: true, audio, rangePlayback, velocityLayers, cache }, null, 2));
  } finally {
    if (browser) await browser.close();
    if (server) {
      server.kill();
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 3000);
        server.once('exit', () => { clearTimeout(timer); resolve(); });
      });
    }
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
