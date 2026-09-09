const INSTALL_KEY = Symbol.for('market-flow.runtime-intl-cache-installed')
const STATS_KEY = Symbol.for('market-flow.runtime-intl-cache-stats')

const MAX_VALUE_CACHE = Math.max(1000, Number(process.env.INTL_VALUE_CACHE_MAX || 10000))

function optionsKey(locales, options = {}) {
  const localeKey = Array.isArray(locales) ? locales.join(',') : String(locales ?? '')
  const optionKey = Object.keys(options)
    .sort()
    .map((key) => `${key}=${String(options[key])}`)
    .join('&')
  return `${localeKey}|${optionKey}`
}

function timeKey(value) {
  if (value == null) return null
  if (value instanceof Date) {
    const time = value.getTime()
    return Number.isFinite(time) ? time : null
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : null
}

function boundedSet(map, key, value) {
  if (map.size >= MAX_VALUE_CACHE) map.clear()
  map.set(key, value)
}

function makeWrapper(nativeFormatter, stats) {
  const formatCache = new Map()
  const partsCache = new Map()
  const wrapper = Object.create(Object.getPrototypeOf(nativeFormatter))

  Object.defineProperties(wrapper, {
    format: {
      enumerable: false,
      value(value) {
        const key = timeKey(value)
        if (key != null && formatCache.has(key)) {
          stats.formatHits += 1
          return formatCache.get(key)
        }
        stats.formatMisses += 1
        const result = nativeFormatter.format(value)
        if (key != null) boundedSet(formatCache, key, result)
        return result
      },
    },
    formatToParts: {
      enumerable: false,
      value(value) {
        const key = timeKey(value)
        if (key != null && partsCache.has(key)) {
          stats.partsHits += 1
          return partsCache.get(key)
        }
        stats.partsMisses += 1
        const result = nativeFormatter.formatToParts(value)
        if (key != null) boundedSet(partsCache, key, result)
        return result
      },
    },
    resolvedOptions: {
      enumerable: false,
      value: () => nativeFormatter.resolvedOptions(),
    },
  })

  if (typeof nativeFormatter.formatRange === 'function') {
    Object.defineProperty(wrapper, 'formatRange', {
      enumerable: false,
      value: nativeFormatter.formatRange.bind(nativeFormatter),
    })
  }
  if (typeof nativeFormatter.formatRangeToParts === 'function') {
    Object.defineProperty(wrapper, 'formatRangeToParts', {
      enumerable: false,
      value: nativeFormatter.formatRangeToParts.bind(nativeFormatter),
    })
  }

  return wrapper
}

export function installRuntimeIntlCache() {
  if (globalThis[INSTALL_KEY]) return globalThis[STATS_KEY]

  const NativeDateTimeFormat = Intl.DateTimeFormat
  const formatters = new Map()
  const stats = {
    formatterHits: 0,
    formatterMisses: 0,
    formatHits: 0,
    formatMisses: 0,
    partsHits: 0,
    partsMisses: 0,
    maxValueCache: MAX_VALUE_CACHE,
    get formatterCount() { return formatters.size },
  }

  function CachedDateTimeFormat(locales, options) {
    const key = optionsKey(locales, options)
    if (formatters.has(key)) {
      stats.formatterHits += 1
      return formatters.get(key)
    }

    stats.formatterMisses += 1
    const nativeFormatter = new NativeDateTimeFormat(locales, options)
    const wrapper = makeWrapper(nativeFormatter, stats)
    formatters.set(key, wrapper)
    return wrapper
  }

  Object.defineProperty(CachedDateTimeFormat, 'supportedLocalesOf', {
    configurable: true,
    value: NativeDateTimeFormat.supportedLocalesOf.bind(NativeDateTimeFormat),
  })
  Object.defineProperty(CachedDateTimeFormat, 'prototype', {
    configurable: false,
    writable: false,
    value: NativeDateTimeFormat.prototype,
  })

  Object.defineProperty(Intl, 'DateTimeFormat', {
    configurable: true,
    writable: true,
    value: CachedDateTimeFormat,
  })

  globalThis[INSTALL_KEY] = true
  globalThis[STATS_KEY] = stats
  console.log('[market-backend] Intl.DateTimeFormat runtime cache enabled')
  return stats
}

export function runtimeIntlCacheStats() {
  return globalThis[STATS_KEY] ?? null
}

if (process.env.RUNTIME_INTL_CACHE !== '0') installRuntimeIntlCache()
