/* PianoPath service worker - offline-first app shell */
const CACHE = 'pianopath-v1.33.0';
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
  './assets/audio/piano/A0v13.mp3',
  './assets/audio/piano/A1v13.mp3',
  './assets/audio/piano/A2v13.mp3',
  './assets/audio/piano/A3v13.mp3',
  './assets/audio/piano/A4v13.mp3',
  './assets/audio/piano/A5v13.mp3',
  './assets/audio/piano/A6v13.mp3',
  './assets/audio/piano/A7v13.mp3',
  './assets/audio/piano/C1v13.mp3',
  './assets/audio/piano/C2v13.mp3',
  './assets/audio/piano/C3v13.mp3',
  './assets/audio/piano/C4v13.mp3',
  './assets/audio/piano/C5v13.mp3',
  './assets/audio/piano/C6v13.mp3',
  './assets/audio/piano/C7v13.mp3',
  './assets/audio/piano/C8v13.mp3',
  './assets/audio/piano/Ds1v13.mp3',
  './assets/audio/piano/Ds2v13.mp3',
  './assets/audio/piano/Ds3v13.mp3',
  './assets/audio/piano/Ds4v13.mp3',
  './assets/audio/piano/Ds5v13.mp3',
  './assets/audio/piano/Ds6v13.mp3',
  './assets/audio/piano/Ds7v13.mp3',
  './assets/audio/piano/Fs1v13.mp3',
  './assets/audio/piano/Fs2v13.mp3',
  './assets/audio/piano/Fs3v13.mp3',
  './assets/audio/piano/Fs4v13.mp3',
  './assets/audio/piano/Fs5v13.mp3',
  './assets/audio/piano/Fs6v13.mp3',
  './assets/audio/piano/Fs7v13.mp3'
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
