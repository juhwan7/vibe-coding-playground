import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyStockSector } from './stockClassification.mjs'

test('기업개요 핵심사업 키워드로 대표 업종을 분류한다', () => {
  assert.equal(classifyStockSector({
    symbol: '123456',
    name: '샘플기업',
    description: '자동차용 카메라모듈과 전장부품을 생산하고 완성차 업체에 공급한다.',
  }).label, '자동차')

  assert.equal(classifyStockSector({
    symbol: '123457',
    name: '샘플기업2',
    description: '택배와 육상운송, 물류센터 운영을 주요 사업으로 영위한다.',
  }).label, '운송·물류')

  assert.equal(classifyStockSector({
    symbol: '123458',
    name: '샘플기업3',
    description: '신약 연구개발과 항체 의약품 임상을 진행한다.',
  }).label, '바이오·제약')
})

test('대표 업종을 찾지 못해도 TOP100 배지가 비지 않도록 fallback을 제공한다', () => {
  assert.deepEqual(
    classifyStockSector({ symbol: '999999', name: '분류단서없는회사', description: '' }),
    { label: '기타·개별주', source: 'fallback' },
  )
})

test('우선주와 알려진 예외 종목은 안정적인 대표 분류를 사용한다', () => {
  assert.equal(classifyStockSector({ symbol: '005935', name: '삼성전자우' }).label, '반도체')
  assert.equal(classifyStockSector({ symbol: '009150', name: '삼성전기' }).label, '전자·IT부품')
  assert.equal(classifyStockSector({ symbol: '402340', name: 'SK스퀘어' }).label, '지주·투자')
})
