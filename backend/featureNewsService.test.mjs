import test from 'node:test'
import assert from 'node:assert/strict'
import { parseNewsRss } from './featureNewsService.mjs'

test('parses feature-stock RSS items with source and real link path', () => {
  const xml = `<?xml version="1.0"?><rss><channel><item><title><![CDATA[[특징주] 삼성전자, 장중 강세 - 예시경제]]></title><link>https://news.google.com/rss/articles/example</link><pubDate>Tue, 08 Sep 2026 01:30:00 GMT</pubDate><source url="https://example.com">예시경제</source></item></channel></rss>`
  const items = parseNewsRss(xml)
  assert.equal(items.length, 1)
  assert.equal(items[0].title, '[특징주] 삼성전자, 장중 강세')
  assert.equal(items[0].source, '예시경제')
  assert.equal(items[0].link, 'https://news.google.com/rss/articles/example')
})
