#!/usr/bin/env node
/**
 * PianoPath end-to-end smoke test.
 * Run: NODE_PATH=<node_modules> node tests/e2e-smoke.js
 * Or:  npm i -D playwright && npx playwright install chromium && node tests/e2e-smoke.js
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const EXPECTED_RHYTHM_KEYS = Object.freeze({
  white: ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/', ';', "'", 'Enter', '.', 'Enter', '+'],
  black: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']
});

const INDEX = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/');
const executablePath = process.env.CHROME_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PLAY_ALONG_KEYS = { '0': 'z', '1': 's', '2': 'x', '3': 'd', '4': 'c', '5': 'v', '6': 'g', '7': 'b', '8': 'h', '9': 'n', '10': 'j', '11': 'm' };

(async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  const results = [];
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, locale: 'zh-CN', colorScheme: 'light', ...(name === 'mobile' ? { hasTouch: true, isMobile: true } : {}) });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(INDEX, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(900);

    assert.equal(errors.length, 0, `${name}: startup errors: ${errors.join('; ')}`);
    assert.equal(await page.evaluate(() => typeof window.PIANO_APP.openPlayAlong), 'function', `${name}: play-along API not exposed`);
    assert.equal(await page.locator('#onboardingModal').isVisible(), true, `${name}: onboarding missing`);
    assert.equal(await page.locator('#onboardingModal').getAttribute('aria-hidden'), 'false', `${name}: open modal should be exposed to assistive tech`);
    const onboardingFocus = await page.evaluate(() => ({
      modal: window.PIANO_APP.getModalFocusState().currentModal,
      inside: Boolean(document.activeElement.closest('#onboardingModal'))
    }));
    assert.equal(onboardingFocus.modal, 'onboardingModal', `${name}: modal focus was not activated`);
    assert.equal(onboardingFocus.inside, true, `${name}: opening modal did not move focus inside`);
    assert.equal(await page.evaluate(() => document.querySelector('#appShell').inert), true, `${name}: background stayed interactive under modal`);
    for (let i = 0; i < 6; i += 1) await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('#onboardingModal'))), true, `${name}: Tab escaped the modal`);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('#onboardingModal'))), true, `${name}: Shift+Tab escaped the modal`);
    assert.equal(await page.locator('#onboardingForm .choice-chip').count(), 9, `${name}: onboarding choices incorrect`);
    assert.equal(await page.locator('[data-group="level"] [data-value="zero"]').getAttribute('aria-pressed'), 'true', `${name}: selected onboarding choice is not exposed`);
    await page.locator('[data-group="level"] [data-value="basic"]').click();
    assert.equal(await page.locator('[data-group="level"] [data-value="basic"]').getAttribute('aria-pressed'), 'true', `${name}: onboarding selection state did not update`);
    assert.equal(await page.locator('[data-group="level"] [data-value="zero"]').getAttribute('aria-pressed'), 'false', `${name}: previous onboarding choice stayed selected`);
    await page.locator('#onboardingSubmit').click();
    await page.waitForTimeout(800);
    assert.equal(await page.locator('#lessonModal').isVisible(), true, `${name}: first lesson did not open`);
    assert.equal(await page.locator('#lessonSteps .lesson-step').count(), 7, `${name}: lesson should have 7 steps`);
    await page.locator('#completeStep').click();
    await page.waitForTimeout(80);
    await page.locator('#closeLesson').click();
    await page.waitForTimeout(180);
    assert.match(await page.locator('#homeLessonIndex').innerText(), /继续 · 上次停在第 2 段/, `${name}: main lesson interruption was not exposed`);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    await page.evaluate(() => window.PIANO_APP.updateNav('today'));
    await page.locator('#startToday').click();
    await page.waitForTimeout(220);
    assert.equal(await page.locator('.lesson-step.active .lesson-step-num').innerText(), '02', `${name}: main lesson did not resume after reload`);
    await page.locator('#openPlayAlong').click();
    await page.waitForTimeout(250);
    assert.equal(await page.locator('#playAlongModal').isVisible(), true, `${name}: play-along modal missing`);
    assert.equal(await page.locator('#playAlongReady').isVisible(), true, `${name}: play-along ready state missing`);
    await page.locator('#playAlongStart').click();
    await page.waitForTimeout(200);
    assert.equal(await page.locator('#playAlongPractice').isVisible(), true, `${name}: play-along practice state missing`);
    assert.equal(await page.locator('#playAlongInputNote').innerText(), '白键 Z X C V B N M；黑键 S D G H J。', `${name}: play-along mapping hint drifted`);
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
    assert.equal(await page.evaluate(() => window.PIANO_APP.getModalFocusState().currentModal), 'lessonModal', `${name}: focus did not return to parent lesson modal`);
    assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('#lessonModal'))), true, `${name}: focus did not return inside parent lesson`);
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
    assert.equal(await page.locator('#completeStreak').innerText(), '1', `${name}: completion did not preview the saved streak`);
    await page.locator('#saveCompletion').click();
    await page.waitForTimeout(900);
    assert.equal(errors.length, 0, `${name}: failed-review runtime errors: ${errors.join('; ')}`);
    assert.equal(await page.locator('#lessonModal').isVisible(), true, `${name}: failed lesson did not reopen for practice`);
    assert.equal(await page.locator('#lessonTitle').innerText(), '找到中央 C', `${name}: failed mastery unlocked next lesson`);
    const completedAfterFail = await page.evaluate(() => JSON.parse(localStorage.getItem('pianopath-state-v1')).completed || {});
    assert.equal(Object.keys(completedAfterFail).length, 0, `${name}: failed mastery was marked complete`);
    assert.equal(await page.locator('#dailyQuestList .daily-quest').first().getAttribute('class'), 'daily-quest done', `${name}: failed mastery attempt did not count as lesson practice`);
    assert.equal(await page.locator('.home-route #routeMain').getAttribute('class'), 'done', `${name}: failed mastery attempt did not complete the main route step`);
    assert.equal(await page.locator('.home-route #routeCheck').getAttribute('class'), 'active', `${name}: failed mastery did not make the check the current step`);
    const queuedReview = await page.evaluate(() => JSON.parse(localStorage.getItem('pianopath-state-v1')).reviews?.['w1d1']);
    assert.ok(queuedReview?.dueAt, `${name}: failed mastery was not scheduled for review`);

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
    assert.equal(await page.locator('#stageGrid .stage-card').count(), 5, `${name}: long-term stages incomplete`);
    assert.equal(await page.locator('#stageGrid .stage-card .stage-start').count(), 5, `${name}: stage practice entry missing`);
    await page.evaluate(() => window.PIANO_APP.updateNav('path'));
    await page.waitForTimeout(180);
    await page.locator('#stageGrid [data-stage-practice="build"]').click();
    await page.waitForTimeout(350);
    assert.equal(await page.locator('#lessonModal').isVisible(), true, `${name}: stage practice did not open`);
    assert.equal(await page.locator('#lessonSteps .lesson-step').count(), 6, `${name}: stage practice steps wrong`);
    assert.match(await page.locator('#lessonPlanLength').innerText(), /阶段训练/, `${name}: stage practice label wrong`);
    for (let i = 0; i < 6; i += 1) {
      await page.locator('#completeStep').click();
      await page.waitForTimeout(35);
    }
    assert.equal(await page.locator('#completeModal').isVisible(), true, `${name}: stage completion summary missing`);
    await page.locator('#saveCompletion').click();
    await page.waitForTimeout(250);
    const stageHistory = await page.evaluate(() => JSON.parse(localStorage.getItem('pianopath-state-v1')).history[0]);
    assert.equal(stageHistory.type, 'stage', `${name}: stage practice was not saved with its own type`);
    assert.equal(stageHistory.stageId, 'build', `${name}: stage practice lost its stage identity`);
    assert.equal(await page.locator('#pathPage').isVisible(), true, `${name}: stage completion did not return to learning path`);
    await page.evaluate(() => window.PIANO_APP.updateNav('today'));
    await page.waitForTimeout(180);
    assert.equal(await page.locator('.home-route span.active').count(), 1, `${name}: active route step missing`);
    assert.equal(await page.locator('.home-route #routeMain').getAttribute('class'), 'done', `${name}: completed lesson not reflected in daily route`);
    assert.equal(await page.locator('.home-route #routeCheck').getAttribute('class'), 'done', `${name}: passed mastery not reflected in daily route`);
    assert.equal(await page.locator('.home-route #routeDone').getAttribute('class'), 'done active', `${name}: daily completion not reflected in route`);
    assert.equal(await page.locator('.game-lab-grid .game-tile').count(), 3, `${name}: game lab incomplete`);
    assert.equal(await page.locator('#startRhythmGame').isVisible(), true, `${name}: note game missing`);
    assert.equal(await page.locator('#startPlayAlongHome').isVisible(), true, `${name}: play-along home entry missing`);
    assert.equal(await page.locator('#startRhythmPianoHome').isVisible(), true, `${name}: rhythm piano entry missing`);
    await page.locator('#startRhythmPianoHome').click();
    await page.waitForTimeout(250);
    assert.equal(await page.locator('#rhythmPianoModal').isVisible(), true, `${name}: rhythm piano modal missing`);
    assert.equal(await page.locator('#rhythmSongGrid .rhythm-song-card').count(), 8, `${name}: rhythm song picker incomplete`);
    await page.locator('[data-rhythm-filter="入门"]').click();
    assert.equal(await page.locator('#rhythmSongGrid .rhythm-song-card').count(), 6, `${name}: beginner song filter incomplete`);
    await page.locator('[data-rhythm-filter="进阶"]').click();
    assert.equal(await page.locator('#rhythmSongGrid .rhythm-song-card').count(), 2, `${name}: advanced song filter incomplete`);
    assert.equal(await page.locator('[data-rhythm-filter="进阶"]').getAttribute('aria-pressed'), 'true', `${name}: active song filter not exposed`);
    await page.locator('[data-rhythm-filter="全部"]').click();
    assert.equal(await page.locator('#rhythmSongGrid .rhythm-song-card').count(), 8, `${name}: all-song filter did not restore songs`);
    const reviewsBeforeFreePlay = await page.evaluate(() => JSON.parse(localStorage.getItem('pianopath-state-v1')).reviews || {});
    const practiceMinutesBeforeFreePlay = await page.evaluate(() => window.PIANO_APP.totalXp());
    const completedBeforeFreePlay = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('pianopath-state-v1')).completed || {}).length);
    assert.equal(await page.locator('#startFreePiano').isVisible(), true, `${name}: free-play entry missing`);
    await page.locator('#startFreePiano').click();
    await page.waitForTimeout(200);
    assert.equal(await page.locator('#keyboardGuideModal').isVisible(), true, `${name}: first free-play tutorial missing`);
    assert.equal(await page.locator('#keyboardGuideRows .keyboard-guide-piano').count(), 1, `${name}: tutorial should use one piano keybed`);
    assert.equal(await page.locator('#keyboardGuideRows .keyboard-guide-whites .keyboard-guide-key').count(), 16, `${name}: tutorial should show 16 white keys`);
    assert.equal(await page.locator('#keyboardGuideRows .keyboard-guide-blacks .keyboard-guide-key').count(), 10, `${name}: tutorial should show 10 black keys`);
    assert.equal(await page.locator('#keyboardGuideRows .keyboard-guide-whites .keyboard-guide-key').first().innerText(), 'Z\nC3', `${name}: keyboard tutorial first key wrong`);
    assert.equal(await page.locator('#keyboardGuideRows .keyboard-guide-whites .keyboard-guide-key').last().innerText(), 'N+\nD5', `${name}: keyboard tutorial last white key wrong`);
    assert.equal(await page.locator('#keyboardGuideRows .keyboard-guide-blacks .keyboard-guide-key').first().innerText(), 'N1\nC#3', `${name}: keyboard tutorial first black key wrong`);
    const keyGeometry = await page.evaluate(() => {
      const rect = (selector) => {
        const bounds = document.querySelector(selector).getBoundingClientRect();
        return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom };
      };
      return {
        c4: rect('.keyboard-guide-key[data-guide-note="60"]'),
        d4: rect('.keyboard-guide-key[data-guide-note="62"]'),
        cs4: rect('.keyboard-guide-key[data-guide-note="61"]'),
        f4: rect('.keyboard-guide-key[data-guide-note="65"]'),
        g4: rect('.keyboard-guide-key[data-guide-note="67"]'),
        fs4: rect('.keyboard-guide-key[data-guide-note="66"]'),
        white: rect('.keyboard-guide-whites .keyboard-guide-key.white'),
        black: rect('.keyboard-guide-blacks .keyboard-guide-key.black')
      };
    });
    assert.ok(keyGeometry.cs4.left > keyGeometry.c4.left && keyGeometry.cs4.right < keyGeometry.d4.right, `${name}: C sharp 4 is not between C4 and D4`);
    assert.ok(keyGeometry.fs4.left > keyGeometry.f4.left && keyGeometry.fs4.right < keyGeometry.g4.right, `${name}: F sharp 4 is not between F4 and G4`);
    assert.ok(keyGeometry.black.top >= keyGeometry.white.top - 1 && keyGeometry.black.bottom < keyGeometry.white.bottom - 8, `${name}: black keys are not layered over the upper portion of white keys`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, `${name}: keyboard tutorial overflow`);
    if (name === 'mobile') {
      assert.equal(await page.evaluate(() => { const bed = document.querySelector('.keyboard-guide-keybed'); return bed.scrollWidth <= bed.clientWidth + 1; }), true, `${name}: keyboard tutorial should fit without internal scrolling`);
    }
    assert.equal(await page.locator('.keyboard-guide-key.target').getAttribute('data-guide-note'), '48', `${name}: first tutorial target missing`);
    await page.keyboard.press('z');
    await page.waitForTimeout(40);
    assert.equal(await page.locator('#keyboardGuideCount').innerText(), '1 / 3', `${name}: tutorial keyboard progress wrong`);
    assert.equal(await page.locator('.keyboard-guide-key.target').getAttribute('data-guide-note'), '49', `${name}: second tutorial target missing`);
    await page.keyboard.press('a');
    await page.waitForTimeout(40);
    assert.equal(await page.locator('#keyboardGuideCount').innerText(), '1 / 3', `${name}: wrong tutorial key advanced progress`);
    assert.match(await page.locator('#keyboardGuideStatus').innerText(), /先找 C#3/, `${name}: wrong tutorial key gave no recovery cue`);
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', code: 'Numpad1', bubbles: true })));
    await page.waitForTimeout(40);
    assert.equal(await page.locator('#keyboardGuideCount').innerText(), '2 / 3', `${name}: tutorial numeric-key preview failed`);
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: '某', code: 'KeyX', bubbles: true })));
    await page.waitForTimeout(40);
    assert.equal(await page.locator('#keyboardGuideStatus').innerText(), '三键都找到了，开始弹吧。', `${name}: tutorial third-key preview failed`);
    assert.equal(await page.locator('#keyboardGuideCount').innerText(), '3 / 3 ✓', `${name}: tutorial completion count wrong`);
    assert.equal(await page.locator('.keyboard-guide-progress').getAttribute('class'), 'keyboard-guide-progress complete', `${name}: tutorial completion state missing`);
    assert.equal((await page.evaluate(() => window.PIANO_APP.getFreePianoSnapshot())).keyCount, 0, `${name}: tutorial previews polluted free-play stats`);
    await page.locator('#keyboardGuideStart').focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(180);
    assert.equal(await page.locator('#keyboardGuideModal').isVisible(), false, `${name}: Enter did not activate the focused tutorial CTA`);
    await page.waitForTimeout(150);
    assert.equal(await page.locator('#rhythmFreePlay').isVisible(), true, `${name}: free-play panel missing`);
    assert.equal(await page.locator('#freePlayLandscape').isVisible(), true, `${name}: free-play landscape control missing`);
    if (name === 'mobile') {
      if (!(await page.evaluate(() => window.PIANO_APP.getPianoLandscapeSnapshot().requested))) {
        await page.evaluate(() => window.PIANO_APP.enterPianoLandscape());
      }
      await page.waitForTimeout(350);
      const landscapeMode = await page.evaluate(() => {
        const modal = document.querySelector('#rhythmPianoModal');
        const card = document.querySelector('#rhythmPianoCard');
        const keyboard = document.querySelector('#freePlayKeyboard');
        return {
          snapshot: window.PIANO_APP.getPianoLandscapeSnapshot(),
          forced: modal.classList.contains('piano-force-landscape'),
          card: { width: card.offsetWidth, height: card.offsetHeight },
          keyboard: { width: keyboard.offsetWidth, height: keyboard.offsetHeight },
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          button: document.querySelector('#freePlayLandscape').innerText
        };
      });
      assert.equal(landscapeMode.snapshot.requested, true, `${name}: landscape request not recorded`);
      assert.equal(landscapeMode.forced, true, `${name}: portrait phone should use rotated landscape fallback`);
      assert.ok(landscapeMode.card.width > landscapeMode.card.height, `${name}: rotated piano card is not horizontal`);
      assert.ok(landscapeMode.keyboard.width > 500, `${name}: landscape piano keys are not wide enough`);
      assert.ok(landscapeMode.keyboard.height >= 90, `${name}: landscape piano keys are too short`);
      assert.equal(landscapeMode.overflow, 0, `${name}: landscape fallback creates horizontal overflow`);
      assert.match(landscapeMode.button, /退出横屏/, `${name}: landscape control state did not update`);
      await page.evaluate(() => window.PIANO_APP.exitPianoLandscape());
      await page.waitForTimeout(220);
      assert.equal(await page.evaluate(() => window.PIANO_APP.getPianoLandscapeSnapshot().requested), false, `${name}: landscape mode did not exit`);
    }
    assert.equal(await page.locator('#freeMetronomeToggle').isVisible(), true, `${name}: free-play metronome missing`);
    assert.equal(await page.locator('#freeTempoValue').innerText(), '80', `${name}: free-play default tempo wrong`);
    await page.locator('#freeTempoUp').click();
    assert.equal(await page.locator('#freeTempoValue').innerText(), '84', `${name}: free-play tempo increment wrong`);
    await page.locator('#freeMetronomeToggle').click();
    await page.waitForTimeout(180);
    const metronome = await page.evaluate(() => window.PIANO_APP.getFreeMetronomeSnapshot());
    assert.equal(metronome.active, true, `${name}: free-play metronome did not start`);
    assert.equal(metronome.bpm, 84, `${name}: free-play metronome tempo drift`);
    assert.ok(metronome.beats.some(Boolean), `${name}: free-play beat indicator did not animate`);
    await page.waitForTimeout(750);
    assert.ok((await page.evaluate(() => window.PIANO_APP.getFreeMetronomeSnapshot().beats.filter(Boolean).length)) <= 1, `${name}: beat indicator should have one active beat`);
    await page.locator('#freeMetronomeToggle').click();
    assert.equal(await page.evaluate(() => window.PIANO_APP.getFreeMetronomeSnapshot().active), false, `${name}: free-play metronome did not stop`);
    await page.waitForTimeout(60);
    assert.equal(await page.locator('#freePlayKeyboard .rhythm-key').count(), 26, `${name}: free-play keyboard should stay touch-sized`);
    assert.equal(await page.locator('#freePlayKeyboard .rhythm-key.white').count(), 16, `${name}: free-play white-key count wrong`);
    assert.deepEqual(await page.evaluate(() => window.PIANO_APP.getFreePianoSnapshot()), {
      active: true,
      octaveOffset: 0,
      range: 'C3–D5',
      lastNote: '按下琴键开始',
      keyCount: 0,
      uniqueNotes: 0
    }, `${name}: free-play initial state wrong`);
    await page.locator('#freePlayKeyboard .rhythm-key[data-note="60"]').click();
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#freePlayNote').innerText(), 'C4', `${name}: free-play touch note feedback wrong`);
    assert.equal(await page.locator('#freePlayKeyCount').innerText(), '1 次触键', `${name}: free-play key counter wrong`);
    assert.equal(await page.locator('#freePlayUniqueCount').innerText(), '1 个音', `${name}: free-play unique-note counter wrong`);
    const audioAfterFirstNote = await page.evaluate(() => window.PIANO_APP.getAudioSnapshot());
    assert.ok(audioAfterFirstNote.sampledPlaybackCount + audioAfterFirstNote.synthPlaybackCount > 0, `${name}: piano produced no audible sound`);
    await page.locator('#freeOctaveUp').click();
    await page.waitForTimeout(80);
    assert.equal(await page.locator('#freePlayOctaveLabel').innerText(), 'C4–D6', `${name}: free-play octave-up range wrong`);
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', code: 'Numpad1', bubbles: true })));
    await page.waitForTimeout(80);
    assert.equal(await page.locator('#freePlayNote').innerText(), 'C#4', `${name}: free-play computer keyboard did not transpose`);
    await page.locator('#freeOctaveUp').click();
    assert.equal(await page.locator('#freePlayOctaveLabel').innerText(), 'C5–D7', `${name}: free-play high range wrong`);
    assert.equal(await page.locator('#freeOctaveUp').isDisabled(), true, `${name}: free-play high octave should stop at range limit`);
    for (let i = 0; i < 2; i += 1) await page.locator('#freeOctaveDown').click();
    assert.equal(await page.locator('#freePlayOctaveLabel').innerText(), 'C3–D5', `${name}: free-play octave-down range wrong`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(180);
    assert.equal(await page.locator('#rhythmFreePlay').isVisible(), false, `${name}: Escape did not close free-play mode`);
    assert.equal(await page.locator('#rhythmPianoHome').isVisible(), true, `${name}: free-play Escape did not return to songs`);
    const freePractice = await page.evaluate(() => JSON.parse(localStorage.getItem('pianopath-state-v1')).history.find((entry) => entry.type === 'freeplay'));
    assert.ok(freePractice, `${name}: free-play session was not saved`);
    assert.equal(freePractice.freePlayKeys, 2, `${name}: free-play saved key count wrong`);
    assert.equal(freePractice.freePlayUniqueNotes, 2, `${name}: free-play saved unique note count wrong`);
    assert.equal(freePractice.week, 0, `${name}: free-play should not attach to a lesson week`);
    assert.equal(freePractice.ratingLabel, '自由弹', `${name}: free-play history label wrong`);
    assert.match(freePractice.notes, /2 次触键.*2 个不同音/, `${name}: free-play history metrics wrong`);
    const completedAfterFreePlay = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('pianopath-state-v1')).completed || {}).length);
    assert.equal(completedAfterFreePlay, completedBeforeFreePlay, `${name}: free-play incorrectly completed a main lesson`);
    const reviewsAfterFreePlay = await page.evaluate(() => JSON.parse(localStorage.getItem('pianopath-state-v1')).reviews || {});
    assert.deepEqual(reviewsAfterFreePlay, reviewsBeforeFreePlay, `${name}: free-play polluted the review queue`);
    assert.ok(freePractice.durationSeconds > 0, `${name}: free-play duration seconds were not saved`);
    assert.ok(freePractice.durationSeconds < 60, `${name}: short free-play should not be stored as a whole minute`);
    await page.locator('[data-rhythm-song="twinkle"]').click();
    await page.waitForTimeout(2200);
    assert.equal(await page.locator('#rhythmPianoStage').isVisible(), true, `${name}: rhythm stage missing`);
    assert.equal(await page.locator('#rhythmKeyHint').innerText(), '白键：字母区 + 小键盘下方 · 黑键：小键盘 N1–N0', `${name}: rhythm keyboard hint drifted`);
    assert.equal(await page.locator('#rhythmKeyboard .rhythm-key').count(), 26, `${name}: rhythm keyboard should have two octaves`);
    assert.equal(await page.locator('#rhythmLanes .rhythm-lane').count(), 16, `${name}: rhythm lanes should align with white keys`);
    assert.equal(await page.locator('#rhythmKeyboard .rhythm-key[data-note="60"]').getAttribute('data-key'), ',', `${name}: C4 keyboard mapping wrong`);
    assert.equal(await page.locator('#rhythmKeyboard .rhythm-key[data-note="60"]').getAttribute('data-code'), 'Comma', `${name}: C4 physical code wrong`);
    assert.equal(await page.locator('#rhythmKeyboard .rhythm-key[data-note="61"]').getAttribute('data-key'), '6', `${name}: C sharp 4 keyboard mapping wrong`);
    assert.equal(await page.locator('#rhythmKeyboard .rhythm-key[data-note="61"]').getAttribute('data-code'), 'Numpad6', `${name}: C sharp 4 physical code wrong`);
    assert.equal(await page.locator('#rhythmKeyboard .rhythm-key[data-note="70"]').getAttribute('data-code'), 'Numpad0', `${name}: A sharp 4 physical code wrong`);
    const rhythmKeyGroups = await page.evaluate(() => ({
      white: [...document.querySelectorAll('#rhythmKeyboard .rhythm-key.white')].sort((a, b) => Number(a.dataset.note) - Number(b.dataset.note)).map((key) => key.dataset.key),
      black: [...document.querySelectorAll('#rhythmKeyboard .rhythm-key.black')].sort((a, b) => Number(a.dataset.note) - Number(b.dataset.note)).map((key) => key.dataset.key)
    }));
    assert.deepEqual(rhythmKeyGroups, EXPECTED_RHYTHM_KEYS, `${name}: computer keyboard mapping drifted`);
    await page.locator('#rhythmPause').click();
    assert.equal(await page.locator('#rhythmPauseLayer').isVisible(), true, `${name}: rhythm pause layer missing`);
    assert.equal(await page.locator('#rhythmPause').innerText(), '继续', `${name}: rhythm pause label wrong`);
    await page.locator('#rhythmPause').click();
    assert.equal(await page.locator('#rhythmPauseLayer').isVisible(), false, `${name}: rhythm pause did not resume`);
    // Hit the first falling note with its mapped keyboard key.
    const firstNote = await page.evaluate(() => window.PIANO_APP.getRhythmSnapshot().events.find((event) => !event.hit && !event.missed));
    assert.ok(firstNote, `${name}: rhythm chart has no playable notes`);
    await page.waitForFunction((beat) => {
      const snapshot = window.PIANO_APP.getRhythmSnapshot();
      return Number.isFinite(snapshot.currentBeat) && Math.abs(snapshot.currentBeat - beat) < 0.12;
    }, firstNote.beat, { timeout: 7000, polling: 25 });
    const firstKey = await page.locator(`#rhythmKeyboard .rhythm-key[data-note="${firstNote.note}"]`).getAttribute('data-key');
    await page.keyboard.press(firstKey);
    await page.waitForTimeout(80);
    const hitSnapshot = await page.evaluate(() => window.PIANO_APP.getRhythmSnapshot());
    assert.ok(hitSnapshot.hits >= 1, `${name}: mapped keyboard key did not register a rhythm hit`);
    assert.ok(hitSnapshot.score > 0, `${name}: successful rhythm hit did not score`);
    assert.ok(hitSnapshot.combo >= 1, `${name}: successful rhythm hit did not build combo`);
    await page.evaluate(() => window.PIANO_APP.finishRhythmPiano());
    await page.waitForTimeout(250);
    assert.equal(await page.locator('#rhythmPianoResult').isVisible(), true, `${name}: rhythm result missing`);
    assert.equal(await page.locator('#rhythmResultTitle').innerText(), '小星星', `${name}: rhythm result title wrong`);
    await page.locator('#rhythmChooseAnother').click();
    await page.waitForTimeout(180);
    assert.ok(Number(await page.locator('[data-rhythm-song="twinkle"]').getAttribute('data-best')) > 0, `${name}: rhythm song best score was not shown`);
    assert.match(await page.locator('#rhythmResultXp').innerText(), /^\+\d+ XP$/, `${name}: rhythm result XP missing`);
    await page.locator('#closeRhythmPiano').click();
    await page.waitForTimeout(150);
    if (name === 'mobile') {
      await page.setViewportSize({ width: 844, height: 390 });
      await page.evaluate(() => window.PIANO_APP.openRhythmPiano());
      await page.locator('[data-rhythm-song="twinkle"]').click();
      await page.waitForTimeout(2200);
      const landscape = await page.evaluate(() => {
        const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
        const card = rect('#rhythmPianoCard');
        const highway = rect('#rhythmHighway');
        const keyboard = rect('#rhythmKeyboard');
        const lane = rect('#rhythmLanes .rhythm-lane');
        const white = rect('#rhythmKeyboard .rhythm-key.white');
        return {
          cardWidth: card.width,
          cardHeight: card.height,
          keyboardBottom: keyboard.bottom,
          highwayHeight: highway.height,
          keyboardHeight: keyboard.height,
          laneLeft: lane.left,
          laneWidth: lane.width,
          whiteLeft: white.left,
          whiteWidth: white.width,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
        };
      });
      assert.equal(landscape.cardWidth, 844, `${name}: landscape stage should use full width`);
      assert.equal(landscape.cardHeight, 390, `${name}: landscape stage should use full height`);
      assert.ok(landscape.keyboardBottom <= 390, `${name}: landscape piano is clipped`);
      assert.ok(landscape.highwayHeight >= 96, `${name}: landscape highway is too short`);
      assert.ok(landscape.keyboardHeight >= 100, `${name}: landscape keys are too short`);
      assert.ok(Math.abs(landscape.laneLeft - landscape.whiteLeft) <= 1, `${name}: rhythm lanes are not aligned with piano keys`);
      assert.ok(Math.abs(landscape.laneWidth - landscape.whiteWidth) <= 1, `${name}: rhythm lane widths do not match keys`);
      assert.equal(landscape.overflow, 0, `${name}: landscape horizontal overflow`);
      await page.screenshot({ path: path.join(ROOT, 'tests', 'smoke-landscape.png'), fullPage: false });
      await page.locator('#closeRhythmPiano').click();
      await page.evaluate(() => window.PIANO_APP.openRhythmPiano());
      await page.locator('#startFreePiano').click();
      await page.waitForTimeout(180);
      const freeLandscape = await page.evaluate(() => {
        const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
        const card = rect('#rhythmPianoCard');
        const keyboard = rect('#freePlayKeyboard');
        const white = rect('#freePlayKeyboard .rhythm-key.white');
        return {
          cardWidth: card.width,
          cardHeight: card.height,
          keyboardBottom: keyboard.bottom,
          keyboardHeight: keyboard.height,
          whiteWidth: white.width,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
        };
      });
      assert.equal(freeLandscape.cardWidth, 844, `${name}: free-play landscape width wrong`);
      assert.equal(freeLandscape.cardHeight, 390, `${name}: free-play landscape height wrong`);
      assert.ok(freeLandscape.keyboardBottom <= 390, `${name}: free-play landscape keyboard clipped`);
      assert.ok(freeLandscape.keyboardHeight >= 90, `${name}: free-play landscape keys too short`);
      assert.ok(freeLandscape.whiteWidth >= 30, `${name}: free-play landscape keys too narrow`);
      assert.equal(freeLandscape.overflow, 0, `${name}: free-play landscape overflow`);
      await page.locator('#freePlayBack').click();
      await page.locator('#closeRhythmPiano').click();
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(180);
      assert.equal(await page.locator('#quickPractice').isVisible(), true, `${name}: quick practice shortcut missing after landscape check`);
    }
      const historyBeforeGoals = await page.evaluate(() => {
      const current = JSON.parse(localStorage.getItem('pianopath-state-v1'));
      return { history: current.history, gameSessions: current.gameSessions };
    });
    await page.evaluate(() => {
      const current = JSON.parse(localStorage.getItem('pianopath-state-v1'));
      const today = new Date();
      const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      current.history = [{ id: 'goal-check', type: 'lesson-practice', title: '目标检查', week: 0, date: key, minutes: 20, rating: 3, ratingLabel: '练习', notes: '', sightDone: 0, completedAt: new Date().toISOString() }, ...current.history];
      current.gameSessions = [{ date: key, mode: 'note', score: 10, completedAt: new Date().toISOString() }, ...(current.gameSessions || [])];
      window.PIANO_APP.replaceState(current);
      window.PIANO_APP.persist();
      window.PIANO_APP.renderAll();
    });
    assert.equal(await page.locator('#dailyQuestCount').innerText(), '3 / 3', `${name}: daily goals did not reach completion`);
    assert.equal(await page.locator('#dailyQuestCelebration').isVisible(), true, `${name}: daily goal completion feedback missing`);
    await page.evaluate((saved) => {
      const current = JSON.parse(localStorage.getItem('pianopath-state-v1'));
      current.history = saved.history;
      current.gameSessions = saved.gameSessions;
      window.PIANO_APP.replaceState(current);
      window.PIANO_APP.persist();
      window.PIANO_APP.renderAll();
    }, historyBeforeGoals);
    assert.equal(await page.locator('#profileButton').getAttribute('aria-label'), '账户与同步', `${name}: account button label is misleading`);
    await page.locator('#profileButton').click();
    await page.waitForTimeout(200);
    assert.equal(await page.locator('#accountModal').isVisible(), true, `${name}: account modal did not open`);
    assert.equal(await page.locator('.local-only-legal a[data-legal-view="privacy"]').count(), 1, `${name}: privacy link missing from account sheet`);
    assert.equal(await page.locator('.local-only-legal a[data-legal-view="terms"]').count(), 1, `${name}: terms link missing from account sheet`);
    await page.locator('.local-only-legal a[data-legal-view="privacy"]').click();
    assert.equal(await page.locator('#legalViewModal').isVisible(), true, `${name}: embedded privacy view did not open`);
    assert.match(await page.locator('#legalViewBody').innerText(), /保存在哪里|明文密码/, `${name}: privacy content missing`);
    await page.locator('#closeLegalView').click();
    assert.equal(await page.locator('#legalViewModal').isVisible(), false, `${name}: privacy view did not close`);
    await page.locator('#accountPlanSettings').click();
    await page.waitForTimeout(250);
    assert.equal(await page.locator('#settingsModal').isVisible(), true, `${name}: plan settings did not open from account`);
    assert.equal(await page.locator('#practiceDayPicker .practice-day-chip').count(), 7, `${name}: weekday picker incomplete`);
    assert.equal(await page.locator('#practiceDayPicker .practice-day-chip.active').count(), 4, `${name}: default practice days wrong`);
    await page.locator('#practiceDayPicker [data-practice-day="6"]').click();
    await page.locator('#practiceDayPicker [data-practice-day="2"]').click();
    assert.match(await page.locator('#practiceDaySummary').innerText(), /周二/, `${name}: practice day did not update`);
    assert.equal(await page.locator('#practiceDayPicker .practice-day-chip.active').count(), 4, `${name}: practice day count exceeded plan`);
    await page.locator('input[name="practiceTime"]').fill('18:30');
    assert.match(await page.locator('#calendarHint').innerText(), /18:30/, `${name}: reminder time did not update`);
    const downloadPromise = page.waitForEvent('download', { timeout: 5000 });
    await page.locator('#exportCalendar').click();
    const calendarDownload = await downloadPromise;
    const calendarPath = path.join(ROOT, 'tests', `calendar-${name}.ics`);
    await calendarDownload.saveAs(calendarPath);
    const calendarText = fs.readFileSync(calendarPath, 'utf8');
    fs.unlinkSync(calendarPath);
    assert.equal((calendarText.match(/BEGIN:VEVENT/g) || []).length, 48, `${name}: calendar event count wrong`);
    assert.match(calendarText, /BEGIN:VCALENDAR/, `${name}: calendar header missing`);
    assert.match(calendarText, /T103000Z/, `${name}: calendar export ignored the current 18:30 time`);
    await page.locator('#planForm').evaluate((form) => form.requestSubmit());
    await page.waitForTimeout(300);
    const schedule = await page.evaluate(() => window.PIANO_APP.getPracticeSchedule());
    assert.equal(schedule.length, 4, `${name}: saved schedule has wrong length`);
    assert.equal(schedule.every((item) => Number.isInteger(item.practiceDay)), true, `${name}: saved schedule lost weekdays`);
    const storedPlan = await page.evaluate(() => JSON.parse(localStorage.getItem('pianopath-state-v1')).profile);
    assert.equal(storedPlan.practiceDays.length, 4, `${name}: practice days were not persisted`);
    assert.equal(new Set(storedPlan.practiceDays).size, 4, `${name}: duplicate practice days persisted`);
    assert.equal(storedPlan.practiceTime, '18:30', `${name}: reminder time was not persisted`);
    assert.ok(await page.locator('#homeLessonIndex').innerText(), `${name}: scheduled home date is missing`);
    await page.locator('#settingsModal').evaluate((modal) => modal.classList.remove('hidden'));
    await page.waitForTimeout(100);
    await page.locator('#clearAllData').click();
    await page.waitForTimeout(120);
    assert.equal(await page.locator('#confirmActionModal').isVisible(), true, `${name}: clear-all confirmation missing`);
    assert.equal(await page.locator('#confirmActionTitle').innerText(), '清除全部本地数据？', `${name}: clear-all confirmation title wrong`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
    assert.equal(await page.locator('#confirmActionModal').isVisible(), false, `${name}: clear-all Escape did not cancel`);
    assert.equal(await page.locator('#settingsModal').isVisible(), true, `${name}: settings closed after canceling clear-all`);
    assert.equal(await page.evaluate(() => Boolean(localStorage.getItem('pianopath-state-v1'))), true, `${name}: canceling clear-all deleted local data`);
    await page.locator('#closeSettings').click();
    await page.waitForTimeout(150);
    await page.locator('#quickPractice').click();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#lessonModal').isVisible(), true, `${name}: quick practice did not open`);
    assert.equal(await page.locator('#lessonSteps .lesson-step').count(), 4, `${name}: quick practice should have 4 steps`);
    await page.locator('#completeStep').click();
    await page.waitForTimeout(80);
    await page.locator('#closeLesson').click();
    await page.waitForTimeout(200);
    assert.match(await page.locator('#homeLessonIndex').innerText(), /继续/, `${name}: interrupted quick practice is not resumable`);
    assert.match(await page.locator('#homeLessonTitle').innerText(), /5 分钟快练/, `${name}: resume card lost quick-practice title`);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(450);
    assert.match(await page.locator('#homeLessonIndex').innerText(), /继续/, `${name}: interrupted quick practice was lost after reload`);
    assert.match(await page.locator('#homeLessonTitle').innerText(), /5 分钟快练/, `${name}: reload lost the practice snapshot`);
    await page.evaluate(() => window.PIANO_APP.updateNav('today'));
    await page.waitForTimeout(100);
    await page.locator('#startToday').click();
    await page.waitForTimeout(250);
    assert.equal(await page.locator('#lessonModal').isVisible(), true, `${name}: quick practice did not resume`);
    assert.equal(await page.locator('.lesson-step.active .lesson-step-num').innerText(), '02', `${name}: quick practice resumed at the wrong step`);
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
    const reviewBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('pianopath-state-v1')).reviews);
    assert.ok(reviewBefore && Object.keys(reviewBefore).length > 0, `${name}: review queue is empty`);
    await page.evaluate(() => window.PIANO_APP.updateNav('today'));
    await page.waitForTimeout(180);
    assert.match(await page.locator('#dueReviewLink').innerText(), /复习/, `${name}: home due-review shortcut missing`);
    await page.locator('#dueReviewLink').click();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#lessonModal').isVisible(), true, `${name}: home due-review shortcut did not open a session`);
    assert.match(await page.locator('#lessonTitle').innerText(), /^复习：/, `${name}: home due-review shortcut opened the wrong lesson`);
    await page.locator('#finishSession').click();
    await page.waitForTimeout(250);
    await page.locator('#saveCompletion').click();
    await page.waitForTimeout(500);
    if (await page.locator('#lessonModal').isVisible().catch(() => false)) {
      await page.locator('#closeLesson').click();
      await page.waitForTimeout(200);
    }
    if (name === 'mobile') await page.locator('.mobile-nav [data-nav="stats"]').click(); else await page.locator('.sidebar .nav-item[data-nav="stats"]').click();
    await page.waitForTimeout(300);
    const reviewAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('pianopath-state-v1')).reviews);
    const reviewedId = Object.keys(reviewAfter).find((id) => reviewAfter[id]?.lastReviewedAt);
    assert.ok(reviewedId, `${name}: successful review did not update schedule`);
    if (reviewBefore[reviewedId]) {
      assert.ok(reviewAfter[reviewedId].dueAt >= reviewBefore[reviewedId].dueAt, `${name}: review due date moved backwards`);
    }
    const dueAfter = await page.evaluate(() => window.PIANO_APP.dueReviewItems().map((item) => item.sourceId));
    assert.equal(dueAfter.includes(reviewedId), false, `${name}: reviewed item stayed due today`);
    const historyAfterReview = await page.evaluate(() => JSON.parse(localStorage.getItem('pianopath-state-v1')).history[0]);
    assert.match(historyAfterReview.title, /^复习：/, `${name}: home review did not create a review history record`);

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
    assert.equal(await page.locator('#importData').isVisible(), true, `${name}: backup import missing`);
    const backupPath = path.join(ROOT, 'tests', `backup-${name}.json`);
    fs.writeFileSync(backupPath, JSON.stringify({ profile: { weeklyMinutes: 180, daysPerWeek: 3, sessionMinutes: 60, level: 'basic', style: 'mixed', goal: '导入回归' }, completed: { 'week-1-session-1': { date: '2026-11-07', completedAt: '2026-11-07T08:00:00.000Z' } }, mastery: { 'week-1-session-1': { score: 2, total: 3, updatedAt: '2026-11-07T08:00:00.000Z' } }, repertoire: { 'ode-to-joy': { phaseIndex: 1, updatedAt: '2026-11-07T08:00:00.000Z' } }, playAlong: { 'c-five': { attempts: 2, bestAccuracy: 88, xp: 10 } }, reviews: { 'week-1-session-1': { sourceId: 'week-1-session-1', dueAt: '2026-11-08T08:00:00.000Z', level: 1 } }, history: [{ id: 'imported-practice', type: 'lesson', title: '导入练习', week: 1, date: '2026-11-07', minutes: 60, rating: 4, ratingLabel: '已记录', notes: '测试记录', sightDone: 1, completedAt: '2026-11-07T08:00:00.000Z' }], gameSessions: [{ id: 'game-1', score: 10 }], quickPractice: { lastStartedAt: '2026-11-07T08:00:00.000Z' }, unexpected: 'ignored' }));
    await page.locator('#importDataInput').setInputFiles(backupPath);
    await page.waitForTimeout(350);
    const importedBackup = await page.evaluate(() => JSON.parse(localStorage.getItem('pianopath-state-v1')));
    assert.equal(importedBackup.profile.weeklyMinutes, 180, `${name}: imported plan not restored`);
    assert.equal(importedBackup.unexpected, undefined, `${name}: unknown backup fields were imported`);
    assert.ok(importedBackup.history.length > 0, `${name}: clear-history test starts without practice data`);
    await page.locator('#clearHistory').click();
    await page.waitForTimeout(120);
    assert.equal(await page.locator('#confirmActionModal').isVisible(), true, `${name}: clear-history confirmation missing`);
    assert.equal(await page.evaluate(() => window.PIANO_APP.getModalFocusState().currentModal), 'confirmActionModal', `${name}: clear-history confirmation did not receive focus`);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#confirmActionModal').isVisible(), false, `${name}: clear-history Escape did not cancel`);
    const preserved = await page.evaluate(() => JSON.parse(localStorage.getItem('pianopath-state-v1')));
    assert.deepEqual(preserved.history, importedBackup.history, `${name}: Escape canceled but practice state changed`);
    await page.waitForFunction(() => document.activeElement?.id === 'clearHistory', null, { timeout: 2000 });
    await page.locator('#clearHistory').click();
    await page.locator('#cancelConfirmAction').click();
    assert.equal(await page.locator('#confirmActionModal').isVisible(), false, `${name}: clear-history cancel button failed`);
    await page.locator('#clearHistory').click();
    await page.locator('#confirmActionButton').click();
    await page.waitForTimeout(200);
    const cleared = await page.evaluate(() => JSON.parse(localStorage.getItem('pianopath-state-v1')));
    assert.deepEqual(cleared.history, [], `${name}: practice history was not cleared`);
    assert.deepEqual(cleared.completed, {}, `${name}: completed lessons were not cleared`);
    assert.deepEqual(cleared.mastery, {}, `${name}: mastery evidence was not cleared`);
    assert.deepEqual(cleared.repertoire, {}, `${name}: repertoire progress was not cleared`);
    assert.deepEqual(cleared.playAlong, {}, `${name}: play-along scores were not cleared`);
    assert.deepEqual(cleared.reviews, {}, `${name}: review queue was not cleared`);
    assert.deepEqual(cleared.gameSessions, [], `${name}: game sessions were not cleared`);
    assert.equal(cleared.quickPractice, null, `${name}: quick practice state was not cleared`);
    assert.equal(cleared.profile.weeklyMinutes, 180, `${name}: clearing records changed the plan`);
    assert.match(await page.locator('#historyList').innerText(), /完成第一次练习/, `${name}: empty history state missing`);
    const emptyState = await page.evaluate(() => JSON.parse(localStorage.getItem('pianopath-state-v1')));
    assert.deepEqual(emptyState.history, [], `${name}: empty history state was not persisted`);
    fs.unlinkSync(backupPath);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.equal(overflow, 0, `${name}: horizontal overflow ${overflow}px`);
    results.push({ viewport: name, errors, xp: importedBackup ? 'recorded' : await page.locator('#xpValue').innerText(), overflow });
    await page.screenshot({ path: path.join(ROOT, 'tests', `smoke-${name}.png`), fullPage: false });
    await context.close();
  }
  await browser.close();
  console.log(JSON.stringify({ ok: true, results }, null, 2));
})().catch(error => {
  console.error(error.stack || String(error));
  process.exit(1);
});
