import { expect, test } from '@playwright/test'

test('the desktop root opens the integrated Laundry Desk app', async ({ page }) => {
  await page.goto('/ui/', { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(/\/ui\/app\/$/)
  await expect(page.getByText('Demo access')).toBeVisible()
  await expect(page.locator('body')).not.toContainText('Epic BOS')

  const legacyRoutes = [
    ['/ui/index.html', '/laundry/dashboard'],
    ['/ui/pos.html', '/laundry/new-order'],
    ['/ui/invoice.html', '/laundry/print-centre'],
    ['/ui/invoices.html', '/laundry/print-centre'],
    ['/ui/crm.html', '/laundry/customers'],
    ['/ui/engage.html', '/laundry/customers'],
    ['/ui/inventory.html', '/laundry/catalogue'],
    ['/ui/buying.html', '/laundry/expenses'],
    ['/ui/purchases.html', '/laundry/expenses'],
    ['/ui/selling.html', '/laundry/orders'],
    ['/ui/manufacturing.html', '/laundry/production-queue'],
    ['/ui/accounting.html', '/laundry/finance'],
    ['/ui/banking.html', '/laundry/finance'],
    ['/ui/gst.html', '/laundry/finance/statutory'],
    ['/ui/returns.html', '/laundry/returns'],
    ['/ui/ops.html', '/laundry/operations'],
    ['/ui/compliance.html', '/laundry/quality-claims'],
    ['/ui/hr.html', '/laundry/management'],
    ['/ui/projects.html', '/laundry/operations'],
    ['/ui/assets.html', '/laundry/catalogue'],
    ['/ui/ai.html', '/laundry/dashboard'],
    ['/ui/multi-entity.html', '/laundry/settings'],
    ['/ui/migration.html', '/laundry/import-catalogue'],
    ['/ui/ecosystem.html', '/laundry/sync-status'],
    ['/ui/portal.html', '/laundry/customers'],
  ] as const
  for (const [legacyRoute, integratedRoute] of legacyRoutes) {
    await page.goto(legacyRoute, { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(new RegExp(`\\/ui\\/app\\/#${integratedRoute.replaceAll('/', '\\/')}$`))
    await expect(page.locator('body')).not.toContainText('Epic BOS')
  }
})
