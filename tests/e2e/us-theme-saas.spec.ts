import { expect, test } from '@playwright/test'

test('미국 테마 흐름은 미국 전용 SaaS 요약을 표시하고 국내 보조 UI를 섞지 않는다', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.getByRole('button', { name: '미국 테마 흐름' }).click()

  await expect(page.getByTestId('us-theme-strength-board')).toBeVisible()
  await expect(page.getByTestId('us-market-pulse')).toBeVisible()
  await expect(page.getByText('US MARKET PULSE')).toBeVisible()
  await expect(page.getByText('현재 미국 시장 주도 테마')).toBeVisible()
  await expect(page.getByText('상승 종목 확산도')).toBeVisible()
  await expect(page.getByTestId('us-top100-ranking')).toBeVisible()
  await expect(page.getByText('LIVE MARKET PULSE')).toHaveCount(0)
  await expect(page.locator('.theme-saas-summary-bar')).toHaveCount(1)

  await page.screenshot({ path: testInfo.outputPath('us-theme-saas-dashboard.png'), fullPage: true })
})
