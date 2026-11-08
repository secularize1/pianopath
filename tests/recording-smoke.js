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

    const taskBefore = await page.locator('#recordingTask').innerText();
    assert.match(taskBefore, /录下当前练习段落|录下.*秒|连续弹/, 'recording task guidance missing');
    assert.equal((await page.evaluate(() => window.PIANO_APP.getRecordingSnapshot())).task, taskBefore, 'recording snapshot task mismatch');
    const taskTypes = await page.evaluate(() => {
      const app = window.PIANO_APP;
      const task = app.recordingTaskFor;
      return { original: app.getRecordingTask(), withType: task('review'), functionSource: String(task) };
    });
    assert.equal(typeof taskTypes.original, 'string', 'recording task should be a string');
    assert.equal(typeof taskTypes.withType, 'string', 'recording task helper should accept a practice type');
    assert.match(taskTypes.withType, /卡住|慢速|练习段落/, 'review recording task missing');
    assert.match(taskTypes.original, /录下|连续/, 'recording task guidance missing');

    const initial = await page.evaluate(() => window.PIANO_APP.getRecordingSnapshot());
    assert.equal(initial.supported, true, 'recording should be supported on local HTTP');
    assert.equal(initial.uploadsRecording, false, 'recording must remain local-only');
    const diagnostics = await page.evaluate(() => {
      const make = (value, n = 24000) => Float32Array.from({ length: n }, () => value);
      return {
        silence: window.PIANO_APP.analyzeRecordingSamples(make(0), 48000, 20),
        quiet: window.PIANO_APP.analyzeRecordingSamples(make(.04), 48000, 20),
        good: window.PIANO_APP.analyzeRecordingSamples(make(.18), 48000, 20),
        clipped: window.PIANO_APP.analyzeRecordingSamples(make(1), 48000, 20)
      };
    });
    assert.equal(diagnostics.silence.level, '太小', 'silence diagnostics failed');
    assert.equal(diagnostics.silence.silent, true, 'silence flag missing');
    assert.equal(diagnostics.quiet.level, '偏轻', 'quiet diagnostics failed');
    assert.equal(diagnostics.quiet.silent, false, 'audible quiet recording was misclassified as silent');
    assert.equal(diagnostics.good.level, '合适', 'healthy diagnostics failed');
    assert.equal(diagnostics.clipped.level, '过响', 'clipping diagnostics failed');
    assert.equal(diagnostics.clipped.clipped, true, 'clipped flag missing');
    assert.ok(diagnostics.good.rmsDb > diagnostics.quiet.rmsDb, 'RMS comparison failed');
    const comparisons = await page.evaluate(() => {
      const base = { level: '偏轻', rmsDb: -28, peakDb: -28, activeRatio: 60, silent: false, clipped: false };
      return {
        recovered: window.PIANO_APP.compareRecordingAnalysis(base, { ...base, level: '合适', rmsDb: -16, peakDb: -1 }),
        regressed: window.PIANO_APP.compareRecordingAnalysis({ ...base, level: '合适', rmsDb: -16, peakDb: -1 }, base),
        stable: window.PIANO_APP.compareRecordingAnalysis(base, { ...base, rmsDb: -29 }),
        clipped: window.PIANO_APP.compareRecordingAnalysis({ ...base, level: '合适', rmsDb: -16, peakDb: -1 }, { ...base, level: '过响', rmsDb: -1, peakDb: 0, clipped: true })
      };
    });
    assert.equal(comparisons.recovered.trend, '更稳', 'recovered-take comparison failed');
    assert.equal(comparisons.regressed.trend, '又偏了', 'regressed-take comparison failed');
    assert.equal(comparisons.stable.trend, '一致', 'stable-take comparison failed');
    assert.equal(comparisons.clipped.trend, '又偏了', 'clipped-take comparison failed');

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
    assert.equal((await page.evaluate(() => window.PIANO_APP.getRecordingSnapshot())).analysis !== null, true, 'recording analysis missing');
    assert.equal(await page.locator('#recordingCheck').isVisible(), true, 'recording analysis card missing');
    assert.match(await page.locator('#recordingCheckLevel').innerText(), /太小|偏轻|合适|过响|断续/, 'recording level not rendered');
    assert.match(await page.locator('#recordingCheckTip').innerText(), /麦克风|片段|小节|琴声|录音|声音|连接/, 'recording analysis tip missing');
    const firstTake = saved;
    await page.locator('#startRecording').click();
    await page.waitForFunction(() => window.PIANO_APP.getRecordingSnapshot().state === 'recording', null, { timeout: 5000 });
    await page.waitForTimeout(900);
    await page.locator('#stopRecording').click();
    await page.waitForFunction((previousId) => {
      const snap = window.PIANO_APP.getRecordingSnapshot();
      return snap.hasRecording && snap.recordingId && snap.recordingId !== previousId;
    }, firstTake.recordingId, { timeout: 8000 });
    const compared = await page.evaluate(() => window.PIANO_APP.getRecordingSnapshot());
    assert.notEqual(compared.recordingId, firstTake.recordingId, 're-recording did not replace the prior take');
    assert.ok(compared.comparison, 'A/B comparison missing after re-recording');
    assert.match(compared.comparison.trend, /更稳|又偏了|差不多|一致|更连贯/, 'A/B trend missing');
    assert.equal(await page.locator('#recordingCompare').isVisible(), true, 'A/B comparison card missing');
    assert.match(await page.locator('#recordingCompareBefore').innerText(), /dB/, 'previous take summary missing');
    assert.match(await page.locator('#recordingCompareAfter').innerText(), /dB/, 'current take summary missing');
    const oldTakeRemoved = await page.evaluate(async (id) => new Promise((resolve, reject) => {
      const request = indexedDB.open('pianopath-recordings-v1');
      request.onsuccess = () => {
        const db = request.result;
        const get = db.transaction('recordings').objectStore('recordings').get(id);
        get.onsuccess = () => resolve(!get.result);
        get.onerror = () => reject(get.error);
      };
      request.onerror = () => reject(request.error);
    }), firstTake.recordingId);
    assert.equal(oldTakeRemoved, true, 'replaced recording blob was not removed');
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
    assert.equal(stored.recording.id, compared.recordingId, 'history recording metadata id mismatch');
    assert.ok(stored.recording.comparison, 'A/B comparison was not persisted to history');
    assert.ok(stored.recording.deviceId, 'recording metadata must record the owning device');
    assert.equal(stored.recording.deviceId, await page.evaluate(() => window.PIANO_APP.getRecordingDeviceId()), 'recording device id mismatch');
    assert.equal(Object.prototype.hasOwnProperty.call(stored.recording, 'blob'), false, 'audio blob must not enter localStorage');
    assert.equal(stored.recording.task, taskBefore, 'recording task context was not persisted');

    await page.locator('.history-recording').evaluate((button) => button.click());
    await page.waitForFunction(() => !document.querySelector('#recordingModal').classList.contains('hidden'), null, { timeout: 5000 });
    assert.equal(await page.locator('#historyRecordingAudio').getAttribute('src') !== null, true, 'history playback source missing');
    assert.equal(await page.locator('#historyRecordingCheck').isVisible(), true, 'history recording analysis missing');
    assert.match(await page.locator('#historyRecordingCheckLevel').innerText(), /太小|偏轻|合适|过响|断续/, 'history recording level missing');
    assert.equal(await page.locator('#historyRecordingTask').innerText(), taskBefore, 'history recording task missing');
    assert.equal(await page.locator('#historyRecordingCompare').isVisible(), true, 'history A/B comparison missing');
    assert.match(await page.locator('#historyRecordingCompareBefore').innerText(), /dB/, 'history previous take missing');
    assert.match(await page.locator('#historyRecordingCompareAfter').innerText(), /dB/, 'history current take missing');
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
    }), compared.recordingId);
    assert.equal(deletedAudio, false, 'recording blob was not removed from IndexedDB');
    await page.evaluate(() => {
      const current = JSON.parse(localStorage.getItem('pianopath-state-v1'));
      current.history = [{ id: 'remote-recording-entry', type: 'quick', title: '另一台设备的练习', week: 1, date: '2026-11-08', minutes: 5, rating: 3, ratingLabel: '已记录', recording: { id: 'remote-recording', durationSeconds: 12, mimeType: 'audio/webm', deviceId: 'another-device-id' }, completedAt: new Date().toISOString() }];
      window.PIANO_APP.replaceState(current);
      window.PIANO_APP.persist();
      window.PIANO_APP.updateNav('stats');
    });
    await page.waitForTimeout(150);
    assert.equal(await page.locator('.history-recording.remote').count(), 1, 'remote recording should be labeled as device-bound');
    assert.match(await page.locator('.history-recording.remote').innerText(), /原设备录音/, 'remote recording label missing');
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

    console.log(JSON.stringify({ ok: true, active, saved, historyRecording: stored.recording, comparison: compared.comparison, diagnostics, comparisons, denied: 'recoverable', standalone: 'graceful' }, null, 2));
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
