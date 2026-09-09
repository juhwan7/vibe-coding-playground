import test from 'node:test'
import assert from 'node:assert/strict'
import { inferThemeFromOverview, themeMembershipsForStock, themesForStock } from './themeCatalog.mjs'

test('사용자가 지정한 핵심 종목은 실제 테마 구성원으로 분류한다', () => {
  const expected = new Map([
    ['009150', '반도체'], // 삼성전기
    ['032820', '원전'], // 우리기술
    ['222800', '반도체'], // 심텍
    ['353200', '반도체'], // 대덕전자
    ['327260', '반도체'], // RF머트리얼즈
    ['062040', '전력기기'], // 산일전기
    ['082740', '조선'], // 한화엔진
  ])

  for (const [symbol, theme] of expected) {
    const memberships = themeMembershipsForStock(symbol, '')
    assert.ok(memberships.some((item) => item.name === theme && item.source === 'catalog-symbol'), `${symbol} -> ${theme}`)
  }
})

test('카탈로그에 없는 종목은 기업개요의 강한 사업 근거로 단일 테마를 추론한다', () => {
  assert.equal(
    inferThemeFromOverview('999901', '테스트반도체', '동사는 반도체용 PCB와 패키지 기판을 제조해 주요 반도체 고객사에 공급하고 있음.'),
    '반도체',
  )
  assert.equal(
    inferThemeFromOverview('999902', '테스트전력', '동사는 산업용 변압기 제조 업체로 전력용 변압기와 배전용 변압기를 생산하고 있음.'),
    '전력기기',
  )
  assert.equal(
    inferThemeFromOverview('999903', '테스트조선', '동사는 선박 엔진과 선박기자재를 생산해 국내외 조선소에 공급하고 있음.'),
    '조선',
  )
  assert.equal(
    inferThemeFromOverview('999904', '테스트원전', '동사는 원전 계측제어 시스템과 원자력발전 관련 제어 장비를 공급하고 있음.'),
    '원전',
  )
})

test('기업개요 추론은 명시 카탈로그가 없을 때만 사용하고 애매한 개요는 테마를 만들지 않는다', () => {
  const explicit = themesForStock('009150', '삼성전기', '동사는 카메라모듈과 전자부품 사업도 영위하고 있음.')
  assert.deepEqual(explicit, ['반도체'])

  const ambiguous = themesForStock('999999', '테스트기업', '동사는 다양한 산업용 제품을 제조하고 국내외 고객에게 판매하고 있음.')
  assert.deepEqual(ambiguous, [])

  const inferred = themeMembershipsForStock(
    '999998',
    '테스트기업',
    '동사는 화합물 반도체 패키지를 개발 및 생산하는 기업으로 반도체 패키지 사업을 주력으로 하고 있음.',
  )
  assert.deepEqual(inferred, [{ name: '반도체', source: 'company-overview', confidence: 'high' }])
})
