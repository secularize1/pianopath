# Changelog

## 1.31.0 — 2026-11-08

- Added an in-lesson record-and-review panel with a 60-second limit and explicit microphone permission.
- Stored recording blobs in IndexedDB; learning history stores metadata only and never receives audio blobs.
- Added in-place playback, download, replacement and deletion for lesson recordings.
- Added completed-practice playback from the stats page and a focused recording dialog.
- Added graceful microphone-denial and single-file/Unsupported-browser recovery.
- Updated privacy/terms, CSP media policy and `Permissions-Policy` for same-origin microphone use.
- Added recording success, permission denial, download, deletion, history metadata and standalone fallback coverage.

## 1.30.0 — 2026-11-08

- Replaced the FluidR3 sample set with Salamander Grand Piano V3 (Yamaha C5) from Alexander Holm.
- Bundled 30 local samples covering A0–C8 at velocity layer 13, with CC BY 3.0 attribution.
- Preserved the recorded attack and decay instead of forcing a short synthetic-style gain envelope.
- Reduced master compression and increased headroom so chords retain dynamics and natural string resonance.
- Updated service-worker caching, audio metadata, offline cache checks and 30/30 sample decoding coverage.

## 1.29.0 — 2026-11-08

- Rebuilt the virtual piano as two visual layers: white keys below and black keys inset over the correct gaps above.
- Mapped black keys to the numeric keypad `N1–N0` and kept white keys on the lower letter row plus numeric-keypad high notes.
- Unified tutorial, free-play and rhythm-piano geometry and physical key mappings.
- Added 26 locally bundled FluidR3_GM acoustic grand piano samples with CC BY 3.0 attribution.
- Added sample decoding, audible-engine status, PWA caching and synthesized fallback coverage.
- Added geometry, Numpad mapping, transposition and sample-playback regression tests.

## 1.28.0 — 2026-11-08

- Changed the home due-review shortcut to launch the highest-priority 10-minute review directly.
- Reused one review-session builder for both home and progress surfaces.
- Verified successful reviews advance the spaced-repetition interval, leave the due queue and create history.
- Added desktop and mobile regression coverage for direct review entry and completion.

## 1.27.1 — 2026-11-08

- Cleared focused controls when entering the rhythm stage so the mapped `Enter` key plays C4 instead of activating a previously focused button.
- Preserved normal Enter activation inside the keyboard tutorial and formal dialogs.
- Clarified both row ranges, continuous chromatic mapping and IME-safe physical key handling in the tutorial.
- Verified the first rhythm note, tutorial CTA, desktop/mobile layouts and interrupted-practice recovery.

## 1.27.0 — 2026-11-08

- Preserved full session snapshots for quick practice, repertoire practice and long-term stage practice.
- The primary home CTA now resumes an interrupted session from its saved step instead of starting over.
- Home progress messaging explicitly shows the saved segment after returning or reloading.
- Added desktop/mobile reload coverage for main lessons and quick practice.
- Kept tutorial previews excluded from free-play counters and formal practice history.

## 1.26.1 — 2026-11-08

- Changed the keyboard tutorial from free exploration to an ordered `C3 → C#3 → D3` guided sequence.
- Highlights the next target key and only advances when that exact note is played.
- Wrong notes still preview their pitch but keep progress unchanged and show a recovery cue.
- Added desktop/mobile regression coverage for target highlighting, wrong-key recovery and ordered completion.

## 1.26.0 — 2026-11-08

- Made every key in the two-row keyboard tutorial playable by physical keyboard, pointer and touch.
- Switched piano input to physical `KeyboardEvent.code` values so IME composition, letter case and keyboard layout do not change the mapped note.
- Added a three-key guided warm-up (`Z → X → C`) with audible notes, active-key feedback and a completion state.
- Kept tutorial previews out of free-play counters and saved practice history.
- Added desktop and mobile coverage for tutorial previews, IME-resistant key codes and progress completion.

## 1.25.0 — 2026-11-08

- Replaced the split four-group computer mapping with two continuous chromatic rows: `Z–Enter` for C3–C4 and `Q–\\` for C#4–D5.
- Added a dedicated keyboard tutorial with per-key computer labels, note names, black/white styling, first-run display and reopen controls.
- Kept the tutorial to exactly two rows on desktop, phone and landscape layouts, with horizontal row scrolling instead of wrapping.
- Added 60-minute practices for all five long-term stages, including completion history, XP and return-to-path behavior.
- Added desktop/mobile E2E and runtime checks for the new mapping, tutorial, keyboard input and transposed free-play notes.

## 1.24.0 — 2026-11-08

- Added a configurable practice start time to the weekly routine.
- Added one-click export of 48 calendar events across the next 12 weeks as an ICS file.
- Displayed the scheduled time in the home CTA and weekly trail.
- Persisted reminder time through sync and backup import; server plans normalize old profiles.

## 1.23.0 — 2026-11-08

- Added selectable practice weekdays to the personal plan and synchronized them with the weekly session count.
- Home and weekly trail now show the actual upcoming weekday and date for every session.
- Persisted practice days through local state, account sync and backup import with legacy-plan defaults.
- Added desktop/mobile regressions for weekday editing, persistence and responsive touch sizing.
- Restored server-side plan generation and included selected practice days in plan responses.

## 1.22.0 — 2026-11-08

- Added a 40–208 BPM metronome to free-play piano with persisted tempo.
- Added Web Audio look-ahead scheduling, accented downbeats and a four-beat visual indicator.
- Stops metronome audio when leaving free play, closing the piano or switching tabs.
- Preserved usable landscape key height on phones and added desktop/mobile regressions.

## 1.21.0 — 2026-11-07

- Added standalone privacy-policy and terms pages with local-data, account-sync, retention, deletion, copyright and practice-safety disclosures.
- Registration now requires explicit consent to the current legal version; the server validates and records the version and timestamp.
- Added legal links to account controls and an embedded legal view for the single-file offline build.
- Added DOM, API, account-flow, responsive-page and offline-cache coverage for the legal surfaces.

## 1.20.0 — 2026-11-07

- Added a real landscape control to free-play piano mode instead of a hint-only button.
- Requests fullscreen and locks the system orientation where the browser supports it.
- Added a rotated landscape fallback for iPhone and other browsers that do not support orientation lock.
- Restores orientation and fullscreen state when leaving free play or closing the piano.

## 1.19.0 — 2026-11-07

- Expanded the rhythm-piano library from four to eight public-domain melodies.
- Added Frère Jacques, London Bridge, Old MacDonald and Auld Lang Syne arrangements.
- Added all/beginner/advanced song filters with pressed-state accessibility.
- Added desktop and mobile coverage for song counts and filter behavior.

## 1.18.0 — 2026-11-07

- Added live key and unique-note feedback to free-play sessions.
- Completed free-play sessions now save to practice history with duration and note metrics.
- Free play contributes to short-practice daily goals and total minutes without completing a main lesson.
- Added desktop and mobile regression coverage for persistence and lesson classification.
- Added per-song best accuracy badges and context-aware labels in practice history.
- Free play now stores exact duration seconds while keeping minute totals backward compatible.

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
