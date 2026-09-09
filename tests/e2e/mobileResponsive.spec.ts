import { expect, test, type Page } from '@playwright/test'

async function expectNoPageOverflow(page: Page) {
  await expect.poll(async () => page.evaluate(() => ({
    viewport: window.innerWidth,
    html: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }))).toEqual({ viewport: 360, html: 360, body: 360 })
}

async function expectVisibleInsideViewport(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(-1)
  expect(box!.x + box!.width).toBeLessThanOrEqual(361)
}

test('360px 모바일에서 주요 화면이 잘리지 않고 상단 메뉴만 내부 스크롤된다', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto('/')

  const navScroller = page.locator('.global-nav > div')
  await expect(navScroller).toBeVisible()
  const navLayout = await navScroller.evaluate((node) => ({
    overflowX: getComputedStyle(node).overflowX,
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth,
  }))
  expect(navLayout.overflowX).toBe('auto')
  expect(navLayout.scrollWidth).toBeGreaterThanOrEqual(navLayout.clientWidth)

  await expect(page.getByTestId('theme-strength-board')).toBeVisible()
  await expectNoPageOverflow(page)
  await expectVisibleInsideViewport(page, '.market-workspace')
  await expectVisibleInsideViewport(page, '.theme-saas-summary-bar')
  await expectVisibleInsideViewport(page, '.top100-rail')
  await page.screenshot({ path: testInfo.outputPath('mobile-360-theme-flow.png'), fullPage: true })

  await page.getByRole('button', { name: '증시 자금' }).click()
  await expect(page.getByTestId('liquidity-dashboard')).toBeVisible()
  await expectNoPageOverflow(page)
  await expectVisibleInsideViewport(page, '.liquidity-page')

  await page.getByRole('button', { name: '미국 테마 흐름' }).click()
  await expect(page.getByTestId('us-theme-strength-board')).toBeVisible()
  await expectNoPageOverflow(page)
  await expectVisibleInsideViewport(page, '.us-theme-workspace')

  await page.getByRole('button', { name: '금일 이슈 정리' }).click()
  await expect(page.getByTestId('daily-issues')).toBeVisible()
  await expectNoPageOverflow(page)
  await expectVisibleInsideViewport(page, '.daily-issues-page')

  await page.getByRole('button', { name: '시장 복기' }).click()
  await expect(page.getByTestId('market-replay')).toBeVisible()
  await expectNoPageOverflow(page)
  await expectVisibleInsideViewport(page, '.market-replay')
  await page.screenshot({ path: testInfo.outputPath('mobile-360-market-replay.png'), fullPage: true })

  await page.getByRole('button', { name: '종목 퀴즈' }).click()
  await expect(page.getByTestId('index-quiz')).toBeVisible()
  await expectNoPageOverflow(page)
  await expectVisibleInsideViewport(page, '.index-quiz-shell')
  await expectVisibleInsideViewport(page, '.index-quiz-select')
})
