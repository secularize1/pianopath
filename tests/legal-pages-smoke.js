#!/usr/bin/env node
const { chromium } = require('playwright');
const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const executablePath = process.env.CHROME_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PAGES = [
  { file: 'privacy.html', title: '隐私政策', terms: ['本机', '账户', '删除', '未成年人', '麦克风', 'IndexedDB'] },
  { file: 'terms.html', title: '服务条款', terms: ['账户', '版权', '练习安全', '责任边界', '录音'] }
];

(async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  const results = [];
  try {
    for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
      const context = await browser.newContext({ viewport: { width, height }, locale: 'zh-CN', ...(name === 'mobile' ? { isMobile: true, hasTouch: true } : {}) });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      for (const spec of PAGES) {
        const url = 'file:///' + path.join(ROOT, spec.file).replace(/\\/g, '/');
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(120);
        assert.equal(await page.locator('h1').innerText(), spec.title, `${name}/${spec.file}: title mismatch`);
        assert.equal(await page.locator('.legal-document section').count(), 10, `${name}/${spec.file}: section count mismatch`);
        const body = await page.locator('.legal-document').innerText();
        for (const term of spec.terms) assert.match(body, new RegExp(term), `${name}/${spec.file}: missing ${term}`);
        assert.equal(await page.locator('.legal-footer a').count(), 3, `${name}/${spec.file}: footer links incomplete`);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.equal(overflow, 0, `${name}/${spec.file}: horizontal overflow ${overflow}px`);
        results.push({ viewport: name, page: spec.file, sections: 10, overflow });
      }
      assert.equal(errors.length, 0, `${name}: runtime errors: ${errors.join('; ')}`);
      await context.close();
    }
    console.log(JSON.stringify({ ok: true, results }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
