import test from 'node:test'
import assert from 'node:assert/strict'
import { collapseNewsIssues, isPromotionalNews, parseNewsRss, summarizeIssueTitle } from './featureNewsService.mjs'

test('parses feature-stock RSS items with source and real link path', () => {
  const xml = `<?xml version="1.0"?><rss><channel><item><title><![CDATA[[특징주] 삼성전자, 장중 강세 - 예시경제]]></title><link>https://news.google.com/rss/articles/example</link><pubDate>Tue, 08 Sep 2026 01:30:00 GMT</pubDate><source url="https://example.com">예시경제</source></item></channel></rss>`
  const items = parseNewsRss(xml)
  assert.equal(items.length, 1)
  assert.equal(items[0].title, '[특징주] 삼성전자, 장중 강세')
  assert.equal(items[0].source, '예시경제')
  assert.equal(items[0].link, 'https://news.google.com/rss/articles/example')
})

test('turns article headlines into short issue labels', () => {
  assert.equal(summarizeIssueTitle('[특징주] [속보] LG에너지솔루션, 공급계약 소식에 강세'), 'LG에너지솔루션, 공급계약 소식에 강세')
})

test('filters obvious promotional or stock-room headlines', () => {
  assert.equal(isPromotionalNews({ title: '[광고] 무료 추천주 카톡방 입장', source: '예시' }), true)
  assert.equal(isPromotionalNews({ title: '[특징주] 삼성전자 HBM 수주 기대에 상승', source: '예시경제' }), false)
})

test('collapses duplicate reports and keeps timeline order', () => {
  const issues = collapseNewsIssues([
    { title: '[특징주] 삼성전자 HBM 수주 기대감에 4% 강세', link: 'https://example.com/a', source: 'A경제', publishedAt: '2026-09-08T00:10:00Z' },
    { title: '삼성전자, HBM 수주 기대감에 4% 상승', link: 'https://example.com/b', source: 'B뉴스', publishedAt: '2026-09-08T00:20:00Z' },
    { title: '[광고] 무료 추천주 리딩방', link: 'https://example.com/ad', source: '홍보매체', publishedAt: '2026-09-08T00:25:00Z' },
    { title: '[특징주] 두산에너빌리티 원전 수주 소식에 강세', link: 'https://example.com/c', source: 'C경제', publishedAt: '2026-09-08T01:10:00Z' },
  ])

  assert.equal(issues.length, 2)
  assert.equal(issues[0].duplicateCount, 2)
  assert.equal(issues[0].sourceCount, 2)
  assert.match(issues[0].summary, /삼성전자/)
  assert.match(issues[1].summary, /두산에너빌리티/)
  assert.ok(Date.parse(issues[0].publishedAt) < Date.parse(issues[1].publishedAt))
})
