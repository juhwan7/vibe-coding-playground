import test from 'node:test'
import assert from 'node:assert/strict'
import { filterStockRows, splitIndexCode } from './quizUniverseService.mjs'

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
