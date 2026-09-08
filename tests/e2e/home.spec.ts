import { expect, test } from '@playwright/test'

test('money flow dashboard renders and drills into sectors', async ({ page }, testInfo) => {
  await page.goto('/')
  await expect(page.getByTestId('moneyflow-dashboard')).toBeVisible()
  await expect(page.getByRole('heading', { name: '한국 시장 전체 Heatmap' })).toBeVisible()
  await expect(page.getByText('Money Flow', { exact: false }).first()).toBeVisible()

  await page.getByRole('button', { name: /원전·전력/ }).first().click()
  await expect(page.getByRole('heading', { name: /원전·전력 → 세부테마 → 종목/ })).toBeVisible()
  await expect(page.getByText('두산에너빌리티')).toBeVisible()

  const replay = page.getByRole('slider', { name: '시장 시간 재생' })
  await replay.fill('180')
  await expect(page.getByText('12:00').first()).toBeVisible()

  await page.screenshot({ path: testInfo.outputPath('money-flow-dashboard.png'), fullPage: true })
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

test('page has no horizontal overflow', async ({ page }) => {
  await page.goto('/')
  const sizes = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.clientWidth + 1)
})
