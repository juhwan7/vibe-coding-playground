import { expect, test } from '@playwright/test'

test('domestic liquidity dashboard is the first page and light theme is default', async ({ page }, testInfo) => {
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.getByTestId('liquidity-dashboard')).toBeVisible()
  await expect(page.getByRole('heading', { name: '국내 증시 자금 상태' })).toBeVisible()
  await expect(page.getByRole('button', { name: '시장 데이터 수동 새로고침' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('liquidity-dashboard.png'), fullPage: true })
})

test('domestic theme flow uses a data-driven brief, five themes, and TOP100 market detail', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.getByRole('button', { name: '국내 테마 흐름' }).click()

  await expect(page.getByTestId('market-intelligence')).toHaveCount(0)
  await expect(page.getByTestId('intraday-brief')).toBeVisible()
  await expect(page.getByRole('heading', { name: '장중 시황 브리핑' })).toBeVisible()
  await expect(page.getByText(/실제 TOP100·지수·테마 데이터/)).toBeVisible()

  await expect(page.getByTestId('feature-news')).toBeVisible()
  await expect(page.getByRole('heading', { name: '시황 요약' })).toBeVisible()
  await expect(page.getByText(/오늘 06:00 이후/)).toBeVisible()
  const timelineLayout = await page.getByTestId('feature-news-timeline').evaluate((node) => ({
    display: getComputedStyle(node).display,
    flow: getComputedStyle(node).gridAutoFlow,
  }))
  expect(timelineLayout.display).toBe('grid')
  expect(timelineLayout.flow).toBe('column')

  await expect(page.getByTestId('theme-strength-board')).toBeVisible()
  await expect(page.getByRole('heading', { name: /테마 강도 비교/ })).toBeVisible()
  await expect(page.getByText('개별주(STOCK)만')).toBeVisible()
  await expect(page.getByText(/5개 · 8% 또는 3회 확인 후 교체/)).toBeVisible()
  await expect(page.getByText(/거래대금 가중 3분 선차트 · 강한 자동 확대축/)).toBeVisible()
  await expect(page.getByTestId('top100-ranking')).toBeVisible()
  await expect(page.getByRole('heading', { name: '거래대금 TOP100 · 개별주만' })).toBeVisible()

  await expect(page.getByTestId('moneyflow-dashboard')).toBeVisible()
  await expect(page.getByRole('heading', { name: '거래대금 TOP100 시장 지도' })).toBeVisible()
  await expect(page.getByText(/고정 WATCHLIST가 아니라 거래대금 TOP100 개별주 기준/)).toBeVisible()
  await expect(page.getByText(/한국 전체 상장종목 수를 뜻하지 않습니다/)).toBeVisible()
  await expect(page.locator('.deep-market-details summary')).toHaveCount(0)

  await page.screenshot({ path: testInfo.outputPath('theme-flow-dashboard.png'), fullPage: true })
})

test('US theme flow page is available', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.getByRole('button', { name: '미국 테마 흐름' }).click()
  await expect(page.getByTestId('us-theme-strength-board')).toBeVisible()
  await expect(page.getByRole('heading', { name: /미국 테마 강도 비교/ })).toBeVisible()
  await expect(page.getByTestId('us-top100-ranking')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('us-theme-flow-dashboard.png'), fullPage: true })
})

test('daily issue digest menu is available before or after 15:20', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.getByRole('button', { name: '금일 이슈 정리' }).click()
  await expect(page.getByTestId('daily-issues')).toBeVisible()
  await expect(page.getByRole('heading', { name: '금일 이슈 정리' })).toBeVisible()
  await expect(page.getByText(/매일 15:20 기준/)).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('daily-issues.png'), fullPage: true })
})

