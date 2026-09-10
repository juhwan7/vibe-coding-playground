import { expect, test } from '@playwright/test'

test('domestic theme flow is the first page and light theme is default', async ({ page }, testInfo) => {
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.getByTestId('theme-strength-board')).toBeVisible()
  await expect(page.getByRole('button', { name: '국내 테마 흐름' })).toHaveClass(/active/)
  await expect(page.getByTestId('liquidity-dashboard')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '시장 데이터 수동 새로고침' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('theme-flow-home.png'), fullPage: true })

  await page.getByRole('button', { name: '증시 자금' }).click()
  await expect(page.getByTestId('liquidity-dashboard')).toBeVisible()
  await expect(page.getByRole('heading', { name: '국내 증시 자금 상태' })).toBeVisible()
})

test('domestic theme flow keeps the brief hidden in a side drawer and shows five themes with TOP100 market detail', async ({ page }, testInfo) => {
  await page.goto('/')

  await expect(page.getByTestId('market-intelligence')).toHaveCount(0)
  await expect(page.getByTestId('intraday-brief')).toHaveCount(0)
  const briefTrigger = page.getByRole('button', { name: '장중 시황 브리핑', exact: true })
  await expect(briefTrigger).toBeVisible()
  await expect(briefTrigger).toHaveAttribute('aria-expanded', 'false')
  await briefTrigger.click()
  await expect(page.getByTestId('intraday-brief')).toBeVisible()
  await expect(page.getByRole('heading', { name: '장중 시황 브리핑' })).toBeVisible()
  await expect(page.getByText(/실제 TOP100·지수·테마 데이터/)).toBeVisible()
  await expect(briefTrigger).toHaveAttribute('aria-expanded', 'true')
  await page.getByRole('button', { name: '장중 시황 브리핑 닫기' }).click()
  await expect(page.getByTestId('intraday-brief')).toHaveCount(0)

  await expect(page.getByTestId('theme-strength-board')).toBeVisible()
  await expect(page.getByRole('heading', { name: /테마 강도 비교/ })).toBeVisible()
  await expect(page.getByText('개별주(STOCK)만')).toBeVisible()
  await expect(page.getByText(/5개 · 8% 또는 3회 확인 후 교체/)).toBeVisible()
  await expect(page.getByText(/거래대금 가중 3분 선차트 · 강한 자동 확대축/)).toBeVisible()
  await expect(page.getByTestId('top100-ranking')).toBeVisible()
  await expect(page.getByRole('heading', { name: '거래대금 TOP100 · 개별주만' })).toBeVisible()
  await expect(page.getByTestId('market-hud')).toBeVisible()
  await expect(page.getByTestId('market-hud')).toContainText('MARKET OBSERVATORY')
  await expect(page.getByTestId('market-hud')).toContainText('선두 테마')

  await expect(page.getByTestId('moneyflow-dashboard')).toBeVisible()
  await expect(page.getByRole('heading', { name: '거래대금 TOP100 시장 지도' })).toBeVisible()
  await expect(page.getByText(/고정 WATCHLIST가 아니라 거래대금 TOP100 개별주 기준/)).toBeVisible()
  await expect(page.getByText(/한국 전체 상장종목 수를 뜻하지 않습니다/)).toBeVisible()
  await expect(page.locator('.deep-market-details summary')).toHaveCount(0)

  await expect(page.getByTestId('feature-news')).toBeVisible()
  await expect(page.getByRole('heading', { name: '시황 요약' })).toBeVisible()
  await expect(page.getByText(/오늘 06:00 이후/)).toBeVisible()
  const timelineLayout = await page.getByTestId('feature-news-timeline').evaluate((node) => ({
    display: getComputedStyle(node).display,
    flow: getComputedStyle(node).gridAutoFlow,
  }))
  expect(timelineLayout.display).toBe('grid')
  expect(timelineLayout.flow).toBe('column')

  await page.screenshot({ path: testInfo.outputPath('theme-flow-dashboard.png'), fullPage: true })
})

