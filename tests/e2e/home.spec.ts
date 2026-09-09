import { expect, test } from '@playwright/test'

test('domestic liquidity dashboard is the first page and light theme is default', async ({ page }, testInfo) => {
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.getByTestId('liquidity-dashboard')).toBeVisible()
  await expect(page.getByRole('heading', { name: '국내 증시 자금 상태' })).toBeVisible()
  await expect(page.getByRole('button', { name: '시장 데이터 수동 새로고침' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('liquidity-dashboard.png'), fullPage: true })
})

test('domestic theme flow uses four stabilized themes, market intelligence and an always-open detail dashboard', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.getByRole('button', { name: '국내 테마 흐름' }).click()

  await expect(page.getByTestId('market-intelligence')).toBeVisible()
  await expect(page.getByRole('heading', { name: /시장 상태 엔진/ })).toBeVisible()
  await expect(page.getByText(/원시값 기반/).first()).toBeVisible()

  await expect(page.getByTestId('feature-news')).toBeVisible()
  await expect(page.getByRole('heading', { name: '시황 요약' })).toBeVisible()
  await expect(page.getByText(/오늘 00:00 이후/)).toBeVisible()
  await expect(page.getByText(/시간당 최대 8건/)).toBeVisible()
  const timelineLayout = await page.getByTestId('feature-news-timeline').evaluate((node) => ({
    display: getComputedStyle(node).display,
    flow: getComputedStyle(node).gridAutoFlow,
  }))
  expect(timelineLayout.display).toBe('grid')
  expect(timelineLayout.flow).toBe('column')

  await expect(page.getByTestId('theme-strength-board')).toBeVisible()
  await expect(page.getByRole('heading', { name: /테마 강도 비교/ })).toBeVisible()
  await expect(page.getByText('개별주(STOCK)만')).toBeVisible()
  await expect(page.getByText(/4개 · 8% 또는 3회 확인 후 교체/)).toBeVisible()
  await expect(page.getByText(/평균 3분 선차트 · 자동 확대축/)).toBeVisible()
  await expect(page.getByText(/10초/).first()).toBeVisible()
  await expect(page.getByTestId('top100-ranking')).toBeVisible()
  await expect(page.getByRole('heading', { name: '거래대금 TOP100 · 개별주만' })).toBeVisible()

  await expect(page.getByTestId('moneyflow-dashboard')).toBeVisible()
  await expect(page.getByRole('heading', { name: '한국 시장 전체 Heatmap' })).toBeVisible()
  await expect(page.locator('.deep-market-details summary')).toHaveCount(0)

  for (const removed of [
    '시간대별 거래대금 · 최근 5거래일 동시간 비교',
    '수급 · 프로그램 · 선물',
    '1주 동시간 비교',
    '테마 순환 기록',
    '종목 거래대금 변화',
    '뉴스 · 동적 테마 분류',
  ]) {
    await expect(page.getByText(removed, { exact: true })).toHaveCount(0)
  }
  await expect(page.getByText(/세부테마 → 종목/)).toHaveCount(0)
  await expect(page.getByText(/08:00 → 20:00/)).toHaveCount(0)

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

test('stock quiz separates full KOSPI200 and KOSDAQ150 company-description pools', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '종목 퀴즈' }).click()
  await expect(page.getByTestId('index-quiz')).toBeVisible()
  await expect(page.getByRole('heading', { name: /어느 시장의 기업을 더 많이 알고 있을까/ })).toBeVisible()
  await expect(page.getByTestId('quiz-pool-kospi200')).toContainText('KOSPI 200')
  await expect(page.getByTestId('quiz-pool-kosdaq150')).toContainText('KOSDAQ 150')
  await page.getByTestId('quiz-pool-kospi200').click()
  await expect(page.locator('.index-quiz-choices button')).toHaveCount(4)
})

test('pages have no horizontal overflow', async ({ page }) => {
  await page.goto('/')
  for (const label of ['국내 테마 흐름', '미국 테마 흐름', '금일 이슈 정리', '종목 퀴즈']) {
    const sizes = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }))
    expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.clientWidth + 1)
    await page.getByRole('button', { name: label }).click()
  }
  const sizes = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }))
  expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.clientWidth + 1)
})
