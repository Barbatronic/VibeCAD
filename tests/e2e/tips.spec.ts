import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

test('bulles d’explication : Java explique l’outil survolé, désactivables dans l’Aide', async ({ page }) => {
  await openApp(page);
  const tip = page.locator('.tip');
  await page.hover('#tool-extrude');
  await expect(tip).toBeVisible();
  await expect(tip.locator('.tip-title')).toHaveText('Extrusion');
  await expect(tip).toContainText(/donner une épaisseur/i);
  await expect(tip.locator('.tip-cat')).toBeVisible();
  // Pas de doublon avec l'info-bulle du navigateur pendant l'affichage.
  await expect(page.locator('#tool-extrude')).not.toHaveAttribute('title');
  await page.screenshot({ path: 'tests/output/e2e-bulle-java.png' });
  await page.mouse.move(700, 500);
  await expect(tip).toHaveCount(0);
  await expect(page.locator('#tool-extrude')).toHaveAttribute('title', /épaisseur/);

  // Désactivées : retour aux info-bulles simples.
  await page.getByRole('button', { name: 'Aide' }).click();
  await page.getByRole('checkbox', { name: /Bulles d’explication de Java/ }).uncheck();
  await page.keyboard.press('Escape');
  await page.hover('#tool-pocket');
  await page.waitForTimeout(900);
  await expect(tip).toHaveCount(0);
  await expect(page.locator('#tool-pocket')).toHaveAttribute('title', /matière/);
});
