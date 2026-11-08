#!/usr/bin/env node
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
  throw new Error('PianoPath recording test server did not start');
}

async function openLesson(page, base) {
  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => Boolean(window.PIANO_APP), null, { timeout: 15000 });
  await page.evaluate(() => window.PIANO_APP.openSession(window.PIANO_APP.currentSessionData().id));
  await page.waitForFunction(() => !document.querySelector('#lessonModal').classList.contains('hidden'), null, { timeout: 5000 });
  await page.locator('#openRecording').click();
}

(async () => {
  let server;
  let browser;
  let dataDir;
  try {
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pianopath-recording-'));
    server = spawn(process.env.PYTHON || 'python', ['server.py'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(port), PIANOPATH_DATA_DIR: dataDir, PIANOPATH_NO_BROWSER: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    await waitForServer(base);
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required']
    });

    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['microphone'], locale: 'zh-CN' });
    await context.addInitScript(() => {
      localStorage.setItem('pianopath-onboarded', '1');
      localStorage.setItem('pianopath-keyboard-guide-seen', '1');
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await openLesson(page, base);

    const initial = await page.evaluate(() => window.PIANO_APP.getRecordingSnapshot());
    assert.equal(initial.supported, true, 'recording should be supported on local HTTP');
    assert.equal(initial.uploadsRecording, false, 'recording must remain local-only');

    await page.locator('#startRecording').click();
    await page.waitForFunction(() => window.PIANO_APP.getRecordingSnapshot().state === 'recording', null, { timeout: 5000 });
    await page.waitForTimeout(1500);
    const active = await page.evaluate(() => window.PIANO_APP.getRecordingSnapshot());
    assert.equal(active.state, 'recording', 'recording state did not become active');
    assert.ok(active.durationSeconds >= 1, 'recording timer did not advance');
    assert.equal(await page.locator('#stopRecording').isEnabled(), true, 'stop button should be enabled while recording');

    await page.locator('#stopRecording').click();
    await page.waitForFunction(() => window.PIANO_APP.getRecordingSnapshot().hasRecording, null, { timeout: 8000 });
    const saved = await page.evaluate(() => window.PIANO_APP.getRecordingSnapshot());
    assert.equal(saved.state, 'idle', 'recorder did not stop');
    assert.ok(saved.recordingId, 'saved recording id missing');
    assert.ok(saved.durationSeconds >= 1, 'saved duration missing');
    assert.match(saved.mimeType, /audio\//, 'recording mime type missing');
    assert.equal(await page.locator('#recordingAudio').isVisible(), true, 'in-lesson playback control missing');
    assert.equal(await page.locator('#downloadRecording').isVisible(), true, 'download action missing');
    assert.ok((await page.locator('#downloadRecording').getAttribute('download')).includes('.webm'), 'download filename missing');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('pianopath-state-v1')).history?.length || 0), 0, 'recording should not create fake history before completion');
    assert.equal(await page.evaluate(async () => (await indexedDB.databases()).some((db) => db.name === 'pianopath-recordings-v1')), true, 'IndexedDB recording store missing');

    await page.locator('#finishSession').click();
    await page.waitForTimeout(250);
    await page.locator('#saveCompletion').click();
    await page.waitForTimeout(1200);
    await page.evaluate(() => { window.PIANO_APP.updateNav('stats'); window.scrollTo(0, 0); });
    await page.waitForTimeout(250);
    await page.locator('#historyRecordingAudio').evaluate((element) => element.scrollIntoView({ block: 'center' }));
    const historyIds = await page.evaluate(() => window.PIANO_APP.getHistoryRecordingIds());
    assert.equal(historyIds.length, 1, 'completed practice did not keep recording metadata');
    assert.equal(await page.locator('.history-recording').count(), 1, 'history playback button missing');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('pianopath-state-v1')).history.find((entry) => entry.recording));
    assert.equal(stored.recording.id, saved.recordingId, 'history recording metadata id mismatch');
    assert.equal(Object.prototype.hasOwnProperty.call(stored.recording, 'blob'), false, 'audio blob must not enter localStorage');

    await page.locator('.history-recording').evaluate((button) => button.click());
    await page.waitForFunction(() => !document.querySelector('#recordingModal').classList.contains('hidden'), null, { timeout: 5000 });
    assert.equal(await page.locator('#historyRecordingAudio').getAttribute('src') !== null, true, 'history playback source missing');
    await page.locator('#historyRecordingDelete').click();
    await page.waitForFunction(() => !document.querySelector('#confirmActionModal').classList.contains('hidden'), null, { timeout: 3000 });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#confirmActionModal').isVisible(), false, 'recording deletion Escape did not cancel');
    assert.equal((await page.evaluate(() => window.PIANO_APP.getHistoryRecordingIds())).length, 1, 'cancel deleted recording metadata');
    await page.locator('#historyRecordingDelete').click();
    await page.locator('#confirmActionButton').click();
    await page.waitForTimeout(350);
    assert.equal((await page.evaluate(() => window.PIANO_APP.getHistoryRecordingIds())).length, 0, 'recording metadata was not removed');
    const deletedAudio = await page.evaluate(async (id) => new Promise((resolve, reject) => {
      const request = indexedDB.open('pianopath-recordings-v1');
      request.onsuccess = () => {
        const db = request.result;
        const get = db.transaction('recordings').objectStore('recordings').get(id);
        get.onsuccess = () => resolve(Boolean(get.result));
        get.onerror = () => reject(get.error);
      };
      request.onerror = () => reject(request.error);
    }), saved.recordingId);
    assert.equal(deletedAudio, false, 'recording blob was not removed from IndexedDB');
    assert.equal(errors.length, 0, `recording runtime errors: ${errors.join('; ')}`);
    await context.close();

    const deniedContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'zh-CN' });
    await deniedContext.addInitScript(() => {
      localStorage.setItem('pianopath-onboarded', '1');
      localStorage.setItem('pianopath-keyboard-guide-seen', '1');
      navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); };
    });
    const deniedPage = await deniedContext.newPage();
    await deniedPage.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await deniedPage.waitForFunction(() => Boolean(window.PIANO_APP), null, { timeout: 15000 });
    await deniedPage.evaluate(() => window.PIANO_APP.openSession(window.PIANO_APP.currentSessionData().id));
    await deniedPage.locator('#openRecording').click();
    await deniedPage.locator('#startRecording').click();
    await deniedPage.waitForTimeout(500);
    assert.equal((await deniedPage.evaluate(() => window.PIANO_APP.getRecordingSnapshot())).error, 'NotAllowedError', 'permission denial state missing');
    assert.match(await deniedPage.locator('#recordingStatus').innerText(), /没有获得麦克风权限/, 'permission recovery message missing');
    assert.equal(await deniedPage.locator('#lessonModal').isVisible(), true, 'permission denial closed the lesson');
    await deniedContext.close();

    const fileContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await fileContext.addInitScript(() => {
      localStorage.setItem('pianopath-onboarded', '1');
      localStorage.setItem('pianopath-keyboard-guide-seen', '1');
    });
    const filePage = await fileContext.newPage();
    const fileErrors = [];
    filePage.on('pageerror', (error) => fileErrors.push(error.message));
    await filePage.goto('file:///' + path.join(ROOT, '琴阶PianoPath.html').replace(/\\/g, '/'), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await filePage.waitForFunction(() => Boolean(window.PIANO_APP), null, { timeout: 20000 });
    await filePage.evaluate(() => window.PIANO_APP.openSession(window.PIANO_APP.currentSessionData().id));
    await filePage.locator('#openRecording').click();
    const fileSnapshot = await filePage.evaluate(() => window.PIANO_APP.getRecordingSnapshot());
    assert.equal(fileSnapshot.supported, false, 'single-file recording should be explicitly unsupported');
    assert.match(await filePage.locator('#recordingStatus').innerText(), /此环境暂不能录音/, 'single-file recording guidance missing');
    assert.equal(await filePage.locator('#startRecording').isDisabled(), true, 'single-file recording should not request mic');
    assert.equal(fileErrors.length, 0, `standalone recording errors: ${fileErrors.join('; ')}`);
    await fileContext.close();

    console.log(JSON.stringify({ ok: true, active, saved, historyRecording: stored.recording, denied: 'recoverable', standalone: 'graceful' }, null, 2));
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
