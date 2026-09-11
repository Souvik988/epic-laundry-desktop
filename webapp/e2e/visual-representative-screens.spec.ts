import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial', timeout: 180_000 });

const viewports = [1024, 1366, 1920] as const;
const routes = [
  ['dashboard', '/ui/app/#/laundry/dashboard'],
  ['overview', '/ui/app/#/laundry/statistics'],
  ['new-order', '/ui/app/#/laundry/new-order'],
  ['orders', '/ui/app/#/laundry/orders'],
  ['online-orders', '/ui/app/#/laundry/online-orders'],
  ['customers', '/ui/app/#/laundry/orders?view=customers'],
  ['finance', '/ui/app/#/laundry/finance'],
  ['statutory', '/ui/app/#/laundry/finance/statutory'],
  ['people-payroll', '/ui/app/#/laundry/management'],
  ['sync-status', '/ui/app/#/laundry/sync-status'],
  ['catalogue', '/ui/app/#/laundry/catalogue'],
  ['reports', '/ui/app/#/laundry/reports'],
  ['settings', '/ui/app/#/laundry/settings'],
] as const;
const visualReviewDir = join(process.cwd(), '..', 'demo-runtime', 'visual-review');
mkdirSync(visualReviewDir, { recursive: true });

async function signIntoDemo(page: Page) {
  await page.goto('/ui/app/');
  const demoAccess = page.getByText('Demo access');
  if (await demoAccess.isVisible()) {
    await page.getByRole('button', { name: 'Sign in' }).click();
  } else {
    await expect(page.locator('aside').first()).toBeVisible();
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

test('representative populated screens are captured for human visual review', async ({ page }) => {
  await signIntoDemo(page);
  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    for (const [name, route] of routes) {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('aside').first()).toBeVisible();
      await expect(page.locator('body')).not.toContainText('Application error');
      await settleForVisualReview(page);
      await page.screenshot({ path: join(visualReviewDir, `${name}-${width}.png`), fullPage: true });
    }
    await page.goto('/ui/app/#/laundry/orders?view=customers', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Store orders & customers' })).toBeVisible();
    const customerAction = page.getByRole('button', { name: 'Open profile' }).first();
    if (await customerAction.count()) {
      await customerAction.click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByText('Customer work card', { exact: true })).toBeVisible();
      await settleForVisualReview(page);
      await page.screenshot({ path: join(visualReviewDir, `customer-detail-${width}.png`), fullPage: true });
    }
  }
});
