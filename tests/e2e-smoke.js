#!/usr/bin/env node
/**
 * PianoPath end-to-end smoke test.
 * Run: NODE_PATH=<node_modules> node tests/e2e-smoke.js
 * Or:  npm i -D playwright && npx playwright install chromium && node tests/e2e-smoke.js
 */
const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const INDEX = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/');
const executablePath = process.env.CHROME_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PLAY_ALONG_KEYS = { '0': 'a', '1': 'w', '2': 's', '3': 'e', '4': 'd', '5': 'f', '6': 't', '7': 'g', '8': 'y', '9': 'h', '10': 'u', '11': 'j' };

(async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  const results = [];
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, locale: 'zh-CN', colorScheme: 'light' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(INDEX, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(900);

    assert.equal(errors.length, 0, `${name}: startup errors: ${errors.join('; ')}`);
    assert.equal(await page.evaluate(() => typeof window.PIANO_APP.openPlayAlong), 'function', `${name}: play-along API not exposed`);
    assert.equal(await page.locator('#onboardingModal').isVisible(), true, `${name}: onboarding missing`);
    assert.equal(await page.locator('#onboardingForm .choice-chip').count(), 9, `${name}: onboarding choices incorrect`);
    await page.locator('[data-group="level"] [data-value="basic"]').click();
    await page.locator('#onboardingSubmit').click();
    await page.waitForTimeout(800);
    assert.equal(await page.locator('#lessonModal').isVisible(), true, `${name}: first lesson did not open`);
    assert.equal(await page.locator('#lessonSteps .lesson-step').count(), 7, `${name}: lesson should have 7 steps`);
    await page.locator('#openPlayAlong').click();
    await page.waitForTimeout(250);
    assert.equal(await page.locator('#playAlongModal').isVisible(), true, `${name}: play-along modal missing`);
    assert.equal(await page.locator('#playAlongReady').isVisible(), true, `${name}: play-along ready state missing`);
    await page.locator('#playAlongStart').click();
    await page.waitForTimeout(200);
    assert.equal(await page.locator('#playAlongPractice').isVisible(), true, `${name}: play-along practice state missing`);
    assert.equal(await page.locator('.playalong-key').count(), 12, `${name}: play-along keyboard incomplete`);
    for (let i = 0; i < 3; i += 1) {
      const targetPc = await page.locator('#playAlongTarget').getAttribute('data-pc');
      await page.locator(`.playalong-key[data-playalong-pc="${targetPc}"]`).click();
      await page.waitForTimeout(80);
    }
    const wrongPc = String((Number(await page.locator('#playAlongTarget').getAttribute('data-pc')) + 1) % 12);
    await page.locator(`.playalong-key[data-playalong-pc="${wrongPc}"]`).click();
    await page.waitForTimeout(90);
    assert.match(await page.locator('#playAlongFeedback').innerText(), /目标音是/, `${name}: wrong note got no recovery cue`);
    const keyboardTarget = PLAY_ALONG_KEYS[await page.locator('#playAlongTarget').getAttribute('data-pc')];
    await page.keyboard.press(keyboardTarget);
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#playAlongResult').isVisible(), false, `${name}: play-along result appeared too early`);
    assert.equal(await page.locator('#playAlongProgress').innerText(), '5 / 10', `${name}: play-along keyboard progress did not advance`);
    for (let i = 0; i < 6; i += 1) {
      const targetPc = await page.locator('#playAlongTarget').getAttribute('data-pc');
      await page.locator(`.playalong-key[data-playalong-pc="${targetPc}"]`).click();
      await page.waitForTimeout(70);
    }
    assert.equal(await page.locator('#playAlongResult').isVisible(), true, `${name}: play-along result missing`);
    assert.equal(await page.locator('#playAlongResultAccuracy').innerText(), '91%', `${name}: play-along accuracy scoring wrong`);
    assert.equal(await page.locator('#playAlongXp').innerText(), '+10 XP', `${name}: play-along reward wrong`);
    const playAlongState = await page.evaluate(() => JSON.parse(localStorage.getItem('pianopath-state-v1')).playAlong);
    assert.ok(playAlongState && Object.keys(playAlongState).length > 0, `${name}: play-along progress not saved`);
    await page.locator('#closePlayAlong').click();
    await page.waitForTimeout(180);
    assert.equal(await page.locator('#lessonModal').isVisible(), true, `${name}: play-along did not return to lesson`);

    await page.locator('#openCheckpoint').click();
    await page.waitForTimeout(250);
    assert.equal(await page.locator('#checkpointPanel').isVisible(), true, `${name}: mastery checkpoint missing`);
    for (let i = 0; i < 3; i += 1) {
      const options = await page.locator('.checkpoint-option').all();
      await options[0].click();
      await page.waitForTimeout(100);
      await page.locator('#checkpointNext').click();
      await page.waitForTimeout(150);
    }
    assert.equal(await page.locator('#checkpointDone').isVisible(), true, `${name}: mastery result missing`);
    await page.locator('#checkpointFinish').click();
    await page.waitForTimeout(150);
    await page.evaluate(() => window.PIANO_APP.renderAll());
    const failedMastery = await page.evaluate(() => JSON.parse(localStorage.getItem('pianopath-state-v1')).mastery);
    assert.ok(failedMastery && Object.values(failedMastery).some((item) => item.best < 67), `${name}: failed mastery not persisted`);
    await page.locator('#finishSession').click();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#completeModal').isVisible(), true, `${name}: failed completion modal missing`);
    assert.match(await page.locator('#completeSummary').innerText(), /67%/, `${name}: mastery pass threshold not explained`);
    assert.equal(await page.locator('#completeXp').innerText(), '+0', `${name}: failed mastery awarded lesson XP`);
    await page.locator('#saveCompletion').click();
    await page.waitForTimeout(900);
    assert.equal(await page.locator('#lessonModal').isVisible(), true, `${name}: failed lesson did not reopen for practice`);
    assert.equal(await page.locator('#lessonTitle').innerText(), '找到中央 C', `${name}: failed mastery unlocked next lesson`);
    const completedAfterFail = await page.evaluate(() => JSON.parse(localStorage.getItem('pianopath-state-v1')).completed || {});
    assert.equal(Object.keys(completedAfterFail).length, 0, `${name}: failed mastery was marked complete`);

    // Retry with the correct answers: [0, 1, 1]. Passing at least 2/3 unlocks the next lesson.
    await page.locator('#openCheckpoint').click();
    await page.waitForTimeout(250);
    for (const choice of [0, 1, 1]) {
      await page.locator(`.checkpoint-option[data-checkpoint-option="${choice}"]`).click();
      await page.waitForTimeout(120);
      await page.locator('#checkpointNext').click();
      await page.waitForTimeout(170);
    }
    assert.equal(await page.locator('#checkpointScore').innerText(), '3 / 3', `${name}: correct mastery answers not scored`);
    await page.locator('#checkpointFinish').click();
    await page.waitForTimeout(150);
    await page.locator('#finishSession').click();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#completeModal').isVisible(), true, `${name}: passing completion modal missing`);
    assert.match(await page.locator('#completeSummary').innerText(), /还剩 3 次|最后一次/, `${name}: wrong completion summary`);
    await page.locator('#saveCompletion').click();
    await page.waitForTimeout(1000);
    assert.equal(await page.locator('#lessonModal').isVisible(), true, `${name}: next lesson did not open`);
    assert.equal(await page.locator('#lessonTitle').innerText(), '左手也说话', `${name}: wrong next lesson`);
    const lessonXp = Number((await page.locator('#xpValue').innerText()).replace(/\D/g, ''));
    assert.ok(lessonXp >= 30, `${name}: lesson or play-along XP not awarded`);
    await page.locator('#closeLesson').click();
    await page.waitForTimeout(250);

    assert.equal(await page.locator('#homeWeekTrail .week-trail-item').count(), 4, `${name}: week trail incomplete`);
    assert.equal(await page.locator('#homeWeekTrail .week-trail-item.locked').count(), 2, `${name}: sequential locks incorrect`);
    assert.equal(await page.locator('.home-route span').count(), 3, `${name}: learning route incomplete`);
    assert.equal(await page.locator('.home-route span.active').count(), 1, `${name}: active route step missing`);
    assert.equal(await page.locator('.home-route #routeCheck').innerText(), '2\n掌握检查', `${name}: mastery route step changed`);
    assert.equal(await page.locator('.game-lab-grid .game-tile').count(), 2, `${name}: game lab incomplete`);
    assert.equal(await page.locator('#startRhythmGame').isVisible(), true, `${name}: note game missing`);
    assert.equal(await page.locator('#startPlayAlongHome').isVisible(), true, `${name}: play-along home entry missing`);
    assert.equal(await page.locator('#quickPractice').isVisible(), true, `${name}: quick practice shortcut missing`);
    await page.locator('#quickPractice').click();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#lessonModal').isVisible(), true, `${name}: quick practice did not open`);
    assert.equal(await page.locator('#lessonSteps .lesson-step').count(), 4, `${name}: quick practice should have 4 steps`);
    await page.locator('#finishSession').click();
    await page.waitForTimeout(300);
    await page.locator('#saveCompletion').click();
    await page.waitForTimeout(500);
    assert.equal(await page.locator('#homeWeekTrail .week-trail-item.done').count(), 1, `${name}: quick practice should preserve completed lesson only`);

    // Weakness review: create a low-rated lesson record with a concrete note,
    // then verify that the review card can open a 10-minute targeted session.
    if (await page.locator('#lessonModal').isVisible().catch(() => false)) {
      await page.locator('#closeLesson').click();
      await page.waitForTimeout(200);
    }
    await page.locator('#startToday').click();
    await page.waitForTimeout(250);
    await page.locator('#finishSession').click();
    await page.waitForTimeout(250);
    await page.locator('[data-rating="2"]').click();
    await page.locator('#sessionNotes').fill('右手第 4 小节换和弦不稳');
    await page.locator('#saveCompletion').click();
    await page.waitForTimeout(500);
    if (await page.locator('#lessonModal').isVisible().catch(() => false)) {
      await page.locator('#closeLesson').click();
      await page.waitForTimeout(250);
    }
    if (name === 'mobile') await page.locator('.mobile-nav [data-nav="stats"]').click(); else await page.locator('.sidebar .nav-item[data-nav="stats"]').click();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#reviewCard').isVisible(), true, `${name}: review card missing`);
    assert.ok(await page.locator('.review-item').count() > 0, `${name}: review item missing`);
    await page.locator('.review-item').first().click();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#lessonModal').isVisible(), true, `${name}: review session did not open`);
    assert.equal(await page.locator('#lessonSteps .lesson-step').count(), 4, `${name}: review session should have 4 steps`);
    assert.match(await page.locator('#lessonTitle').innerText(), /^复习：/, `${name}: wrong review title`);
    await page.locator('#closeLesson').click();
    await page.waitForTimeout(200);

    // Placement runs during first-run onboarding, before onboarding is completed.
    // This smoke test has already passed onboarding, so exercise the exposed entry point directly.
    if (await page.locator('#lessonModal').isVisible().catch(() => false)) {
      await page.locator('#closeLesson').click();
      await page.waitForTimeout(200);
    }
    await page.evaluate(() => window.PIANO_APP.openPlacement());
    await page.waitForTimeout(250);
    assert.equal(await page.locator('#placementModal').isVisible(), true, `${name}: placement modal missing`);
    for (let i = 0; i < 5; i += 1) {
      const choices = await page.locator('.placement-option').all();
      await choices[0].click();
      await page.waitForTimeout(850);
    }
    assert.equal(await page.locator('#placementResultPanel').isVisible(), true, `${name}: placement result missing`);
    await page.locator('#usePlacement').click();
    await page.waitForTimeout(300);

    if (name === 'mobile') await page.locator('.mobile-nav [data-nav="today"]').click(); else await page.locator('.sidebar .nav-item[data-nav="today"]').click();
    await page.waitForTimeout(250);
    await page.locator('#startRhythmGame').click();
    await page.waitForTimeout(350);
    assert.equal(await page.locator('#noteGameModal').isVisible(), true, `${name}: game modal missing`);
    const question = await page.locator('#noteGameQuestion').innerText();
    await page.locator(`.note-key[data-note="${question}"]`).click();
    await page.waitForTimeout(180);
    assert.equal(await page.locator('#noteGameScore').innerText(), '10', `${name}: game scoring failed`);
    await page.locator('.note-mode[data-game-mode="ear"]').click();
    await page.waitForTimeout(400);
    assert.equal(await page.locator('#noteGameQuestion').innerText(), '?', `${name}: ear mode question should hide note name`);
    assert.equal(await page.locator('#noteReplay').isVisible(), true, `${name}: ear replay missing`);
    await page.locator('#closeNoteGame').click();

    // Repertoire: cards, modal, phase training, progress advance.
    if (name === 'mobile') await page.locator('.mobile-nav [data-nav="repertoire"]').click(); else await page.locator('.sidebar .nav-item[data-nav="repertoire"]').click();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.repertoire-card').count(), 10, `${name}: repertoire cards missing`);
    assert.ok(await page.locator('#repertoireFilters .filter-chip').count() >= 6, `${name}: repertoire filters missing`);
    await page.locator('[data-repertoire-open="ode-to-joy"]').click();
    await page.waitForTimeout(250);
    assert.equal(await page.locator('#repertoireModal').isVisible(), true, `${name}: repertoire modal missing`);
    assert.equal(await page.locator('.repertoire-phase').count(), 5, `${name}: repertoire phases missing`);
    await page.locator('#startRepertoirePractice').click();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#lessonTitle').innerText(), '曲目训练：欢乐颂', `${name}: repertoire session title wrong`);
    assert.equal(await page.locator('#lessonSteps .lesson-step').count(), 5, `${name}: repertoire session steps wrong`);
    await page.locator('#finishSession').click();
    await page.waitForTimeout(250);
    assert.match(await page.locator('#completeSummary').innerText(), /曲目阶段完成/, `${name}: repertoire completion missing`);
    await page.locator('#saveCompletion').click();
    await page.waitForTimeout(500);
    assert.equal(await page.locator('#repertoirePage').isVisible(), true, `${name}: did not return to repertoire`);
    const repertoireState = await page.evaluate(() => JSON.parse(localStorage.getItem('pianopath-state-v1')).repertoire?.['ode-to-joy']);
    assert.equal(repertoireState?.phaseIndex, 1, `${name}: repertoire phase did not advance`);

    // Skill report: four capability meters and a next-step recommendation.
    if (name === 'mobile') await page.locator('.mobile-nav [data-nav="stats"]').click(); else await page.locator('.sidebar .nav-item[data-nav="stats"]').click();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.skill-meter').count(), 4, `${name}: skill meters missing`);
    assert.ok((await page.locator('#skillFocusText').innerText()).length > 0, `${name}: next skill suggestion missing`);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.equal(overflow, 0, `${name}: horizontal overflow ${overflow}px`);
    results.push({ viewport: name, errors, xp: await page.locator('#xpValue').innerText(), overflow });
    await page.screenshot({ path: path.join(ROOT, 'tests', `smoke-${name}.png`), fullPage: false });
    await context.close();
  }
  await browser.close();
  console.log(JSON.stringify({ ok: true, results }, null, 2));
})().catch(error => {
  console.error(error.stack || String(error));
  process.exit(1);
});
