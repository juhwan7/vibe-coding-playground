import { expect, test } from '@playwright/test'

test('stock quiz renders and accepts an answer', async ({ page }, testInfo) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /이 종목, 무슨 회사일까/ })).toBeVisible()
  await expect(page.getByTestId('question-card')).toContainText('삼성전자')

  const choices = page.getByRole('button').filter({ hasNotText: /다음 문제|결과 보기|다시 도전하기/ })
  await expect(choices).toHaveCount(4)
  await choices.nth(1).click()
  await expect(page.getByText('정답입니다.')).toBeVisible()
  await expect(page.getByRole('button', { name: '다음 문제' })).toBeVisible()

  await page.screenshot({
    path: testInfo.outputPath('stock-quiz.png'),
    fullPage: true,
  })
})

test('page has no horizontal overflow', async ({ page }) => {
  await page.goto('/')
  const sizes = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.clientWidth + 1)
})
