import { expect, test, type Page } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

async function createEmptyWorkspace(page: Page) {
  await page.goto('/ui/app/')
  await expect(page.getByRole('heading', { name: 'Set up your workspace' })).toBeVisible()
  await page.getByRole('button', { name: /Production workspace/ }).click()
  await page.getByRole('textbox', { name: 'Business name' }).fill('Empty State Laundry')
  await page.getByRole('textbox', { name: 'Business phone' }).fill('9000000044')
  await page.getByRole('textbox', { name: 'Business email' }).fill('empty-state@example.invalid')
  await page.getByRole('textbox', { name: 'Store address' }).fill('Disposable empty-state workspace')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('textbox', { name: 'Owner first name' }).fill('Empty')
  await page.getByRole('textbox', { name: 'Owner last name' }).fill('State')
  await page.getByRole('textbox', { name: 'Username' }).fill(`empty.state.${Date.now()}`)
  await page.getByRole('textbox', { name: /Secure password/ }).fill('EmptyStatePassword!2026')
  await page.getByRole('textbox', { name: 'Confirm password' }).fill('EmptyStatePassword!2026')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Finish secure setup' }).click()
  await expect(page.locator('aside').first()).toBeVisible()
}

const emptySurfaces = [
  ['orders?view=customers', 'Store orders & customers'],
  ['orders', 'Store orders & customers'],
  ['online-orders', 'Online orders'],
  ['production-queue', 'Work queue'],
  ['quality-claims', 'Claims & exceptions'],
  ['corrections', 'Correction documents'],
  ['returns', 'Returns & refund requests'],
  ['dispatch', 'Delivery operations'],
  ['settlements', 'Rider settlements'],
  ['expenses', 'Store expense'],
] as const

test('a fresh production workspace explains every core empty operational surface', async ({ page }) => {
  await createEmptyWorkspace(page)
  for (const [route, heading] of emptySurfaces) {
    await page.goto(`/ui/app/#/laundry/${route}`, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('main').getByRole('heading', { name: heading })).toBeVisible()
    await expect(page.locator('body')).not.toContainText('Application error')
    await expect(page.locator('body')).not.toContainText('Cannot read properties')
    await expect(page.locator('main img[alt=""]').first()).toBeVisible()
  }
})
