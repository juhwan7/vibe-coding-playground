import test from 'node:test'
import assert from 'node:assert/strict'
import { extractCompanyOverview } from './quizDescriptionService.mjs'

test('extracts the company overview section without surrounding page text', () => {
  const html = `
    <html><body>
      <h4>기업개요</h4>
      <div>동사는 메모리 반도체와 시스템 반도체를 생산하는 기업임.</div>
      <div>주요 제품은 HBM, DRAM, NAND이며 글로벌 고객사에 공급함.</div>
      <p>출처 : 에프앤가이드</p>
      <div>시세정보</div>
    </body></html>`
  assert.equal(
    extractCompanyOverview(html),
    '동사는 메모리 반도체와 시스템 반도체를 생산하는 기업임. 주요 제품은 HBM, DRAM, NAND이며 글로벌 고객사에 공급함.',
  )
})

test('returns null when no company overview exists', () => {
  assert.equal(extractCompanyOverview('<html><body>시세정보만 있음</body></html>'), null)
})
