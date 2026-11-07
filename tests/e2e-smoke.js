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
  lowerWhite: ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
  lowerBlack: ['s', 'd', 'g', 'h', 'j'],
  upperWhite: ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o'],
  upperBlack: ['2', '3', '5', '6', '7']
});

const INDEX = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/');
const executablePath = process.env.CHROME_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PLAY_ALONG_KEYS = { '0': 'z', '1': 's', '2': 'x', '3': 'd', '4': 'c', '5': 'v', '6': 'g', '7': 'b', '8': 'h', '9': 'n', '10': 'j', '11': 'm' };

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
    assert.equal(await page.locator('#rhythmSongGrid .rhythm-song-card').count(), 4, `${name}: rhythm song picker incomplete`);
    const reviewsBeforeFreePlay = await page.evaluate(() => JSON.parse(localStorage.getItem('pianopath-state-v1')).reviews || {});
    const practiceMinutesBeforeFreePlay = await page.evaluate(() => window.PIANO_APP.totalXp());
    const completedBeforeFreePlay = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('pianopath-state-v1')).completed || {}).length);
    assert.equal(await page.locator('#startFreePiano').isVisible(), true, `${name}: free-play entry missing`);
    await page.locator('#startFreePiano').click();
    await page.waitForTimeout(200);
    assert.equal(await page.locator('#rhythmFreePlay').isVisible(), true, `${name}: free-play panel missing`);
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
    await page.locator('#freeOctaveUp').click();
    await page.waitForTimeout(80);
    assert.equal(await page.locator('#freePlayOctaveLabel').innerText(), 'C4–D6', `${name}: free-play octave-up range wrong`);
    await page.keyboard.press('q');
    await page.waitForTimeout(80);
    assert.equal(await page.locator('#freePlayNote').innerText(), 'C5', `${name}: free-play computer keyboard did not transpose`);
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
    assert.equal(await page.locator('#rhythmKeyHint').innerText(), '电脑：Z–M / S D G H J + Q–O / 2 3 5 6 7', `${name}: rhythm keyboard hint drifted`);
    assert.equal(await page.locator('#rhythmKeyboard .rhythm-key').count(), 26, `${name}: rhythm keyboard should have two octaves`);
    assert.equal(await page.locator('#rhythmLanes .rhythm-lane').count(), 16, `${name}: rhythm lanes should align with white keys`);
    assert.equal(await page.locator('#rhythmKeyboard .rhythm-key[data-note="60"]').getAttribute('data-key'), 'q', `${name}: upper C keyboard mapping wrong`);
    assert.equal(await page.locator('#rhythmKeyboard .rhythm-key[data-note="49"]').getAttribute('data-key'), 's', `${name}: lower C sharp keyboard mapping wrong`);
    assert.equal(await page.locator('#rhythmKeyboard .rhythm-key[data-note="49"]').getAttribute('data-key'), 's', `${name}: lower sharp keyboard mapping wrong`);
    const rhythmKeyGroups = await page.evaluate(() => ({
      lowerWhite: [...document.querySelectorAll('#rhythmKeyboard .rhythm-key.white[data-note="48"], #rhythmKeyboard .rhythm-key.white[data-note="50"], #rhythmKeyboard .rhythm-key.white[data-note="52"], #rhythmKeyboard .rhythm-key.white[data-note="53"], #rhythmKeyboard .rhythm-key.white[data-note="55"], #rhythmKeyboard .rhythm-key.white[data-note="57"], #rhythmKeyboard .rhythm-key.white[data-note="59"]')].map((key) => key.dataset.key),
      lowerBlack: [...document.querySelectorAll('#rhythmKeyboard .rhythm-key.black[data-note="49"], #rhythmKeyboard .rhythm-key.black[data-note="51"], #rhythmKeyboard .rhythm-key.black[data-note="54"], #rhythmKeyboard .rhythm-key.black[data-note="56"], #rhythmKeyboard .rhythm-key.black[data-note="58"]')].map((key) => key.dataset.key),
      upperWhite: [...document.querySelectorAll('#rhythmKeyboard .rhythm-key.white[data-note="60"], #rhythmKeyboard .rhythm-key.white[data-note="62"], #rhythmKeyboard .rhythm-key.white[data-note="64"], #rhythmKeyboard .rhythm-key.white[data-note="65"], #rhythmKeyboard .rhythm-key.white[data-note="67"], #rhythmKeyboard .rhythm-key.white[data-note="69"], #rhythmKeyboard .rhythm-key.white[data-note="71"], #rhythmKeyboard .rhythm-key.white[data-note="72"], #rhythmKeyboard .rhythm-key.white[data-note="74"]')].map((key) => key.dataset.key),
      upperBlack: [...document.querySelectorAll('#rhythmKeyboard .rhythm-key.black[data-note="61"], #rhythmKeyboard .rhythm-key.black[data-note="63"], #rhythmKeyboard .rhythm-key.black[data-note="66"], #rhythmKeyboard .rhythm-key.black[data-note="68"], #rhythmKeyboard .rhythm-key.black[data-note="70"]')].map((key) => key.dataset.key)
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
    await page.locator('#accountPlanSettings').click();
    await page.waitForTimeout(250);
    assert.equal(await page.locator('#settingsModal').isVisible(), true, `${name}: plan settings did not open from account`);
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
    await page.locator('.review-item').first().click();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#lessonModal').isVisible(), true, `${name}: review session did not open`);
    assert.equal(await page.locator('#lessonSteps .lesson-step').count(), 4, `${name}: review session should have 4 steps`);
    assert.match(await page.locator('#lessonTitle').innerText(), /^复习：/, `${name}: wrong review title`);
    await page.locator('#finishSession').click();
    await page.waitForTimeout(250);
    await page.locator('#saveCompletion').click();
    await page.waitForTimeout(500);
    const reviewAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('pianopath-state-v1')).reviews);
    const reviewedId = Object.keys(reviewAfter).find((id) => reviewAfter[id]?.lastReviewedAt);
    assert.ok(reviewedId, `${name}: successful review did not update schedule`);
    if (reviewBefore[reviewedId]) {
      assert.ok(reviewAfter[reviewedId].dueAt >= reviewBefore[reviewedId].dueAt, `${name}: review due date moved backwards`);
    }

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
