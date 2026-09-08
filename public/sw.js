const CACHE_NAME = 'market-flow-live-v2'
const DATA_PATHS = new Set([
  '/api/market/snapshot',
  '/api/market/history',
  '/api/market/theme-flow',
  '/api/market/us-theme-flow',
  '/api/market/feature-news',
  '/api/market/funding',
])
const FAST_NETWORK_BUDGET_MS = 250

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

function delay(ms) {
  return new Promise((resolve) => setTimeout(() => resolve(null), ms))
}

self.addEventListener('fetch', (event) => {
  if (!shouldCache(event.request)) return

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME)
    const cached = await cache.match(event.request)
    const networkPromise = updateCache(event.request, cache)

    if (cached) {
      // Prepared Nginx JSON normally wins within 250ms and is shown fresh.
      // If Pi/network is slower, show the last good browser copy immediately.
      const fastNetwork = await Promise.race([networkPromise, delay(FAST_NETWORK_BUDGET_MS)])
      if (fastNetwork?.ok) return fastNetwork
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
