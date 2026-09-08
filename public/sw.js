const CACHE_NAME = 'market-flow-live-v1'
const DATA_PATHS = new Set([
  '/api/market/snapshot',
  '/api/market/history',
  '/api/market/theme-flow',
  '/api/market/us-theme-flow',
  '/api/market/feature-news',
  '/api/market/funding',
])

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    await self.clients.claim()
  })())
})

function shouldCache(request) {
  if (request.method !== 'GET') return false
  const url = new URL(request.url)
  return url.origin === self.location.origin && DATA_PATHS.has(url.pathname)
}

async function updateCache(request, cache) {
  try {
    const response = await fetch(request)
    if (response.ok) await cache.put(request, response.clone())
    return response
  } catch {
    return null
  }
}

self.addEventListener('fetch', (event) => {
  if (!shouldCache(event.request)) return

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME)
    const cached = await cache.match(event.request)
    const networkPromise = updateCache(event.request, cache)

    if (cached) {
      event.waitUntil(networkPromise)
      return cached
    }

    const network = await networkPromise
    if (network) return network
    return new Response(JSON.stringify({ ok: false, error: 'cached-market-data-unavailable' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    })
  })())
})
