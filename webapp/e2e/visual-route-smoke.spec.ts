import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial', timeout: 300_000 });
const viewports = [1024, 1280, 1366, 1440, 1920, 2560] as const;

const routes = [
  ['dashboard', '/ui/app/#/laundry/dashboard'],
  ['overview', '/ui/app/#/laundry/statistics'],
  ['operations', '/ui/app/#/laundry/operations'],
  ['new-order', '/ui/app/#/laundry/new-order'],
  ['orders', '/ui/app/#/laundry/orders'],
  ['online-orders', '/ui/app/#/laundry/online-orders'],
  ['customers', '/ui/app/#/laundry/customers'],
  ['print-centre', '/ui/app/#/laundry/print-centre'],
  ['garment-tracking', '/ui/app/#/laundry/garment-tracking'],
  ['production-queue', '/ui/app/#/laundry/production-queue'],
  ['quality-claims', '/ui/app/#/laundry/quality-claims'],
  ['corrections', '/ui/app/#/laundry/corrections'],
  ['returns', '/ui/app/#/laundry/returns'],
  ['dispatch', '/ui/app/#/laundry/dispatch'],
  ['routes', '/ui/app/#/laundry/routes'],
  ['settlements', '/ui/app/#/laundry/settlements'],
  ['cash-closing', '/ui/app/#/laundry/cash-closing'],
  ['finance', '/ui/app/#/laundry/finance'],
  ['statutory', '/ui/app/#/laundry/finance/statutory'],
  ['expenses', '/ui/app/#/laundry/expenses'],
  ['packages', '/ui/app/#/laundry/packages'],
  ['people-payroll', '/ui/app/#/laundry/management'],
  ['finance-setup', '/ui/app/#/laundry/finance-setup'],
  ['sync-status', '/ui/app/#/laundry/sync-status'],
  ['reports', '/ui/app/#/laundry/reports'],
  ['invoice-report', '/ui/app/#/laundry/reports/invoice'],
  ['customer-report', '/ui/app/#/laundry/reports/customer'],
  ['catalogue', '/ui/app/#/laundry/catalogue'],
  ['import-prices', '/ui/app/#/laundry/import-prices'],
  ['import-customers', '/ui/app/#/laundry/import-customers'],
  ['import-catalogue', '/ui/app/#/laundry/import-catalogue'],
  ['settings', '/ui/app/#/laundry/settings'],
] as const;

async function createDisposableWorkspace(page: Page) {
  await page.goto('/ui/app/');
  const setupHeading = page.getByRole('heading', { name: 'Set up your workspace' });
  if (await setupHeading.isVisible()) {
    await page.getByRole('button', { name: /Production workspace/ }).click();
    await page.getByRole('textbox', { name: 'Business name' }).fill('Visual Route Audit');
    await page.getByRole('textbox', { name: 'Business phone' }).fill('9000000022');
    await page.getByRole('textbox', { name: 'Business email' }).fill('visual-route-audit@example.invalid');
    await page.getByRole('textbox', { name: 'Store address' }).fill('Disposable visual route workspace');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('textbox', { name: 'Owner first name' }).fill('Visual');
    await page.getByRole('textbox', { name: 'Owner last name' }).fill('Auditor');
    await page.getByRole('textbox', { name: 'Username' }).fill(`visual.routes.${Date.now()}`);
    await page.getByRole('textbox', { name: /Secure password/ }).fill('VisualRoutePassword!2026');
    await page.getByRole('textbox', { name: 'Confirm password' }).fill('VisualRoutePassword!2026');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Finish secure setup' }).click();
  } else {
    await expect(page.getByText('Demo access')).toBeVisible();
    await page.getByRole('button', { name: 'Sign in' }).click();
  }
  await expect(page.locator('aside').first()).toBeVisible();
}

async function settleForVisualReview(page: Page) {
  await expect(page.locator('[data-testid="page-loading"]')).toHaveCount(0, { timeout: 30_000 });
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
    document.getAnimations().forEach((animation) => {
      const endTime = animation.effect?.getComputedTiming().endTime;
      if (typeof endTime === 'number' && Number.isFinite(endTime)) animation.finish();
    });
  });
}

test('every major operator route renders a visual authenticated shell', async ({ page }, testInfo) => {
  await createDisposableWorkspace(page);
  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    for (const [name, route] of routes) {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('aside').first()).toBeVisible();
      await expect(page.locator('body')).not.toContainText('Application error');
      await expect(page.locator('body')).not.toContainText('Cannot read properties');
      await settleForVisualReview(page);
      await testInfo.attach(`route-${width}-${name}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      });
    }
  }
});
