import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function kstParts(value = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(value))
  const get = (type) => parts.find((part) => part.type === type)?.value ?? '00'
  return {
    day: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  }
}

function compactSnapshot(snapshot = {}, themePayload = {}) {
  return {
    capturedAt: new Date().toISOString(),
    sourceUpdatedAt: snapshot.updatedAt ?? null,
    marketTradingAmount: number(snapshot.marketTradingAmount),
    indices: snapshot.indices ?? {},
    marketInvestors: snapshot.marketInvestors ?? null,
    programSummary: snapshot.programSummary ?? null,
    futures: snapshot.futures ?? null,
    topRankings: (snapshot.topRankings ?? []).slice(0, 100),
    themes: (themePayload.themes ?? []).slice(0, 4).map((theme) => ({
      name: theme.name,
      tradingAmount: number(theme.tradingAmount),
      overlapAdjustedTradingAmount: number(theme.overlapAdjustedTradingAmount),
      currentValue: number(theme.currentValue),
      change1h: number(theme.change1h),
      breadthPercent: number(theme.breadthPercent),
      leaderConcentrationPercent: number(theme.leaderConcentrationPercent),
      lifecycle: theme.lifecycle ?? null,
      members: (theme.members ?? []).slice(0, 12),
    })),
  }
}

export class CloseArchiveService {
  constructor(getSnapshot, getThemePayload, {
    cachePath = process.env.CLOSE_ARCHIVE_CACHE_PATH || '/app/data/close-archive.json',
    checkMs = Number(process.env.CLOSE_ARCHIVE_CHECK_MS || 30000),
    keepDays = 35,
  } = {}) {
    this.getSnapshot = getSnapshot
    this.getThemePayload = getThemePayload
    this.cachePath = cachePath
    this.checkMs = Math.max(10000, Number(checkMs) || 30000)
    this.keepDays = Math.max(5, Number(keepDays) || 35)
    this.records = []
    this.timer = null
    this.running = false
  }

  async load() {
    try {
      const saved = JSON.parse(await readFile(this.cachePath, 'utf8'))
      if (Array.isArray(saved?.records)) this.records = saved.records
    } catch {}
    this.trim()
  }

  trim() {
    const days = [...new Set(this.records.map((record) => record.date).filter(Boolean))].sort()
    const keep = new Set(days.slice(-this.keepDays))
    this.records = this.records.filter((record) => keep.has(record.date))
  }

  async persist() {
    await mkdir(dirname(this.cachePath), { recursive: true })
    const temp = `${this.cachePath}.tmp`
    await writeFile(temp, JSON.stringify({ version: 1, savedAt: new Date().toISOString(), records: this.records }), 'utf8')
    await rename(temp, this.cachePath)
  }

  async start() {
    if (this.running) return
    this.running = true
    await this.load()
    await this.check().catch(() => {})
    this.schedule()
  }

  stop() {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
  }

  schedule() {
    if (!this.running) return
    this.timer = setTimeout(async () => {
      await this.check().catch(() => {})
      this.schedule()
    }, this.checkMs)
    this.timer.unref?.()
  }

  current() {
    return {
      ok: true,
      targets: ['15:20 PRE_CLOSE', '15:35 FINAL'],
      records: this.records,
      latest: this.records.at(-1) ?? null,
    }
  }

  async capture(date, slot) {
    if (this.records.some((record) => record.date === date && record.slot === slot)) return
    const snapshot = this.getSnapshot?.()
    if (!snapshot?.updatedAt) return
    const themePayload = this.getThemePayload?.() ?? {}
    this.records.push({ date, slot, ...compactSnapshot(snapshot, themePayload) })
    this.records.sort((a, b) => `${a.date}-${a.slot}`.localeCompare(`${b.date}-${b.slot}`))
    this.trim()
    await this.persist()
  }

  async check() {
    const now = kstParts()
    const minute = now.hour * 60 + now.minute
    if (minute >= 15 * 60 + 20) await this.capture(now.day, 'PRE_CLOSE')
    if (minute >= 15 * 60 + 35) await this.capture(now.day, 'FINAL')
    return this.current()
  }
}
