# Piano samples

PianoPath bundles 30 MP3 samples from **Salamander Grand Piano V3**, recorded from a Yamaha C5 grand piano.

- Source recording: https://archive.org/details/SalamanderGrandPianoV3
- Web-pack source: https://github.com/darosh/samples-piano-mp3 (npm package `@audio-samples/piano-mp3-velocity13`, v1.0.5)
- Recording and sample library: Alexander Holm
- License: Creative Commons Attribution 3.0 (CC BY 3.0)
- License text: https://creativecommons.org/licenses/by/3.0/

Samples are provided for A0, C1, D#1, F#1, A1, C2, D#2, F#2, A2, C3, D#3, F#3, A3, C4, D#4, F#4, A4, C5, D#5, F#5, A5, C6, D#6, F#6, A6, C7, D#7, F#7, A7 and C8. Sharp note names use `Ds`/`Fs` in the local filenames so they are safe to serve on every web host; audio content is unmodified.

The files are stored locally so playback does not depend on a third-party server at runtime. PianoPath transposes the nearest sample for every note and uses a lightweight synthesized fallback if any browser cannot decode the samples.

Recorded at 48 kHz / 24-bit, sampled in minor thirds with 16 velocity layers in the source library. PianoPath currently bundles the velocity-13 layer from that source; no runtime normalization is applied.

Attribution notice: "Salamander Grand Piano V3 by Alexander Holm, licensed under CC BY 3.0. PianoPath bundles unmodified audio samples."

License URL: https://creativecommons.org/licenses/by/3.0/