test('market observatory adds lifecycle controls and theme spotlight without fake market data', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('market-hud')).toBeVisible()

  // The default browser-test backend can legitimately have no live theme rows.
  // Inject only DOM shells, not market values, so the enhancer interaction itself is deterministic.
  await page.waitForTimeout(1100)
  await page.locator('.theme-strength-list').evaluate((node) => {
    node.innerHTML = `
      <article class="theme-strength-row" style="--theme-accent:#ff4d6d">
        <div class="theme-summary-cell">
          <div class="theme-rank-line"><b>1</b><span class="theme-icon">◉</span><h2>원전</h2></div>
          <p>검증용 UI 셸</p>
          <strong>-</strong>
          <div><span>1일 누적 거래대금 합계</span><b>-</b></div>
          <div><span>최대 종목 거래대금 비중</span><b>-</b></div>
        </div>
      </article>
      <article class="theme-strength-row" style="--theme-accent:#39a0ff">
        <div class="theme-summary-cell">
          <div class="theme-rank-line"><b>2</b><span class="theme-icon">●</span><h2>반도체</h2></div>
          <p>검증용 UI 셸</p>
          <strong>-</strong>
          <div><span>1일 누적 거래대금 합계</span><b>-</b></div>
          <div><span>최대 종목 거래대금 비중</span><b>-</b></div>
        </div>
      </article>
    `
  })
  await page.locator('.top100-list').evaluate((node) => {
    node.innerHTML = `
      <div class="top100-row" data-theme-name="원전" data-symbol="034020" data-trading-amount="0"><b>1</b><div>원전 종목</div><strong>-</strong><div><small class="top100-share">TOP100 0%</small></div></div>
      <div class="top100-row" data-theme-name="반도체" data-symbol="005930" data-trading-amount="0"><b>2</b><div>반도체 종목</div><strong>-</strong><div><small class="top100-share">TOP100 0%</small></div></div>
    `
  })

  await expect(page.locator('.theme-lifecycle-panel')).toHaveCount(2, { timeout: 3000 })
  await expect(page.locator('.theme-lifecycle-panel').first()).toContainText('확인 중')

  const spotlightButtons = page.locator('.theme-spotlight-toggle')
  await expect(spotlightButtons).toHaveCount(2)
  await spotlightButtons.first().click()
  await expect(page.locator('.market-workspace')).toHaveClass(/theme-spotlight-active/)
  await expect(spotlightButtons.first()).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.top100-row.spotlight-match')).toHaveCount(1)
  await expect(page.locator('.top100-row.spotlight-muted')).toHaveCount(1)

  await spotlightButtons.first().click()
  await expect(page.locator('.market-workspace')).not.toHaveClass(/theme-spotlight-active/)
})
test('US theme flow page is available', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.getByRole('button', { name: '미국 테마 흐름' }).click()
  await expect(page.getByTestId('us-theme-strength-board')).toBeVisible()
  await expect(page.getByRole('heading', { name: /미국 정규장 기록/ })).toBeVisible()
  await expect(page.getByTestId('us-top100-ranking')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('us-theme-flow-dashboard.png'), fullPage: true })
})

