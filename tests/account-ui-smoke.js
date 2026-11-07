#!/usr/bin/env node
const { chromium } = require('playwright');
const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

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

async function waitForServer(url) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
    } catch (error) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('PianoPath server did not start');
}

(async () => {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pianopath-account-ui-'));
  const python = process.env.PYTHON || 'python';
  const server = spawn(python, ['server.py'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), PIANOPATH_DATA_DIR: dataDir, PIANOPATH_NO_BROWSER: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let browser;
  try {
    const base = `http://127.0.0.1:${port}`;
    await waitForServer(base);
    browser = await chromium.launch({ executablePath, headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem('pianopath-onboarded', '1');
    });
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(() => Boolean(window.PIANO_APP && window.PIANO_APP.getModalFocusState), null, { timeout: 15000 });
    await page.locator('#profileButton').click();
    await page.waitForTimeout(180);
    assert.equal(await page.locator('#accountModal').isVisible(), true, 'account modal missing');
    await page.locator('.account-note a[data-legal-view="privacy"]').click();
    await page.waitForTimeout(120);
    assert.equal(await page.locator('#legalViewModal').isVisible(), true, 'server-mode privacy view missing');
    assert.equal(await page.locator('#legalViewTitle').innerText(), '隐私政策', 'server-mode privacy title wrong');
    await page.locator('#closeLegalView').click();
    assert.equal(await page.locator('#legalViewModal').isVisible(), false, 'server-mode privacy view did not close');
    await page.locator('[data-account-mode="register"]').click();
    const email = `ui-${Date.now()}@example.com`;
    await page.locator('#accountForm input[name="name"]').fill('删除测试');
    await page.locator('#accountForm input[name="email"]').fill(email);
    await page.locator('#accountForm input[name="password"]').fill('PianoPath123!');
    assert.equal(await page.locator('#accountConsentField').isVisible(), true, 'registration consent missing');
    assert.equal(await page.locator('#accountForm input[name="consent"]').isChecked(), false, 'consent should start unchecked');
    await page.locator('#accountSubmit').click();
    assert.match(await page.locator('#accountError').innerText(), /服务条款|隐私政策|同意/, 'consent validation was not explained');
    await page.locator('#accountForm input[name="consent"]').check();
    await page.locator('#accountSubmit').click();
    await page.waitForFunction(() => !document.querySelector('#accountLoggedIn').classList.contains('hidden'), null, { timeout: 10000 });
    assert.equal(await page.locator('#accountLoggedIn').isVisible(), true, 'account registration failed');
    await page.locator('#accountDelete').click();
    await page.waitForTimeout(120);
    assert.equal(await page.locator('#deleteAccountModal').isVisible(), true, 'delete confirmation missing');
    assert.equal(await page.evaluate(() => window.PIANO_APP.getModalFocusState().currentModal), 'deleteAccountModal', 'delete confirmation did not receive focus');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#deleteAccountModal').isVisible(), false, 'Escape did not close delete confirmation');
    assert.equal(await page.locator('#accountModal').isVisible(), true, 'account modal should remain after cancel');
    await page.locator('#accountDelete').click();
    await page.locator('#cancelDeleteAccount').click();
    assert.equal(await page.locator('#deleteAccountModal').isVisible(), false, 'cancel button did not close delete confirmation');
    await page.locator('#accountDelete').click();
    await page.locator('#confirmDeleteAccount').click();
    await page.waitForFunction(() => document.querySelector('#accountModal').classList.contains('hidden'), null, { timeout: 10000 });
    assert.equal(await page.locator('#accountLoggedIn').isVisible(), false, 'deleted account still appears logged in');
    assert.equal(errors.length, 0, errors.join('; '));
    console.log(JSON.stringify({ ok: true, checks: ['legal-modal', 'consent-required', 'register-ui', 'delete-modal-focus', 'escape-cancel', 'confirm-cancel', 'delete-account'] }, null, 2));
  } finally {
    if (browser) await browser.close();
    server.kill();
    await new Promise((resolve) => server.once('exit', resolve));
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        fs.rmSync(dataDir, { recursive: true, force: true });
        break;
      } catch (error) {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
  }
})().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