test('market replay page sits between daily issues and stock quiz and exposes replay tools', async ({ page }, testInfo) => {
  await page.goto('/')
  const daily = page.getByRole('button', { name: '금일 이슈 정리' })
  const replay = page.getByRole('button', { name: '시장 복기' })
  const quiz = page.getByRole('button', { name: '종목 퀴즈' })
  await expect(daily).toBeVisible()
  await expect(replay).toBeVisible()
  await expect(quiz).toBeVisible()
  const labels = await page.locator('.global-nav > div button').allTextContents()
  expect(labels.indexOf('금일 이슈 정리')).toBeLessThan(labels.indexOf('시장 복기'))
  expect(labels.indexOf('시장 복기')).toBeLessThan(labels.indexOf('종목 퀴즈'))

  await replay.click()
  await expect(page.getByTestId('market-replay')).toBeVisible()
  await expect(page.getByRole('heading', { name: '시장 복기' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '지수·거래대금 흐름' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '시간대별 시장 주도권' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '거래대금 주도 종목' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '테마 순환 기록' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '수급·프로그램 복기' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '뉴스 타이밍' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('market-replay.png'), fullPage: true })
})

test('stock quiz uses one prepared Pi cache and never fetches descriptions per question', async ({ page }) => {
  let descriptionRequests = 0
  await page.route('**/api/quiz/descriptions**', async (route) => {
    descriptionRequests += 1
    await route.abort()
  })
  await page.route('**/data/quiz-prepared.json', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        source: 'test prepared Pi cache',
        sourceDate: '20260909',
        expectedCounts: { kospi200: 200, kosdaq150: 150, total: 350 },
        counts: { kospi200: 4, kosdaq150: 4, ready: 8 },
        cacheStatus: { running: true, targetCount: 350, readyCount: 8 },
        kospi200: [
          { code: '005930', name: '삼성전자', description: '메모리 반도체와 스마트폰 등을 생산하는 기업임.', source: 'test' },
          { code: '000660', name: 'SK하이닉스', description: 'DRAM과 NAND 등 메모리 반도체를 생산하는 기업임.', source: 'test' },
          { code: '005380', name: '현대차', description: '승용차와 상용차를 제조하고 판매하는 완성차 기업임.', source: 'test' },
          { code: '000270', name: '기아', description: '국내외에서 자동차를 생산하고 판매하는 완성차 기업임.', source: 'test' },
        ],
        kosdaq150: [
          { code: '196170', name: '알테오젠', description: '바이오의약품 플랫폼 기술을 개발하는 기업임.', source: 'test' },
          { code: '086520', name: '에코프로', description: '이차전지 소재 관련 사업을 영위하는 기업임.', source: 'test' },
          { code: '247540', name: '에코프로비엠', description: '이차전지 양극재를 생산하는 기업임.', source: 'test' },
          { code: '036930', name: '주성엔지니어링', description: '반도체와 디스플레이 제조 장비를 개발하는 기업임.', source: 'test' },
        ],
      }),
    })
  })

  await page.goto('/')
  await page.getByRole('button', { name: '종목 퀴즈' }).click()
  await expect(page.getByTestId('index-quiz')).toBeVisible()
  await expect(page.getByRole('heading', { name: /어느 시장의 기업을 더 많이 알고 있을까/ })).toBeVisible()
  await expect(page.getByTestId('quiz-pool-kospi200')).toContainText('4개 즉시 출제 가능')
  await expect(page.getByTestId('quiz-pool-kosdaq150')).toContainText('4개 즉시 출제 가능')
  await page.getByTestId('quiz-pool-kospi200').click()
  await expect(page.locator('.index-quiz-choices button')).toHaveCount(4)
  await expect(page.locator('.index-quiz-choices button').first()).not.toContainText('캐시')
  expect(descriptionRequests).toBe(0)
})

test('pages have no horizontal overflow', async ({ page }) => {
  await page.goto('/')
  for (const label of ['국내 테마 흐름', '미국 테마 흐름', '금일 이슈 정리', '시장 복기', '종목 퀴즈']) {
    const sizes = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }))
    expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.clientWidth + 1)
    await page.getByRole('button', { name: label }).click()
  }
  const sizes = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }))
  expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.clientWidth + 1)
})
