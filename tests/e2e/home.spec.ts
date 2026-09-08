import { expect, test } from '@playwright/test'

test('home renders and the 3D card exists', async ({ page }, testInfo) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /말로 만들고/ })).toBeVisible()
  await expect(page.getByTestId('tilt-card')).toBeVisible()

  await page.screenshot({
    path: testInfo.outputPath('home.png'),
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
