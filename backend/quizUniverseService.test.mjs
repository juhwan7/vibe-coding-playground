import test from 'node:test'
import assert from 'node:assert/strict'
import { KRX_INDEX_CONSTITUENTS_BLD, capIndexMembers, filterStockRows, parseNaverIndexMembers, parseRiseEtfHoldings, parseTossEtfComposition, splitIndexCode } from './quizUniverseService.mjs'

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

test('RISE ETF holdings parser converts Korean ISINs into six-digit stock codes', () => {
  const html = `
    <table><tbody>
      <tr><td>1</td><td><a>삼성전자</a></td><td>KR7005930003</td><td>100</td><td>30.0%</td></tr>
      <tr><td>2</td><td>SK하이닉스</td><td>KR7000660001</td><td>50</td><td>20.0%</td></tr>
      <tr><td>3</td><td>원화예금</td><td>KRD010010001</td><td>1</td><td>1.0%</td></tr>
      <tr><td>4</td><td>RISE 200</td><td>KR7148020001</td><td>1</td><td>1.0%</td></tr>
    </tbody></table>`
  assert.deepEqual(parseRiseEtfHoldings(html, 200), [
    { code: '005930', name: '삼성전자' },
    { code: '000660', name: 'SK하이닉스' },
  ])
})

test('Npay index page parser reads stock links and removes duplicate or ETF rows', () => {
  const html = `
    <a href="/item/main.naver?code=005930" target="_parent">삼성전자</a>
    <a href="/item/main.naver?code=000660" target="_parent">SK하이닉스</a>
    <a href="/item/main.naver?code=069500" target="_parent">KODEX 200</a>
    <a href="/item/main.naver?code=005930" target="_parent">삼성전자</a>`
  assert.deepEqual(parseNaverIndexMembers(html, 200), [
    { code: '005930', name: '삼성전자' },
    { code: '000660', name: 'SK하이닉스' },
  ])
})

test('Toss ETF composition fallback normalizes A-prefixed Korean stock codes', () => {
  const rows = parseTossEtfComposition({
    result: {
      items: [
        { stockCode: 'A005930', name: '삼성전자' },
        { stockCode: 'A000660', name: 'SK하이닉스' },
        { stockCode: 'A069500', name: 'KODEX 200' },
        { stockCode: null, name: '현금' },
      ],
    },
  }, 200)
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
