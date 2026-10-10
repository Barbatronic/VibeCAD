import { expect, test } from '@playwright/test';
import { appState, buildPlateViaUi, expectVolume, openApp, PLATE_VOLUME, worldToScreen } from './helpers';

test('congé sur des arêtes choisies à la souris, avec aperçu', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);
  await page.waitForTimeout(400);

  // Sélection de l'arête supérieure avant (y = 0, z = 5) puis outil Congé.
  const edge = await worldToScreen(page, 30, 0, 5);
  await page.mouse.click(edge.x, edge.y);
  await expect.poll(() => appState(page, (s) => s.selection?.kind)).toBe('edge');
  await page.click('#tool-fillet');
  await expect(page.getByText('1 arête', { exact: true })).toBeVisible();
  await page.locator('#draft-size').fill('2');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.screenshot({ path: 'tests/output/e2e-conge-apercu.png' });

  // Ajout d'une seconde arête (supérieure arrière, y = 30) en cliquant dans l'aperçu.
  const back = await worldToScreen(page, 40, 30, 5);
  await page.mouse.click(back.x, back.y);
  await expect(page.getByText('2 arêtes', { exact: true })).toBeVisible();
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, PLATE_VOLUME - 2 * 60 * (4 - Math.PI));
  const history = page.getByRole('list', { name: /Étapes de construction/ });
  await expect(history.locator('.feature-main', { hasText: 'Congé 1' })).toBeVisible();
  await page.screenshot({ path: 'tests/output/e2e-conge.png' });
});
