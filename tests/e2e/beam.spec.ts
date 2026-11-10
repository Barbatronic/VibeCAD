import { expect, test } from '@playwright/test';
import { clickTool, openApp } from './helpers';

test('profilé : un 20 × 40 V-slot de 300 mm depuis le ruban', async ({ page }) => {
  await openApp(page);
  await clickTool(page, 'tool-beam');
  await page.locator('#draft-beam-size').selectOption('2040');
  await page.locator('#draft-length').fill('300');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.screenshot({ path: 'tests/output/e2e-profile.png' });
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  // Section 20 × 40 rainurée, sur 300 mm.
  await expect
    .poll(() => page.evaluate(() => (window as any).vibecad.controller.state.display[(window as any).vibecad.controller.state.doc.parts[0].id]?.result.analysis?.bbox))
    .toMatchObject({ min: { z: 0 }, max: { z: 300 } });
});
