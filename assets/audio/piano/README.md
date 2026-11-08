# Piano samples

PianoPath bundles **five velocity layers** from **Salamander Grand Piano V3**, recorded from a Yamaha C5 grand piano.

- Source recording: https://archive.org/details/SalamanderGrandPianoV3
- Web-pack source: https://github.com/darosh/samples-piano-mp3
- Packages: `@audio-samples/piano-mp3-velocity3`, `velocity7`, `velocity11`, `velocity13`, `velocity16`, all v1.0.5
- Recording and sample library: Alexander Holm
- License: Creative Commons Attribution 3.0 (CC BY 3.0)
- License text: https://creativecommons.org/licenses/by/3.0/

The 30 sampled zones are A0, C1, D#1, F#1, A1, C2, D#2, F#2, A2, C3, D#3, F#3, A3, C4, D#4, F#4, A4, C5, D#5, F#5, A5, C6, D#6, F#6, A6, C7, D#7, F#7, A7 and C8. Each zone has five locally bundled velocity layers (150 MP3 files total). Sharp note names use `Ds`/`Fs` in local filenames so they are safe to serve on every web host; audio content is unmodified.

Five velocity layers are bundled so soft and strong key presses use different recorded attacks instead of merely changing playback volume. The runtime decodes the common middle zone first, then loads the requested layer and pitch zone on demand. A 150 MB decoded-audio cache cap prevents long sessions from retaining the full library in memory. The complete 150-file MP3 set is cached for offline use.

PianoPath keeps the recorded piano envelope intact and adds a subtle synthesized concert-room tail, gentle low-shelf body, high-shelf taming, rumble filtering and light dynamics control. If samples cannot be decoded, a velocity-aware four-partial synthesized fallback remains available.

Attribution notice: "Salamander Grand Piano V3 by Alexander Holm, licensed under CC BY 3.0. PianoPath bundles unmodified audio samples."

License URL: https://creativecommons.org/licenses/by/3.0/
