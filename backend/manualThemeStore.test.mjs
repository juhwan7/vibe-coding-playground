import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ManualThemeStore, ThemeStoreError } from './manualThemeStore.mjs'

async function withStore(run) {
  const directory = await mkdtemp(join(tmpdir(), 'manual-theme-store-'))
  const path = join(directory, 'manual-themes.json')
  const store = new ManualThemeStore({
    path,
    builtInThemes: ['원전', '반도체'],
  })
  try {
    await run({ store, path })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('테마 이름은 한 번 생성한 뒤 동일 이름을 재사용한다', async () => {
  await withStore(async ({ store }) => {
    const created = await store.createTheme('대미투자')
    assert.equal(created.created, true)
    assert.equal(created.name, '대미투자')

    const duplicate = await store.createTheme('  대미투자  ')
    assert.equal(duplicate.created, false)
    assert.equal(duplicate.name, '대미투자')

    const snapshot = store.snapshot()
    assert.deepEqual(snapshot.themes.map((theme) => theme.name), ['원전', '반도체', '대미투자'])
  })
})

test('수동 지정은 여러 기존 테마를 연결하고 파일에 영속 저장한다', async () => {
  await withStore(async ({ store, path }) => {
    await store.createTheme('대미투자')
    await store.assignStock('034020', ['원전', '대미투자'])

    assert.deepEqual(store.manualThemesForStock('034020'), ['원전', '대미투자'])

    const persisted = JSON.parse(await readFile(path, 'utf8'))
    assert.deepEqual(persisted.assignments['034020'], ['원전', '대미투자'])

    const restored = new ManualThemeStore({ path, builtInThemes: ['원전', '반도체'] })
    assert.deepEqual(restored.manualThemesForStock('034020'), ['원전', '대미투자'])
  })
})

test('사용자 테마를 기존 기본 테마 이름으로 변경하면 안전하게 합친다', async () => {
  await withStore(async ({ store }) => {
    await store.createTheme('원전산업')
    await store.assignStock('034020', ['원전산업', '반도체'])

    const result = await store.renameTheme('원전산업', '원전')
    assert.equal(result.merged, true)
    assert.equal(result.name, '원전')
    assert.deepEqual(store.manualThemesForStock('034020'), ['원전', '반도체'])
    assert.equal(store.snapshot().themes.some((theme) => theme.name === '원전산업'), false)
  })
})

test('수동 지정을 비우면 자동 분류로 복귀할 수 있다', async () => {
  await withStore(async ({ store }) => {
    await store.assignStock('005930', ['반도체'])
    assert.deepEqual(store.manualThemesForStock('005930'), ['반도체'])

    const result = await store.assignStock('005930', [])
    assert.equal(result.automatic, true)
    assert.equal(store.manualThemesForStock('005930'), null)
  })
})

test('기본 테마는 삭제하거나 이름을 바꿀 수 없다', async () => {
  await withStore(async ({ store }) => {
    await assert.rejects(() => store.deleteTheme('원전'), ThemeStoreError)
    await assert.rejects(() => store.renameTheme('반도체', 'HBM'), ThemeStoreError)
  })
})
