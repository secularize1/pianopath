const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const assert = require('assert');
const ROOT = path.resolve(__dirname, '..');
const ORIGIN = process.env.PIANOPATH_ORIGIN || 'https://secularize1.github.io/pianopath/';
const LOCAL_SERVER = process.env.PIANOPATH_OFFLINE_REMOTE !== '1';
const executablePath = process.env.CHROME_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const cacheVersion = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').match(/const CACHE = '([^']+)'/)?.[1];
if (!cacheVersion) throw new Error('Service worker cache version missing');
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

async function waitForServer(url) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
    } catch (error) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('PianoPath offline test server did not start');
}

async function waitForOfflineState(page, expectedCache, { coreReady = false, fullReady = false, timeout = 45000 } = {}) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeout) {
    last = await page.evaluate(async ({ expectedCache }) => {
      const registration = await navigator.serviceWorker.getRegistration();
      const keys = await caches.keys();
      let urls = [];
      if (keys.includes(expectedCache)) {
        const cache = await caches.open(expectedCache);
        urls = (await cache.keys()).map((request) => request.url);
      }
      const hasCore = ['/app.js', '/data.js', '/styles.css'].every((suffix) => urls.some((url) => new URL(url).pathname.endsWith(suffix)));
      return {
        active: registration?.active?.state || null,
        installing: registration?.installing?.state || null,
        waiting: registration?.waiting?.state || null,
        count: urls.length,
        hasCore,
        keys
      };
    }, { expectedCache });
    if (coreReady && last.active === 'activated' && last.hasCore) return last;
    if (fullReady && last.active === 'activated' && last.hasCore && last.count >= 174) return last;
    await page.waitForTimeout(500);
  }
  throw new Error(`offline state timeout: ${JSON.stringify(last)}`);
}

(async () => {
  let server = null;
  let browser = null;
  let tempDataDir = null;
  let origin = ORIGIN;
  const stopServer = async () => {
    if (!server) return;
    const child = server;
    server = null;
    if (child.exitCode === null && !child.killed) {
      child.kill();
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 3000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
      });
    }
  };
  try {
    if (LOCAL_SERVER) {
      const port = await freePort();
      origin = `http://127.0.0.1:${port}`;
      tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pianopath-offline-'));
      server = spawn(process.env.PYTHON || 'python', ['server.py'], {
        cwd: ROOT,
        env: { ...process.env, PORT: String(port), PIANOPATH_DATA_DIR: tempDataDir, PIANOPATH_NO_BROWSER: '1' },
        stdio: ['ignore', 'pipe', 'pipe']
      });
      await waitForServer(origin);
    }
    browser = await chromium.launch({ executablePath, headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN', serviceWorkers: 'allow' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const activationStarted = Date.now();
    await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(() => Boolean(window.PIANO_APP), null, { timeout: 15000 });
    const coreState = await waitForOfflineState(page, cacheVersion, { coreReady: true, timeout: 20000 });
    const activationMs = Date.now() - activationStarted;
    assert.ok(activationMs < 20000, `core service worker activation too slow: ${activationMs}ms`);
    const fullState = await waitForOfflineState(page, cacheVersion, { fullReady: true, timeout: 45000 });
    assert.ok(fullState.count >= 174, `offline app shell is incomplete: ${fullState.count} entries`);
    const cachedUrls = fullState.count;
    const activeWorker = { active: coreState.active, controller: true };
    assert.equal(activeWorker.active, 'activated', 'offline service worker did not activate');
    await context.setOffline(true);
    const appOrigin = origin.endsWith('/') ? origin : `${origin}/`;
    for (const sample of ['assets/audio/piano/C4v3.mp3', 'assets/audio/piano/C4v16.mp3', 'assets/audio/piano/C8v11.mp3']) {
      const sampleUrl = new URL(sample, appOrigin).href;
      const response = await page.evaluate(async (url) => {
        try {
          const fetched = await fetch(url);
          return { ok: fetched.ok, status: fetched.status, bytes: (await fetched.arrayBuffer()).byteLength };
        } catch (error) {
          return { ok: false, bytes: 0, error: error.message };
        }
      }, sampleUrl);
      assert.equal(response.ok, true, `offline piano sample unavailable: ${sampleUrl} (${response.error || response.status})`);
      assert.ok(response.bytes > 10000, `offline piano sample is truncated: ${sampleUrl}`);
    }
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1000);
    assert.equal(await page.locator('#todayPage').isVisible(), true, 'offline home unavailable');
    assert.equal(errors.length, 0, `offline errors: ${errors.join('; ')}`);
    console.log(JSON.stringify({ ok: true, cacheVersion, activationMs, offlineHome: true, cachedUrls, mode: LOCAL_SERVER ? 'local' : 'remote' }, null, 2));
  } finally {
    if (browser) await browser.close();
    await stopServer();
    if (tempDataDir) fs.rmSync(tempDataDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});