test('daily issue digest puts chart on the left and shows 60-day daily candles plus real one-minute OHLC bars', async ({ page }, testInfo) => {
  const intraday = [
    {
      date: '2026-09-08',
      points: [
        { timestamp: '2026-09-08T00:00:00.000Z', open: 70000, high: 70200, low: 69900, close: 70100 },
        { timestamp: '2026-09-08T01:00:00.000Z', open: 70100, high: 70500, low: 70000, close: 70400 },
        { timestamp: '2026-09-08T02:00:00.000Z', open: 70400, high: 70500, low: 70000, close: 70100 },
        { timestamp: '2026-09-08T06:20:00.000Z', open: 70100, high: 70700, low: 70050, close: 70600 },
      ],
    },
    {
      date: '2026-09-09',
      points: [
        { timestamp: '2026-09-09T00:00:00.000Z', open: 70800, high: 71000, low: 70700, close: 70900 },
        { timestamp: '2026-09-09T01:00:00.000Z', open: 70900, high: 71700, low: 70800, close: 71600 },
        { timestamp: '2026-09-09T02:00:00.000Z', open: 71600, high: 71700, low: 71200, close: 71300 },
        { timestamp: '2026-09-09T06:20:00.000Z', open: 71300, high: 72200, low: 71200, close: 72100 },
      ],
    },
  ]
  const daily = [
    { timestamp: '2026-09-03T06:30:00.000Z', open: 69000, high: 69800, low: 68700, close: 69600 },
    { timestamp: '2026-09-04T06:30:00.000Z', open: 69600, high: 70400, low: 69300, close: 70100 },
    { timestamp: '2026-09-07T06:30:00.000Z', open: 70100, high: 70600, low: 69600, close: 70000 },
    { timestamp: '2026-09-08T06:30:00.000Z', open: 70000, high: 70800, low: 69800, close: 70600 },
    { timestamp: '2026-09-09T06:20:00.000Z', open: 70800, high: 72200, low: 70600, close: 72100 },
  ]
  const scaleBars = (bars: typeof intraday[number]['points'], multiplier: number) => bars.map((point) => ({
    ...point,
    open: point.open * multiplier,
    high: point.high * multiplier,
    low: point.low * multiplier,
    close: point.close * multiplier,
  }))

  await page.route('**/api/market/daily-issues', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        status: 'finalized',
        schemaVersion: 6,
        date: '2026-09-09',
        capturedAt: '2026-09-09T06:20:00.000Z',
        source: '테스트 실제 OHLC',
        rows: [
          { symbol: 'A005930', name: '삼성전자', market: 'KOSPI', theme: '반도체', price: 72100, changeRate: 2.1, tradingAmount: 1500000000000, issueSummary: 'HBM 공급 관련 뉴스', articleCount: 2, sources: ['테스트뉴스'], intraday, daily },
          { symbol: 'A000660', name: 'SK하이닉스', market: 'KOSPI', theme: '반도체', price: 312000, changeRate: 1.2, tradingAmount: 1100000000000, issueSummary: '메모리 업황 관련 뉴스', articleCount: 1, sources: ['테스트뉴스'], intraday: intraday.map((day) => ({ ...day, points: scaleBars(day.points, 4) })), daily: scaleBars(daily, 4) },
        ],
      }),
    })
  })

  await page.goto('/')
  await page.getByRole('button', { name: '금일 이슈 정리' }).click()
  await expect(page.getByTestId('daily-issues')).toBeVisible()
  await expect(page.getByRole('heading', { name: '금일 이슈 정리' })).toBeVisible()
  await expect(page.getByText(/최근 60거래일 실제 일봉 캔들/)).toBeVisible()
  await expect(page.getByText(/전일\+오늘 실제 1분 OHLC/)).toBeVisible()
  await expect(page.getByTestId('daily-issues-chart-panel')).toContainText('삼성전자')
  await expect(page.getByTestId('daily-issues-daily-chart')).toBeVisible()
  await expect(page.getByTestId('daily-issues-intraday-chart')).toBeVisible()
  await expect(page.locator('.daily-issues-daily-bar')).toHaveCount(5)
  await expect(page.locator('.daily-issues-candle-body')).toHaveCount(5)
  await expect(page.locator('.daily-issues-minute-bar')).toHaveCount(8)
  await expect(page.locator('.daily-issues-big-day-label')).toHaveText(['09.08', '09.09'])

  const split = await page.getByTestId('daily-issues-split-layout').evaluate((node) => {
    const children = Array.from(node.children) as HTMLElement[]
    return {
      left: children[0]?.getBoundingClientRect().width ?? 0,
      right: children[1]?.getBoundingClientRect().width ?? 0,
      leftTestId: children[0]?.dataset.testid ?? '',
      rightClass: children[1]?.className ?? '',
    }
  })
  expect(split.leftTestId).toBe('daily-issues-chart-panel')
  expect(split.rightClass).toContain('daily-issues-list')
  if (page.viewportSize() && page.viewportSize()!.width > 1180) {
    expect(split.left).toBeGreaterThan(split.right * .9)
    expect(split.left).toBeLessThan(split.right * 1.1)
  }

  await page.getByRole('button', { name: /SK하이닉스/ }).click()
  await expect(page.getByTestId('daily-issues-chart-panel')).toContainText('SK하이닉스')
  await expect(page.locator('.daily-issues-daily-bar')).toHaveCount(5)
  await expect(page.locator('.daily-issues-candle-body')).toHaveCount(5)
  await expect(page.locator('.daily-issues-minute-bar')).toHaveCount(8)
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
  expect(labels.indexOf('국내 테마 흐름')).toBe(0)
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
  for (const label of ['국내 테마 흐름', '증시 자금', '미국 테마 흐름', '금일 이슈 정리', '시장 복기', '종목 퀴즈']) {
    const sizes = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }))
    expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.clientWidth + 1)
    await page.getByRole('button', { name: label }).click()
  }
  const sizes = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }))
  expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.clientWidth + 1)
})