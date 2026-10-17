import { expect, test } from '@playwright/test';
import { appState, buildPlateViaUi, expectVolume, openApp, clickTool } from './helpers';

const PLATE = 9000 - Math.PI * 9 * 5;

test('symétrie : reflet de toute la pièce par rapport à YZ, puis à XY', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);
  await expectVolume(page, PLATE);

  await clickTool(page, 'tool-mirror');
  await expect(page.getByRole('group', { name: 'Copier' }).getByRole('button', { name: 'Toute la pièce' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, 2 * PLATE);
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'tests/output/e2e-symetrie.png' });
  // Le bouton du groupe montre maintenant la symétrie (dernier outil utilisé).
  await expect(page.locator('#tool-mirror')).toBeVisible();

  const history = page.getByRole('list', { name: /Étapes de construction/ });
  await history.locator('.feature-main', { hasText: 'Symétrie 1' }).dblclick();
  await page.getByRole('group', { name: 'Plan de symétrie (le miroir)' }).getByRole('button', { name: 'XY' }).click();
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, 2 * PLATE);
  expect(await appState(page, (s) => s.doc.parts[0].features.at(-1).params.plane)).toEqual({ kind: 'plane', plane: 'XY' });
});
