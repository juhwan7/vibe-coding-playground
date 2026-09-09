import { QuizDescriptionService } from './quizDescriptionService.mjs'
import { QuizUniverseService } from './quizUniverseService.mjs'

const PATCH_FLAG = Symbol.for('market-flow.quiz-runtime-bootstrap.v1')
const MAINTENANCE_MS = Math.max(60_000, Number(process.env.QUIZ_MAINTENANCE_MS || 5 * 60 * 1000))

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function prioritizeQuizTargets(universe = {}) {
  const kospi = Array.isArray(universe.kospi200) ? universe.kospi200 : []
  const kosdaq = Array.isArray(universe.kosdaq150) ? universe.kosdaq150 : []
  const result = []
  const seen = new Set()
  const max = Math.max(kospi.length, kosdaq.length)

  for (let index = 0; index < max; index += 1) {
    for (const item of [kospi[index], kosdaq[index]]) {
      const code = String(item?.code ?? '')
      if (!/^\d{6}$/.test(code) || seen.has(code)) continue
      seen.add(code)
      result.push(item)
    }
  }
  return result
}

async function readOrFetchUniverse(service) {
  let universe = await service.readUniverse()
  if ((universe.targets?.length ?? 0) < 4) {
    try {
      const loader = new QuizUniverseService({ cachePath: service.universeCachePath })
      const payload = await loader.get()
      if (!payload?.ok) {
        console.warn(`[market-backend] quiz universe unavailable: ${payload?.error ?? 'unknown error'}`)
      }
    } catch (error) {
      console.warn('[market-backend] quiz universe bootstrap failed', error instanceof Error ? error.message : error)
    }
    universe = await service.readUniverse()
  }

  return {
    ...universe,
    targets: prioritizeQuizTargets(universe),
  }
}

function scheduleMaintenance(service) {
  if (service.__quizRuntimeMaintenanceTimer) return
  const timer = setInterval(() => {
    if (service.warming) return
    void readOrFetchUniverse(service)
      .then((universe) => {
        if (universe.targets.length < 4) return null
        return service.prewarm(universe.targets)
      })
      .catch((error) => console.warn('[market-backend] quiz maintenance failed', error instanceof Error ? error.message : error))
  }, MAINTENANCE_MS)
  timer.unref?.()
  service.__quizRuntimeMaintenanceTimer = timer
}

export async function bootstrapQuizCache(service, { retries = 20, retryMs = 15000 } = {}) {
  const attempts = Math.max(1, Number(retries) || 1)
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const universe = await readOrFetchUniverse(service)
    if (universe.targets.length >= 4) {
      // Publish immediately so an existing description cache becomes usable before
      // the full 350-stock refresh has finished. prewarm republishes every 10 fills.
      await service.publishPrepared(universe).catch(() => {})
      scheduleMaintenance(service)
      console.log(`[market-backend] quiz prewarm started: ${universe.targets.length} index stocks`)
      return service.prewarm(universe.targets)
    }
    if (attempt < attempts - 1) await sleep(Math.max(250, Number(retryMs) || 15000))
  }
  return service.status([])
}

export function installQuizRuntimeBootstrap() {
  if (QuizDescriptionService.prototype[PATCH_FLAG]) return
  Object.defineProperty(QuizDescriptionService.prototype, PATCH_FLAG, { value: true })

  const originalGetMany = QuizDescriptionService.prototype.getMany
  QuizDescriptionService.prototype.bootstrapPrewarm = function bootstrapPrewarmWithUniverse(options = {}) {
    return bootstrapQuizCache(this, options)
  }
  QuizDescriptionService.prototype.getMany = async function getManyAndRepublish(...args) {
    const payload = await originalGetMany.apply(this, args)
    if (payload?.descriptionCount > 0) void this.publishPrepared().catch(() => {})
    return payload
  }
}

installQuizRuntimeBootstrap()
