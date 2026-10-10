import { expect, test } from '@playwright/test';
import { buildPlateViaUi, openApp } from './helpers';

test('centre de gravité : affiché sous le volume, symbole dans la vue à la demande', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);
  await expect(page.locator('.part-figures')).toContainText('Masse en PLA');
  const box = page.getByLabel(/Centre de gravité :/);
  await expect(box).toBeVisible();
  await expect(page.locator('.vp-centroid')).toHaveCount(0);
  await box.check();
  await expect(page.locator('.vp-centroid')).toHaveCount(1);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tests/output/e2e-centre-gravite.png' });
  await box.uncheck();
  await expect(page.locator('.vp-centroid')).toHaveCount(0);
});
