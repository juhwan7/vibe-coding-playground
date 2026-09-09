import { readFileSync, statSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const DEFAULT_PATH = process.env.MANUAL_THEME_PATH || '/app/data/manual-themes.json'
const DEFAULT_CATALOG_PATH = process.env.THEME_CATALOG_PATH || new URL('./data/themes.kr.json', import.meta.url)
const MAX_THEME_NAME_LENGTH = 32
const RELOAD_THROTTLE_MS = 500

function cleanThemeName(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function themeKey(value) {
  return cleanThemeName(value).toLocaleLowerCase('ko-KR')
}

function normalizeBuiltInThemes(values) {
  const seen = new Set()
  const result = []
  for (const value of values ?? []) {
    const name = cleanThemeName(value)
    const key = themeKey(name)
    if (!name || !key || seen.has(key)) continue
    seen.add(key)
    result.push(name)
  }
  return result
}

function readBuiltInThemes(catalogPath) {
  try {
    const raw = JSON.parse(readFileSync(catalogPath, 'utf8'))
    return normalizeBuiltInThemes(Object.keys(raw?.themes ?? {}))
  } catch {
    return []
  }
}

export class ThemeStoreError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.name = 'ThemeStoreError'
    this.status = status
  }
}

export class ManualThemeStore {
  constructor({
    path = DEFAULT_PATH,
    catalogPath = DEFAULT_CATALOG_PATH,
    builtInThemes = null,
  } = {}) {
    this.path = path
    this.builtInThemes = normalizeBuiltInThemes(builtInThemes ?? readBuiltInThemes(catalogPath))
    this.customThemes = []
    this.assignments = {}
    this.updatedAt = null
    this.lastMtimeMs = 0
    this.lastDiskCheckAt = 0
    this.writeQueue = Promise.resolve()
    this.loadSync()
  }

  loadSync() {
    let parsed = null
    try {
      parsed = JSON.parse(readFileSync(this.path, 'utf8'))
    } catch {
      parsed = null
    }

    const builtInKeys = new Set(this.builtInThemes.map(themeKey))
    const customSeen = new Set()
    const customThemes = []
    for (const value of parsed?.customThemes ?? []) {
      const name = cleanThemeName(value)
      const key = themeKey(name)
      if (!name || !key || builtInKeys.has(key) || customSeen.has(key)) continue
      customSeen.add(key)
      customThemes.push(name)
    }

    const knownByKey = new Map([...this.builtInThemes, ...customThemes].map((name) => [themeKey(name), name]))
    const assignments = {}
    for (const [symbol, values] of Object.entries(parsed?.assignments ?? {})) {
      if (!/^\d{6}$/.test(symbol) || !Array.isArray(values)) continue
      const resolved = []
      const seen = new Set()
      for (const value of values) {
        const existing = knownByKey.get(themeKey(value))
        if (!existing || seen.has(existing)) continue
        seen.add(existing)
        resolved.push(existing)
      }
      if (resolved.length) assignments[symbol] = resolved
    }

    this.customThemes = customThemes
    this.assignments = assignments
    this.updatedAt = parsed?.updatedAt ?? null
    try {
      this.lastMtimeMs = statSync(this.path).mtimeMs
    } catch {
      this.lastMtimeMs = 0
    }
    this.lastDiskCheckAt = Date.now()
  }

  maybeReloadSync(force = false) {
    const now = Date.now()
    if (!force && now - this.lastDiskCheckAt < RELOAD_THROTTLE_MS) return
    this.lastDiskCheckAt = now
    try {
      const mtimeMs = statSync(this.path).mtimeMs
      if (force || mtimeMs > this.lastMtimeMs) this.loadSync()
    } catch {
      if (force && this.lastMtimeMs) this.loadSync()
    }
  }

  allThemes() {
    this.maybeReloadSync()
    return [...this.builtInThemes, ...this.customThemes]
  }

  resolveTheme(value) {
    const key = themeKey(value)
    if (!key) return null
    return this.allThemes().find((name) => themeKey(name) === key) ?? null
  }

  manualThemesForStock(symbol) {
    this.maybeReloadSync()
    const code = String(symbol ?? '').trim()
    const values = this.assignments[code]
    return Array.isArray(values) && values.length ? [...values] : null
  }

  snapshot() {
    this.maybeReloadSync()
    const usage = new Map(this.allThemes().map((name) => [name, 0]))
    for (const values of Object.values(this.assignments)) {
      for (const name of values) usage.set(name, (usage.get(name) ?? 0) + 1)
    }
    const builtInSet = new Set(this.builtInThemes)
    return {
      ok: true,
      version: 1,
      updatedAt: this.updatedAt,
      themes: this.allThemes().map((name) => ({
        name,
        builtIn: builtInSet.has(name),
        usageCount: usage.get(name) ?? 0,
      })),
      assignments: Object.fromEntries(Object.entries(this.assignments).map(([symbol, values]) => [symbol, [...values]])),
      rule: 'manual-overrides-automatic',
    }
  }

