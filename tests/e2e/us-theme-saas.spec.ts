import { expect, test } from '@playwright/test'

test('미국 테마 흐름은 ETF를 뺀 TOP50과 5개 고정 테마 및 30초 추세 차트를 표시한다', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.getByRole('button', { name: '미국 테마 흐름' }).click()

  await expect(page.getByTestId('us-theme-strength-board')).toBeVisible()
  await expect(page.getByTestId('us-market-pulse')).toBeVisible()
  await expect(page.getByText('US MARKET PULSE')).toBeVisible()
  await expect(page.getByText('현재 미국 시장 주도 테마 5')).toBeVisible()
  await expect(page.getByText('ETF/ETN 제외 · 개별주 TOP50')).toBeVisible()
  await expect(page.getByText('5개 고정 · 거래대금 합계 순')).toBeVisible()
  await expect(page.getByText('30초 실시간 · 90초 추세 · 과거 1분 백필')).toBeVisible()
  await expect(page.getByText('30초 실시간 · 90초 완화')).toBeVisible()
  await expect(page.getByRole('heading', { name: '미국 거래대금 TOP50 · 개별주만' })).toBeVisible()
  await expect(page.getByTestId('us-top100-ranking')).toBeVisible()
  await expect(page.getByText('LIVE MARKET PULSE')).toHaveCount(0)
  await expect(page.locator('.theme-saas-summary-bar')).toHaveCount(1)

  await page.screenshot({ path: testInfo.outputPath('us-theme-top50-five-30s-dashboard.png'), fullPage: true })
})
