import test from 'node:test'
import assert from 'node:assert/strict'
import { KRX_INDEX_CONSTITUENTS_BLD, capIndexMembers, filterStockRows, splitIndexCode } from './quizUniverseService.mjs'

test('uses the KRX index-constituents endpoint instead of the all-index quote endpoint', () => {
  assert.equal(KRX_INDEX_CONSTITUENTS_BLD, 'dbms/MDC/STAT/standard/MDCSTAT00701')
})

test('splits KRX index codes for KOSPI200 and KOSDAQ150', () => {
  assert.deepEqual(splitIndexCode('1028'), { indIdx: '1', indIdx2: '028' })
  assert.deepEqual(splitIndexCode('2203'), { indIdx: '2', indIdx2: '203' })
})

test('quiz universe keeps six-digit stocks and excludes ETF/ETN products', () => {
  const rows = filterStockRows([
    { ISU_SRT_CD: '005930', ISU_ABBRV: '삼성전자' },
    { ISU_SRT_CD: '069500', ISU_ABBRV: 'KODEX 200' },
    { ISU_SRT_CD: '123456', ISU_ABBRV: '테스트 ETN' },
    { ISU_SRT_CD: '000660', ISU_ABBRV: 'SK하이닉스' },
    { ISU_SRT_CD: '000660', ISU_ABBRV: 'SK하이닉스' },
  ])
  assert.deepEqual(rows, [
    { code: '005930', name: '삼성전자' },
    { code: '000660', name: 'SK하이닉스' },
  ])
})

test('index pools never pad missing members and never exceed the target count', () => {
  const short = Array.from({ length: 197 }, (_, index) => ({ code: String(index).padStart(6, '0'), name: `종목${index}` }))
  assert.equal(capIndexMembers(short, 200).length, 197)

  const long = Array.from({ length: 205 }, (_, index) => ({ code: String(index).padStart(6, '0'), name: `종목${index}` }))
  assert.equal(capIndexMembers(long, 200).length, 200)
})