  assertNewName(value) {
    const name = cleanThemeName(value)
    if (!name) throw new ThemeStoreError('테마 이름을 입력해 주세요.')
    if (name.length > MAX_THEME_NAME_LENGTH) throw new ThemeStoreError(`테마 이름은 ${MAX_THEME_NAME_LENGTH}자 이하여야 합니다.`)
    return name
  }

  async persist() {
    await mkdir(dirname(this.path), { recursive: true })
    const tempPath = `${this.path}.tmp`
    const payload = {
      version: 1,
      updatedAt: this.updatedAt,
      customThemes: this.customThemes,
      assignments: this.assignments,
    }
    await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    await rename(tempPath, this.path)
    try {
      this.lastMtimeMs = statSync(this.path).mtimeMs
    } catch {
      this.lastMtimeMs = Date.now()
    }
    this.lastDiskCheckAt = Date.now()
  }

  mutate(worker) {
    const run = this.writeQueue.then(async () => {
      this.maybeReloadSync(true)
      const result = worker()
      this.updatedAt = new Date().toISOString()
      await this.persist()
      return result
    })
    this.writeQueue = run.catch(() => {})
    return run
  }

  createTheme(value) {
    return this.mutate(() => {
      const name = this.assertNewName(value)
      const existing = this.resolveTheme(name)
      if (existing) return { created: false, name: existing }
      this.customThemes.push(name)
      return { created: true, name }
    })
  }

  renameTheme(fromValue, toValue) {
    return this.mutate(() => {
      const from = this.resolveTheme(fromValue)
      if (!from) throw new ThemeStoreError('변경할 테마를 찾지 못했습니다.', 404)
      if (this.builtInThemes.includes(from)) throw new ThemeStoreError('기본 테마 이름은 변경할 수 없습니다.')

      const to = this.assertNewName(toValue)
      const existingTarget = this.resolveTheme(to)
      const target = existingTarget && themeKey(existingTarget) !== themeKey(from) ? existingTarget : to

      this.customThemes = this.customThemes
        .filter((name) => themeKey(name) !== themeKey(from))
      if (!existingTarget || themeKey(existingTarget) === themeKey(from)) this.customThemes.push(target)

      for (const [symbol, values] of Object.entries(this.assignments)) {
        const replaced = values.map((name) => themeKey(name) === themeKey(from) ? target : name)
        this.assignments[symbol] = [...new Set(replaced)]
      }

      return {
        renamed: true,
        from,
        name: target,
        merged: Boolean(existingTarget && themeKey(existingTarget) !== themeKey(from)),
      }
    })
  }

  deleteTheme(value) {
    return this.mutate(() => {
      const name = this.resolveTheme(value)
      if (!name) throw new ThemeStoreError('삭제할 테마를 찾지 못했습니다.', 404)
      if (this.builtInThemes.includes(name)) throw new ThemeStoreError('기본 테마는 삭제할 수 없습니다.')

      this.customThemes = this.customThemes.filter((item) => themeKey(item) !== themeKey(name))
      let detachedStocks = 0
      for (const [symbol, values] of Object.entries(this.assignments)) {
        const next = values.filter((item) => themeKey(item) !== themeKey(name))
        if (next.length !== values.length) detachedStocks += 1
        if (next.length) this.assignments[symbol] = next
        else delete this.assignments[symbol]
      }
      return { deleted: true, name, detachedStocks }
    })
  }

  assignStock(symbolValue, themeValues) {
    return this.mutate(() => {
      const symbol = String(symbolValue ?? '').trim()
      if (!/^\d{6}$/.test(symbol)) throw new ThemeStoreError('올바른 6자리 국내 종목코드가 필요합니다.')
      if (!Array.isArray(themeValues)) throw new ThemeStoreError('themes 배열이 필요합니다.')

      const resolved = []
      for (const value of themeValues) {
        const name = this.resolveTheme(value)
        if (!name) throw new ThemeStoreError(`등록되지 않은 테마입니다: ${cleanThemeName(value) || '-'}`)
        if (!resolved.includes(name)) resolved.push(name)
      }

      if (resolved.length) this.assignments[symbol] = resolved
      else delete this.assignments[symbol]
      return { symbol, themes: resolved, automatic: resolved.length === 0 }
    })
  }
}

export const manualThemeStore = new ManualThemeStore()

export function manualThemesForStock(symbol) {
  return manualThemeStore.manualThemesForStock(symbol)
}
