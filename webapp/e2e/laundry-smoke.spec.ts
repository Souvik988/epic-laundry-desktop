import { expect, test } from '@playwright/test';

test('operator can complete the core laundry desk journeys in a disposable workspace', async ({ page }) => {
  await page.goto('/ui/app/');
  await expect(page.getByRole('heading', { name: 'Set up your workspace' })).toBeVisible();

  await page.getByRole('button', { name: /Production workspace/ }).click();
  await page.getByRole('textbox', { name: 'Business name' }).fill('UI Audit Laundry');
  await page.getByRole('textbox', { name: 'Business phone' }).fill('9000000001');
  await page.getByRole('textbox', { name: 'Business email' }).fill('ui-audit@example.invalid');
  await page.getByRole('textbox', { name: 'Store address' }).fill('Disposable UI test workspace');
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByRole('textbox', { name: 'Owner first name' }).fill('UI');
  await page.getByRole('textbox', { name: 'Owner last name' }).fill('Auditor');
  await page.getByRole('textbox', { name: 'Username' }).fill(`ui.audit.${Date.now()}`);
  await page.getByRole('textbox', { name: /Secure password/ }).fill('UIAuditPassword!2026');
  await page.getByRole('textbox', { name: 'Confirm password' }).fill('UIAuditPassword!2026');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Finish secure setup' }).click();
  await expect(page.getByRole('heading', { name: /calm counter starts/ })).toBeVisible();
  const sidebarNav = page.locator('aside nav');
  await expect(sidebarNav.getByRole('button', { name: 'Counter' })).toBeVisible();
  await sidebarNav.getByRole('button', { name: 'Counter' }).click();
  await expect(sidebarNav.getByRole('link', { name: 'Order booking' })).toBeVisible();
  await sidebarNav.getByRole('button', { name: 'Production' }).click();
  await expect(sidebarNav.getByRole('link', { name: 'Garment tracking' })).toBeVisible();
  await sidebarNav.getByRole('button', { name: 'Management' }).click();
  await expect(sidebarNav.getByRole('link', { name: 'Store settings' })).toBeAttached();
  await sidebarNav.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(sidebarNav.getByRole('link', { name: 'Store settings' })).toBeVisible();

  await page.goto('/ui/app/#/laundry/print-centre');
  const order = page.getByRole('button', { name: /INV-\d+-\d+/ }).first();
  await expect(order).toBeVisible();
  const invoice = (await order.innerText()).match(/INV-\d+-\d+/)?.[0] || '';
  await order.click();
  await expect(page.getByRole('button', { name: /Garment tags \(\d+\)/ })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Opaque tag QR' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Select all' }).click();
  await expect(page.getByText(/\d+ selected/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Print selected' })).toBeVisible();
  const pdfPopupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  const pdfPopup = await pdfPopupPromise;
  await pdfPopup.waitForLoadState('domcontentloaded');
  await expect(pdfPopup.locator('body')).toContainText('Shoe pair');
  await pdfPopup.close();
  await expect(page.getByText('PDF saved from the same renderer used for preview.')).toBeVisible();

  await page.getByPlaceholder('Order, invoice, customer, tag').focus();
  await page.keyboard.type(invoice, { delay: 4 });
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/laundry\/orders\?order=/);
  await expect(page.getByText('Order work card')).toBeVisible();

  const tag = (await page.getByText(/ELT-\d{8}-\d{6}/).first().innerText()).trim();
  await page.goto('/ui/app/#/laundry/garment-tracking');
  await expect(page.getByRole('heading', { name: 'Garment tracking' })).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.type(tag, { delay: 4 });
  await page.keyboard.press('Enter');
  await expect(page.getByText('Scan recorded in the garment audit trail.')).toBeVisible();
  await page.getByRole('textbox', { name: 'Operator note' }).fill('UI reprint audit');
  const reprintPopupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Print again' }).click();
  const reprintPopup = await reprintPopupPromise;
  await reprintPopup.waitForLoadState('domcontentloaded');
  await reprintPopup.close();
  await expect(page.getByText(/Same tag printed again/)).toBeVisible();
  await page.getByRole('textbox', { name: 'Operator note' }).fill('UI replacement audit');
  const replacePopupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Replace tag' }).click();
  const replacePopup = await replacePopupPromise;
  await replacePopup.waitForLoadState('domcontentloaded');
  await replacePopup.close();
  await expect(page.getByText(/Tag replaced and the new active tag was printed/)).toBeVisible();

  await page.keyboard.press('Control+k');
  await expect(page.getByRole('textbox', { name: 'Command search' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Command search' }).fill('Demo');
  await expect(page.getByText('Workspace records')).toBeVisible();

  await page.keyboard.press('Escape');
  await page.goto('/ui/app/#/laundry/new-order');
  await expect(page.getByRole('heading', { name: 'Order & billing' })).toBeVisible();
  await page.getByRole('button', { name: 'Add' }).first().click();
  await page.getByPlaceholder('Customer name').fill('Journey Customer');
  await page.getByPlaceholder('Phone number').fill('9000000099');
  await page.getByRole('button', { name: 'Hold current order' }).click();
  await page.getByRole('button', { name: /Journey Customer · 1 item/ }).click();
  await expect(page.getByRole('button', { name: 'Book order' })).toBeEnabled();
  await page.keyboard.press('Control+Enter');
  await expect(page.getByText('Order booked')).toBeVisible();
  const journeyOrder = (await page.getByText(/LND-\d{2}-\d{5}/).last().innerText()).match(/LND-\d{2}-\d{5}/)?.[0] || '';
  const journeyTag = (await page.getByText(/ELT-\d{8}-\d{6}/).last().innerText()).match(/ELT-\d{8}-\d{6}/)?.[0] || '';
  await page.getByRole('button', { name: 'Close receipt' }).click();

  await page.goto('/ui/app/#/laundry/production-queue');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  const startButton = page.getByRole('button', { name: 'Start' }).first();
  if (await startButton.count()) {
    await startButton.click();
    await expect(page.getByText('In Progress').first()).toBeVisible();
  }

  await page.goto('/ui/app/#/laundry/quality-claims');
  await expect(page.getByRole('heading', { name: 'Claims & exceptions' })).toBeVisible();
  await page.getByPlaceholder('TAG-20260829-000001').fill(journeyTag);
  await page.getByPlaceholder('What did the operator observe?').fill('Journey test quality observation');
  await page.getByRole('button', { name: 'Open claim' }).click();
  await expect(page.getByText('Quality claim opened for supervisor review.')).toBeVisible();

  await page.goto(`/ui/app/#/laundry/orders?order=${encodeURIComponent(journeyOrder)}`);
  await expect(page.getByText('Order work card')).toBeVisible();
  await expect(page.getByText('Assembly safety · garment traceability')).toBeVisible();
  const amountInput = page.locator('aside label').filter({ hasText: 'Amount' }).locator('input');
  if (await amountInput.count() && await amountInput.isVisible()) {
    await page.locator('aside label').filter({ hasText: 'Method' }).locator('select').selectOption({ label: 'UPI' });
    await amountInput.fill('1');
    await page.getByRole('button', { name: 'Record collection' }).click();
    await expect(page.getByText(/Recorded|Paid|Collection/).first()).toBeVisible({ timeout: 10000 });
  }

  await page.goto('/ui/app/#/laundry/customers');
  await expect(page.getByRole('heading', { name: 'Customer directory' })).toBeVisible();
  await page.getByPlaceholder('Search name, mobile or invoice number').fill('Demo');
  await expect(page.getByText(/Demo/).first()).toBeVisible();

  await page.goto('/ui/app/#/laundry/reports');
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(page.getByText('Financial controls')).toBeVisible();

  await page.goto('/ui/app/#/laundry/routes');
  await expect(page.getByRole('heading', { name: 'Route runs' })).toBeVisible();
  await page.goto('/ui/app/#/laundry/cash-closing');
  await expect(page.getByRole('heading', { name: 'Cash closing' })).toBeVisible();
});
