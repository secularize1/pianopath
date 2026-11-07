# Changelog

## 1.17.0 — 2026-11-07

- Added a free-play virtual piano alongside the rhythm-song mode.
- Kept the touch-friendly two-octave keybed while adding five octave positions covering `C1–D7`.
- Added live note feedback, octave navigation, keyboard input and responsive landscape layouts.

## 1.16.0 — 2026-11-07

- Replaced native browser confirms for clearing all local data and practice records with an accessible in-app confirmation sheet.
- Clearing practice records now resets completion, mastery, reviews and in-progress practice while preserving the learner's plan.
- Added regression coverage for focus, Escape/cancel safety, persisted clearing and desktop/mobile parity.

## 1.15.0 — 2026-11-07

- Added a domestic/official-source integrity gate for all 48 main-path lessons; global and YouTube sources are rejected there.
- Audited the runtime to prevent Web MIDI from returning and aligned the full two-octave computer mapping with its on-key labels and help copy.
- Reworked the offline smoke test to use a disposable system temp directory and reliably stop its local server.

## 1.14.0 — 2026-11-07

- Added in-app account deletion with an explicit destructive confirmation dialog.
- Deleting an account now revokes sessions and cascades removal of server-side progress, while keeping this device's local practice history.
- Added backend and browser regression coverage for deletion confirmation, cancellation, session revocation, re-login rejection and UI state cleanup.
- Updated the account sheet with a clear account/sync label and direct access to plan settings on mobile.

## 1.13.0 - 2026-11-07

- Added an accessible modal system with focus entry, focus trapping, Escape-to-close and focus restoration.
- Marked the application shell inert while dialogs are open so background content cannot be interacted with.
- Added visible keyboard focus styles and larger touch targets for coarse-pointer devices.
- Exposed onboarding selection state with aria-pressed and added focus/selection regression coverage.
- Improved dialog labels for completion and settings views.
- Added an automated offline smoke test that verifies the complete Service Worker app shell and restores the home screen after disconnecting the network.
- Added a static DOM audit for duplicate IDs and unnamed buttons; added accessible names to both search fields and a pressed state to the theme toggle.
- The home learning route now reflects today's real lesson and mastery progress instead of resetting when the next lesson opens.
- Added a content integrity audit for all 48 lessons, 336 steps, source references, total timing, repertoire phases and score links.
- Failed mastery attempts now count as a completed lesson practice in the daily goal, while mastery and lesson completion remain locked.
- Added a visible celebration state when all three daily goals are completed.
- Completion now previews the streak after the current practice is saved, so first-day users no longer see a stale zero.
- Clarified the mobile account entry and added direct access to plan settings from the account sheet.

## 1.12.0 — 2026-11-07

- Added a two-octave virtual rhythm piano with four public-domain melodies and per-song note charts.
- Added a landscape-first touch stage for phones and tablets with 16 aligned lanes, a judgement line and responsive on-screen keys.
- Added non-conflicting two-row computer keyboard controls: `Z X C V B N M` / `S D G H J` for the lower octave and `Q W E R T Y U I O` / `2 3 5 6 7` for the upper octave.
- Added pause, countdown, pre-roll, hit judgement, combo, accuracy, XP, results and practice history.
- The current UI and runtime contain no external-device or Web MIDI integration; only the history entry records its earlier removal.
- Expanded regression coverage for mapped keyboard hits, pause/resume, results, phone landscape clipping and lane/key alignment.

## 1.11.0 — 2026-11-06

- Added a persisted adaptive review queue with due dates and 1/3/7/14/30 day progression.
- Failed mastery checks, low-rated sessions and sessions with concrete notes now create review items automatically.
- Successful reviews advance the next due date; failed reviews return to the queue immediately.
- Added a due-review reminder on the home screen and a review-stage view in progress.
- Included review scheduling in safe backup import/export.
- Added desktop/mobile E2E coverage for review creation and post-review rescheduling.

## 1.10.0 — 2026-11-06

- Added interactive play-along drills with target-note highlighting, instant pitch feedback, streak tracking and three-star scoring.
- Added pointer and computer-keyboard input for hands-on practice.
- Added play-along demonstrations, home entry, XP, skill-profile contribution and practice history.
- Expanded automated desktop/mobile regression coverage for wrong-note recovery, keyboard input and persistent results.
- Completed the 1.9 learning-path, mastery gate and native-font improvements.

## 1.9.0 — 2026-11-06

- Added a four-skill learning report for sight-reading, technique, repertoire and ear training.
- Normal lessons now require at least 2/3 on the mastery check before they are marked complete or unlock the next lesson.
- Failed mastery attempts are saved as practice history without awarding lesson XP.
- Rebuilt the home screen around one main lesson, a three-step route and two lightweight music games.
- Improved the native Windows/macOS Chinese font stack and raised the smallest UI text for readability.
- Removed internal source-rule and verification-date copy from the learner interface.

## 1.8.0 — 2026-11-06

- Added in-lesson mastery checkpoints with three questions per session.
- Added mastery scoring, best-score persistence and completion-card display.
- Added mastery checks to the automated desktop/mobile regression suite.


## 1.7.0 — 2026-11-06

- Added a 10-piece graded repertoire library with public/official score links.
- Added five-stage repertoire practice sessions and saved phase progress.
- Added keyboard-level filters, search and completed repertoire view.
- Added repertoire XP and independent repertoire practice history.


## 1.6.0 — 2026-11-06

- Added smart review cards from low ratings and practice notes.
- Added 10-minute targeted review sessions that do not overwrite lesson completion.
- Added home entry for reviewing weak spots.
- Fixed review session source lookup and preserved source lesson IDs.

## 1.5.0 — 2026-11-06

- Added a five-question placement assessment with week 1/3/5/7/9 starting points.
- Added 5-minute quick practice sessions with separate history and +5 XP.
- Added static-host local-only account state with no unusable login form.
- Added automated coverage for placement and quick practice.
- Hardened sync conflict retries and preserved pre-login guest progress.


## 1.4.0 — 2026-11-06

- Added optional accounts with PBKDF2 password hashing and HttpOnly sessions.
- Added SQLite-backed cross-device progress with revision conflict detection.
- Added local-first sync queue and online/offline status.
- Added account panel, guest mode and secure backend API.
- Added automated API integration tests and browser E2E tests.
- Improved runtime security headers and private data-file handling.

## 1.3.0 — 2026-11-06

- Added guided onboarding, XP/levels, daily quests and sequential lesson unlocking.
- Added resume-after-refresh and direct next-lesson flow.
- Added two-mode note game and lesson metronome.
- Added fully self-contained offline HTML bundle.

## 1.2.0 — 2026-11-06

- Rebuilt home around one primary action, weekly path and lightweight game.
- Removed source-screening clutter and verification dates from user UI.
- Switched to native CJK font stack.

## 1.1.0 — 2026-11-05

- Domestic-first resource library and local covers.
- PWA manifest, service worker and install flow.
