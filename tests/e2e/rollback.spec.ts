import { expect, test } from '@playwright/test';
import { appState, buildPlateViaUi, expectVolume, openApp, PLATE_VOLUME, worldToScreen, clickTool } from './helpers';

test('barre de retour de l’historique : revenir après l’extrusion, y insérer un chanfrein, revenir à la fin', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);
  const bar = page.getByRole('slider', { name: 'Barre de retour' });
  await expect(bar).toBeVisible();

  // Retour après « Extrusion 1 » (au clavier : début, puis deux étapes) : la plaque n'a plus de trou.
  // La barre change de place dans la liste à chaque touche : on la reprend avant la suivante.
  for (const key of ['Home', 'ArrowDown', 'ArrowDown']) {
    await bar.focus();
    await page.keyboard.press(key);
  }
  await expectVolume(page, 9000);
  await expect(bar).toHaveAttribute('aria-valuenow', '2');
  const history = page.getByRole('list', { name: /Étapes de construction/ });
  await expect(history.getByText('Non calculée', { exact: true })).toHaveCount(2);
  await page.screenshot({ path: 'tests/output/e2e-frise.png' });

  // Une arête choisie puis Chanfrein : l'étape s'insère à la barre, avant le trou.
  await page.waitForTimeout(300);
  const edge = await worldToScreen(page, 30, 0, 5);
  await page.mouse.click(edge.x, edge.y);
  await expect.poll(() => appState(page, (s) => s.selection?.kind)).toBe('edge');
  await clickTool(page, 'tool-chamfer');
  await page.locator('#draft-size').fill('2');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, 9000 - 60 * 2);
  expect(await appState(page, (s) => s.doc.parts[0].features.map((f: any) => f.name))).toEqual(['Esquisse 1', 'Extrusion 1', 'Chanfrein 1', 'Esquisse 2', 'Poche 1']);
  await expect(bar).toHaveAttribute('aria-valuenow', '3');

  // Au clavier : une étape plus haut, puis Fin.
  await bar.focus();
  await page.keyboard.press('ArrowUp');
  await expectVolume(page, 9000);
  await bar.focus();
  await page.keyboard.press('End');
  await expectVolume(page, PLATE_VOLUME - 60 * 2);
  await expect(history.getByText('Non calculée', { exact: true })).toHaveCount(0);
});
