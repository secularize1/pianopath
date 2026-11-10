/* PianoPath service worker - offline-first app shell */
const CACHE = 'pianopath-v1.41.1';
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
  './assets/audio/piano/A0v11.mp3',
  './assets/audio/piano/A0v13.mp3',
  './assets/audio/piano/A0v16.mp3',
  './assets/audio/piano/A0v3.mp3',
  './assets/audio/piano/A0v7.mp3',
  './assets/audio/piano/A1v11.mp3',
  './assets/audio/piano/A1v13.mp3',
  './assets/audio/piano/A1v16.mp3',
  './assets/audio/piano/A1v3.mp3',
  './assets/audio/piano/A1v7.mp3',
  './assets/audio/piano/A2v11.mp3',
  './assets/audio/piano/A2v13.mp3',
  './assets/audio/piano/A2v16.mp3',
  './assets/audio/piano/A2v3.mp3',
  './assets/audio/piano/A2v7.mp3',
  './assets/audio/piano/A3v11.mp3',
  './assets/audio/piano/A3v13.mp3',
  './assets/audio/piano/A3v16.mp3',
  './assets/audio/piano/A3v3.mp3',
  './assets/audio/piano/A3v7.mp3',
  './assets/audio/piano/A4v11.mp3',
  './assets/audio/piano/A4v13.mp3',
  './assets/audio/piano/A4v16.mp3',
  './assets/audio/piano/A4v3.mp3',
  './assets/audio/piano/A4v7.mp3',
  './assets/audio/piano/A5v11.mp3',
  './assets/audio/piano/A5v13.mp3',
  './assets/audio/piano/A5v16.mp3',
  './assets/audio/piano/A5v3.mp3',
  './assets/audio/piano/A5v7.mp3',
  './assets/audio/piano/A6v11.mp3',
  './assets/audio/piano/A6v13.mp3',
  './assets/audio/piano/A6v16.mp3',
  './assets/audio/piano/A6v3.mp3',
  './assets/audio/piano/A6v7.mp3',
  './assets/audio/piano/A7v11.mp3',
  './assets/audio/piano/A7v13.mp3',
  './assets/audio/piano/A7v16.mp3',
  './assets/audio/piano/A7v3.mp3',
  './assets/audio/piano/A7v7.mp3',
  './assets/audio/piano/C1v11.mp3',
  './assets/audio/piano/C1v13.mp3',
  './assets/audio/piano/C1v16.mp3',
  './assets/audio/piano/C1v3.mp3',
  './assets/audio/piano/C1v7.mp3',
  './assets/audio/piano/C2v11.mp3',
  './assets/audio/piano/C2v13.mp3',
  './assets/audio/piano/C2v16.mp3',
  './assets/audio/piano/C2v3.mp3',
  './assets/audio/piano/C2v7.mp3',
  './assets/audio/piano/C3v11.mp3',
  './assets/audio/piano/C3v13.mp3',
  './assets/audio/piano/C3v16.mp3',
  './assets/audio/piano/C3v3.mp3',
  './assets/audio/piano/C3v7.mp3',
  './assets/audio/piano/C4v11.mp3',
  './assets/audio/piano/C4v13.mp3',
  './assets/audio/piano/C4v16.mp3',
  './assets/audio/piano/C4v3.mp3',
  './assets/audio/piano/C4v7.mp3',
  './assets/audio/piano/C5v11.mp3',
  './assets/audio/piano/C5v13.mp3',
  './assets/audio/piano/C5v16.mp3',
  './assets/audio/piano/C5v3.mp3',
  './assets/audio/piano/C5v7.mp3',
  './assets/audio/piano/C6v11.mp3',
  './assets/audio/piano/C6v13.mp3',
  './assets/audio/piano/C6v16.mp3',
  './assets/audio/piano/C6v3.mp3',
  './assets/audio/piano/C6v7.mp3',
  './assets/audio/piano/C7v11.mp3',
  './assets/audio/piano/C7v13.mp3',
  './assets/audio/piano/C7v16.mp3',
  './assets/audio/piano/C7v3.mp3',
  './assets/audio/piano/C7v7.mp3',
  './assets/audio/piano/C8v11.mp3',
  './assets/audio/piano/C8v13.mp3',
  './assets/audio/piano/C8v16.mp3',
  './assets/audio/piano/C8v3.mp3',
  './assets/audio/piano/C8v7.mp3',
  './assets/audio/piano/Ds1v11.mp3',
  './assets/audio/piano/Ds1v13.mp3',
  './assets/audio/piano/Ds1v16.mp3',
  './assets/audio/piano/Ds1v3.mp3',
  './assets/audio/piano/Ds1v7.mp3',
  './assets/audio/piano/Ds2v11.mp3',
  './assets/audio/piano/Ds2v13.mp3',
  './assets/audio/piano/Ds2v16.mp3',
  './assets/audio/piano/Ds2v3.mp3',
  './assets/audio/piano/Ds2v7.mp3',
  './assets/audio/piano/Ds3v11.mp3',
  './assets/audio/piano/Ds3v13.mp3',
  './assets/audio/piano/Ds3v16.mp3',
  './assets/audio/piano/Ds3v3.mp3',
  './assets/audio/piano/Ds3v7.mp3',
  './assets/audio/piano/Ds4v11.mp3',
  './assets/audio/piano/Ds4v13.mp3',
  './assets/audio/piano/Ds4v16.mp3',
  './assets/audio/piano/Ds4v3.mp3',
  './assets/audio/piano/Ds4v7.mp3',
  './assets/audio/piano/Ds5v11.mp3',
  './assets/audio/piano/Ds5v13.mp3',
  './assets/audio/piano/Ds5v16.mp3',
  './assets/audio/piano/Ds5v3.mp3',
  './assets/audio/piano/Ds5v7.mp3',
  './assets/audio/piano/Ds6v11.mp3',
  './assets/audio/piano/Ds6v13.mp3',
  './assets/audio/piano/Ds6v16.mp3',
  './assets/audio/piano/Ds6v3.mp3',
  './assets/audio/piano/Ds6v7.mp3',
  './assets/audio/piano/Ds7v11.mp3',
  './assets/audio/piano/Ds7v13.mp3',
  './assets/audio/piano/Ds7v16.mp3',
  './assets/audio/piano/Ds7v3.mp3',
  './assets/audio/piano/Ds7v7.mp3',
  './assets/audio/piano/Fs1v11.mp3',
  './assets/audio/piano/Fs1v13.mp3',
  './assets/audio/piano/Fs1v16.mp3',
  './assets/audio/piano/Fs1v3.mp3',
  './assets/audio/piano/Fs1v7.mp3',
  './assets/audio/piano/Fs2v11.mp3',
  './assets/audio/piano/Fs2v13.mp3',
  './assets/audio/piano/Fs2v16.mp3',
  './assets/audio/piano/Fs2v3.mp3',
  './assets/audio/piano/Fs2v7.mp3',
  './assets/audio/piano/Fs3v11.mp3',
  './assets/audio/piano/Fs3v13.mp3',
  './assets/audio/piano/Fs3v16.mp3',
  './assets/audio/piano/Fs3v3.mp3',
  './assets/audio/piano/Fs3v7.mp3',
  './assets/audio/piano/Fs4v11.mp3',
  './assets/audio/piano/Fs4v13.mp3',
  './assets/audio/piano/Fs4v16.mp3',
  './assets/audio/piano/Fs4v3.mp3',
  './assets/audio/piano/Fs4v7.mp3',
  './assets/audio/piano/Fs5v11.mp3',
  './assets/audio/piano/Fs5v13.mp3',
  './assets/audio/piano/Fs5v16.mp3',
  './assets/audio/piano/Fs5v3.mp3',
  './assets/audio/piano/Fs5v7.mp3',
  './assets/audio/piano/Fs6v11.mp3',
  './assets/audio/piano/Fs6v13.mp3',
  './assets/audio/piano/Fs6v16.mp3',
  './assets/audio/piano/Fs6v3.mp3',
  './assets/audio/piano/Fs6v7.mp3',
  './assets/audio/piano/Fs7v11.mp3',
  './assets/audio/piano/Fs7v13.mp3',
  './assets/audio/piano/Fs7v16.mp3',
  './assets/audio/piano/Fs7v3.mp3',
  './assets/audio/piano/Fs7v7.mp3'
];

