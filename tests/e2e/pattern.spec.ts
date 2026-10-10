import { expect, test } from '@playwright/test';
import { appState, buildPlateViaUi, expectVolume, openApp } from './helpers';

const HOLE = Math.PI * 9 * 5;

test('répétition : le trou refait 3 fois en ligne, puis en grille 3 × 2', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);
  await expectVolume(page, 9000 - HOLE);

  await page.click('#tool-pattern');
  // L'étape proposée est la dernière poche (le trou).
  await expect(page.locator('#draft-source option:checked')).toHaveText('Poche 1');
  await page.locator('#draft-count').fill('3');
  await page.locator('#draft-spacing').fill('15');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, 9000 - 3 * HOLE);
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'tests/output/e2e-repetition.png' });

  // Modifier : ajouter une deuxième direction (Y, 10 mm).
  const history = page.getByRole('list', { name: /Étapes de construction/ });
  await history.locator('.feature-main', { hasText: 'Répétition 1' }).dblclick();
  await page.getByText('Deuxième direction (grille)').click();
  await page.locator('#draft-spacing2').fill('10');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, 9000 - 6 * HOLE);
  expect(await appState(page, (s) => s.doc.parts[0].features.at(-1).params.second)).toMatchObject({ count: 2, spacing: 10, axis: { kind: 'axis', axis: 'Y' } });

  // Annuler revient à la ligne de trois trous.
  await page.keyboard.press('Control+z');
  await expectVolume(page, 9000 - 3 * HOLE);
});
