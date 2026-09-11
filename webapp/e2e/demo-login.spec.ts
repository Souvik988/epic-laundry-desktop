import { expect, test } from '@playwright/test';

test('isolated demo workspace provides its documented seeded login', async ({ page }) => {
  await page.goto('/ui/app/');
  await expect(page.getByText('Demo access')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Username' })).toHaveValue('demo');
  await expect(page.getByRole('textbox', { name: 'Password' })).toHaveValue('DemoLaundry!2026');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /See the next move at a glance/ })).toBeVisible();
  await expect(page.getByText('Recent orders')).toBeVisible();
  await expect(page.getByText('Demo', { exact: false }).first()).toBeVisible();
});