const CORE_SHELL = APP_SHELL.filter((url) => !url.includes('/assets/audio/piano/'));
const PIANO_SHELL = APP_SHELL.filter((url) => url.includes('/assets/audio/piano/'));

async function cacheWithRetry(cache, url, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, { cache: 'reload' });
      if (!response.ok) throw new Error(`Precache failed: ${url} (${response.status})`);
      await cache.put(url, response);
      return true;
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** attempt)));
    }
  }
  throw lastError;
}

async function precacheInBatches(cache, urls, batchSize, required = true, onProgress = null) {
  const failures = [];
  let completed = 0;
  for (let index = 0; index < urls.length; index += batchSize) {
    const batch = urls.slice(index, index + batchSize);
    const results = await Promise.allSettled(batch.map(async (url) => {
      if (await cache.match(url)) return true;
      return cacheWithRetry(cache, url);
    }));
    results.forEach((result, batchIndex) => {
      if (result.status === 'rejected') failures.push({ url: batch[batchIndex], reason: result.reason });
    });
    completed += batch.length;
    onProgress?.({ completed, total: urls.length, failed: failures.length });
  }
  if (required && failures.length) {
    throw new Error(`Required offline shell failed: ${failures.map((item) => item.url).join(', ')}`);
  }
  return failures;
}

let pianoCacheTask = null;
async function cachePianoSamples(port = null) {
  if (pianoCacheTask) return pianoCacheTask;
  pianoCacheTask = (async () => {
    const cache = await caches.open(CACHE);
    const failures = await precacheInBatches(cache, PIANO_SHELL, 12, false, (progress) => {
      port?.postMessage({ type: 'PIANO_CACHE_PROGRESS', ...progress });
    });
    const cached = (await cache.keys()).filter((request) => request.url.includes('/assets/audio/piano/')).length;
    port?.postMessage({ type: 'PIANO_CACHE_DONE', total: PIANO_SHELL.length, cached, failed: failures.length });
    return { cached, failed: failures.length };
  })().finally(() => { pianoCacheTask = null; });
  return pianoCacheTask;
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Core pages activate quickly. Piano samples are warmed after activation.
    await precacheInBatches(cache, CORE_SHELL, 6, true);
    await self.skipWaiting();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'PRECACHE_PIANO') return;
  const port = event.ports?.[0] || null;
  event.waitUntil(cachePianoSamples(port).catch((error) => {
    port?.postMessage({ type: 'PIANO_CACHE_ERROR', message: error.message });
  }));
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
