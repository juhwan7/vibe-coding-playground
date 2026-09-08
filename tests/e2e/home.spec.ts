import { expect, test } from '@playwright/test'

test('domestic liquidity dashboard is the first page', async ({ page }, testInfo) => {
  await page.goto('/')
  await expect(page.getByTestId('liquidity-dashboard')).toBeVisible()
  await expect(page.getByRole('heading', { name: '국내 증시 자금 상태' })).toBeVisible()
  await expect(page.getByText('TOP100 누적 거래대금', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('heading', { name: '증시 주변자금 · 대기자금 · 레버리지' })).toBeVisible()
  await expect(page.getByText('투자자예탁금', { exact: true })).toBeVisible()
  await expect(page.getByText('신용융자 잔고', { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('liquidity-dashboard.png'), fullPage: true })
})

test('theme flow board and top100 rail render', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.getByRole('button', { name: '테마 흐름' }).click()
  await expect(page.getByTestId('theme-strength-board')).toBeVisible()
  await expect(page.getByRole('heading', { name: /테마 강도 비교/ })).toBeVisible()
  await expect(page.getByText('TOP50 내 3종+')).toBeVisible()
  await expect(page.getByText(/3분 평균 \+ 1시간 눈금/)).toBeVisible()
  await expect(page.getByTestId('top100-ranking')).toBeVisible()
  await expect(page.getByRole('heading', { name: '거래대금 TOP100' })).toBeVisible()

  const details = page.locator('.deep-market-details')
  await details.locator(':scope > summary').click()
  await expect(page.getByTestId('moneyflow-dashboard')).toBeVisible()
  await expect(page.getByRole('heading', { name: '한국 시장 전체 Heatmap' })).toBeVisible()

  await page.screenshot({ path: testInfo.outputPath('theme-flow-dashboard.png'), fullPage: true })
})

test('stock quiz remains available from top navigation', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '종목 퀴즈' }).click()
  await expect(page.getByRole('heading', { name: /이 종목, 무슨 회사일까/ })).toBeVisible()
  await expect(page.getByTestId('question-card')).toContainText('삼성전자')

  const choices = page.locator('.choice-card')
  await expect(choices).toHaveCount(4)
  await choices.nth(1).click()
  await expect(page.getByText('정답입니다.')).toBeVisible()
})

test('pages have no horizontal overflow', async ({ page }) => {
  await page.goto('/')
  let sizes = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }))
  expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.clientWidth + 1)
  await page.getByRole('button', { name: '테마 흐름' }).click()
  sizes = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }))
  expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.clientWidth + 1)
})
