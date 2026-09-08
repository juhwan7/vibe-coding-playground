import { createHash } from 'node:crypto'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export class PreparedSnapshotStore {
  constructor({ directory = process.env.PREPARED_DATA_DIR || '/app/public-data' } = {}) {
    this.directory = directory
    this.hashes = new Map()
    this.ready = mkdir(directory, { recursive: true }).catch(() => {})
  }

  async write(name, payload) {
    if (!name || payload == null) return false
    await this.ready
    const json = JSON.stringify(payload)
    const hash = createHash('sha1').update(json).digest('hex')
    if (this.hashes.get(name) === hash) return false

    const target = join(this.directory, name)
    await mkdir(dirname(target), { recursive: true })
    const temp = `${target}.${process.pid}.tmp`
    await writeFile(temp, json, 'utf8')
    await rename(temp, target)
    this.hashes.set(name, hash)
    return true
  }
}

export function compactHistoryForBrowser(payload) {
  return {
    days: payload?.days ?? 8,
    resolutionMinutes: payload?.resolutionMinutes ?? 1,
    tradingDays: payload?.tradingDays ?? 0,
    samples: (payload?.samples ?? []).map((sample) => ({
      updatedAt: sample.updatedAt,
      marketTradingAmount: sample.marketTradingAmount ?? null,
    })),
  }
}
