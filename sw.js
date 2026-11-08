/* PianoPath service worker - offline-first app shell */
const CACHE = 'pianopath-v1.29.0';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './data.js',
  './app.js',
  './manifest.webmanifest',
  './privacy.html',
  './terms.html',
  './legal.css',
  './assets/hero-piano.jpg',
  './assets/icon.svg',
  './assets/fallback.svg',
  './assets/covers/abrsm.svg',
  './assets/covers/trinity.svg',
  './assets/covers/rcm.svg',
  './assets/covers/faber.svg',
  './assets/covers/method.svg',
  './assets/covers/nainai.jpg',
  './assets/covers/yumu.jpg',
  './assets/covers/xiaohui.jpg',
  './assets/covers/xin_beyer.jpg',
  './assets/covers/xin_hanon.jpg',
  './assets/covers/pedal.jpg',
  './assets/covers/xinhui_system.jpg',
  './assets/audio/piano/C3.mp3',
  './assets/audio/piano/Db3.mp3',
  './assets/audio/piano/D3.mp3',
  './assets/audio/piano/Eb3.mp3',
  './assets/audio/piano/E3.mp3',
  './assets/audio/piano/F3.mp3',
  './assets/audio/piano/Gb3.mp3',
  './assets/audio/piano/G3.mp3',
  './assets/audio/piano/Ab3.mp3',
  './assets/audio/piano/A3.mp3',
  './assets/audio/piano/Bb3.mp3',
  './assets/audio/piano/B3.mp3',
  './assets/audio/piano/C4.mp3',
  './assets/audio/piano/Db4.mp3',
  './assets/audio/piano/D4.mp3',
  './assets/audio/piano/Eb4.mp3',
  './assets/audio/piano/E4.mp3',
  './assets/audio/piano/F4.mp3',
  './assets/audio/piano/Gb4.mp3',
  './assets/audio/piano/G4.mp3',
  './assets/audio/piano/Ab4.mp3',
  './assets/audio/piano/A4.mp3',
  './assets/audio/piano/Bb4.mp3',
  './assets/audio/piano/B4.mp3',
  './assets/audio/piano/C5.mp3',
  './assets/audio/piano/D5.mp3'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put('./index.html', copy));
      return response;
    }).catch(() => caches.match('./index.html')));
    return;
  }
  event.respondWith(caches.match(request).then((cached) => {
    if (cached) return cached;
    return fetch(request).then((response) => {
      if (response.ok && (url.origin === location.origin || /ytimg|hdslb|biliimg/.test(url.hostname))) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    });
  }));
});
