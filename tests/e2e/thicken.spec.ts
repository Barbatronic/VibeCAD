import { expect, test } from '@playwright/test';
import { appState, buildPlateViaUi, expectVolume, openApp, PLATE_VOLUME } from './helpers';

/** Plaque 60 × 30 × 5 percée d'un trou Ø 6, décalée de d (le trou suit en sens inverse). */
const plate = (d: number) => (60 + 2 * d) * (30 + 2 * d) * (5 + 2 * d) - Math.PI * (3 - d) ** 2 * (5 + 2 * d);

test('épaissir : la plaque amincie de 0,2 mm pour du jeu, puis grossie de 1 mm à coins vifs', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);
  await expectVolume(page, PLATE_VOLUME);

  await page.getByRole('button', { name: 'Autres outils : arrondis, coques et retouches' }).click();
  await page.click('#tool-menu-thicken');
  await expect(page.locator('#draft-distance')).toHaveValue('0,2');
  await page.getByRole('group', { name: 'Sens' }).getByRole('button', { name: 'Amincir' }).click();
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, plate(-0.2));
  await expect(page.getByRole('list', { name: /Étapes de construction/ }).getByText(/amincie de 0,2 mm/)).toBeVisible();

  const history = page.getByRole('list', { name: /Étapes de construction/ });
  await history.locator('.feature-main', { hasText: 'Épaisseur 1' }).dblclick();
  await page.getByRole('group', { name: 'Sens' }).getByRole('button', { name: 'Grossir' }).click();
  await page.locator('#draft-distance').fill('1');
  await page.getByRole('group', { name: 'Coins' }).getByRole('button', { name: 'Vifs' }).click();
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, plate(1));
  expect(await appState(page, (s) => s.doc.parts[0].features.at(-1).params)).toEqual({ distance: 1, corners: 'sharp' });
});
