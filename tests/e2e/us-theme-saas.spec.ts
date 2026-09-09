import { expect, test } from '@playwright/test'

test('미국 테마 흐름은 ETF를 뺀 TOP50과 5개 고정 테마 및 정규장/애프터 분리 화면을 표시한다', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.getByRole('button', { name: '미국 테마 흐름' }).click()

  await expect(page.getByTestId('us-session-compare')).toBeVisible()
  await expect(page.getByTestId('us-theme-strength-board')).toBeVisible()
  await expect(page.getByTestId('us-market-pulse')).toBeVisible()
  await expect(page.getByText('US MARKET PULSE')).toBeVisible()
  await expect(page.getByText('현재 미국 시장 주도 테마 5')).toBeVisible()
  await expect(page.getByText('ETF/ETN 제외 · 개별주 TOP50')).toBeVisible()
  await expect(page.getByText('5개 고정 · 거래대금 합계 순')).toBeVisible()
  await expect(page.getByText('09:30~16:00 ET만 · 애프터 제외')).toBeVisible()
  await expect(page.getByText(/실제 30초 현재가 샘플 \+ 과거 실제 1분봉 · 90초 추세 완화/).first()).toBeVisible()
  await expect(page.getByRole('heading', { name: '정규장 거래대금 TOP50 · 개별주만' })).toBeVisible()
  await expect(page.getByTestId('us-top100-ranking')).toBeVisible()
  await expect(page.getByText('LIVE MARKET PULSE')).toHaveCount(0)
  await expect(page.locator('.theme-saas-summary-bar')).toHaveCount(1)

  await page.screenshot({ path: testInfo.outputPath('us-theme-top50-session-split-dashboard.png'), fullPage: true })
})