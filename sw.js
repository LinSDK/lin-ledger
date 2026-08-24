// ============================================================================
// Lin Ledger : the service worker
//
// The strategy is network first, then the cache. Therefore you always get the
// newest file when the network works, and the application still opens when the
// network fails. Requests to the database never go into the cache, because that
// data must always be fresh.
// ============================================================================

const CACHE = 'lin-ledger-v2'

const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './assets/css/app.css',
  './assets/js/app.js', './assets/js/config.js', './assets/js/supabase.js',
  './assets/js/auth.js', './assets/js/store.js', './assets/js/money.js',
  './assets/js/dates.js', './assets/js/amortize.js', './assets/js/projection.js',
  './assets/js/charts.js', './assets/js/ui.js', './assets/js/remind.js',
  './assets/js/views/home.js', './assets/js/views/bills.js',
  './assets/js/views/loans.js', './assets/js/views/stats.js',
  './assets/js/views/more.js', './assets/js/views/accounts.js',
  './assets/js/views/categories.js', './assets/js/views/payroll.js',
  './assets/js/views/scenarios.js', './assets/js/views/settings.js',
  './assets/js/views/actions.js', './assets/js/views/quick-add.js',
  './assets/js/views/batch-add.js',
]

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(SHELL.map(u => c.add(u))))
      .then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()))
})

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  // Never keep a copy of the data or of the sign in calls.
  if (url.hostname.endsWith('supabase.co')) return

  const sameOrigin = url.origin === location.origin

  event.respondWith((async () => {
    try {
      // A file of this application always goes to the server for a check.
      //
      // A plain fetch reads the cache of the browser, and that cache can hold
      // an old copy from a server that sent no Cache-Control header. The file
      // would then stay old after you edit it. The option below makes the
      // browser ask the server every time. The server answers "not changed"
      // when nothing changed, therefore the cost is one small request.
      //
      // A file from another host keeps the normal rules, because a library
      // with a version number in its address never changes.
      const response = sameOrigin
        ? await fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' })
        : await fetch(request)

      if (response && response.ok && sameOrigin) {
        const copy = response.clone()
        caches.open(CACHE).then(c => c.put(request, copy)).catch(() => {})
      }
      return response
    } catch {
      // The network failed. Give the copy that is in store, so the
      // application still opens.
      const hit = await caches.match(request)
      return hit || (await caches.match('./index.html')) || Response.error()
    }
  })())
})
