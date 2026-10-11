import { expect, test } from '@playwright/test';
import { appState, buildPlateViaUi, expectVolume, openApp, PLATE_VOLUME, worldToScreen } from './helpers';

test('frise de l’historique : revenir après l’extrusion, y insérer un chanfrein, revenir à la fin', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);
  const timeline = page.getByRole('group', { name: /Frise de l’historique/ });
  await expect(timeline).toBeVisible();

  // Retour après « Extrusion 1 » : la plaque n'a plus de trou.
  await timeline.getByRole('button', { name: 'Extrusion 1' }).click();
  await expectVolume(page, 9000);
  await expect(timeline.getByRole('slider')).toHaveAttribute('aria-valuenow', '2');
  const history = page.getByRole('list', { name: /Étapes de construction/ });
  await expect(history.getByText('Non calculée')).toHaveCount(2);
  await page.screenshot({ path: 'tests/output/e2e-frise.png' });

  // Une arête choisie puis Chanfrein : l'étape s'insère à la barre, avant le trou.
  await page.waitForTimeout(300);
  const edge = await worldToScreen(page, 30, 0, 5);
  await page.mouse.click(edge.x, edge.y);
  await expect.poll(() => appState(page, (s) => s.selection?.kind)).toBe('edge');
  await page.getByRole('button', { name: 'Autres outils : arrondis, chanfreins, coques et dépouilles' }).click();
  await page.click('#tool-menu-chamfer');
  await page.locator('#draft-size').fill('2');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, 9000 - 60 * 2);
  expect(await appState(page, (s) => s.doc.parts[0].features.map((f: any) => f.name))).toEqual(['Esquisse 1', 'Extrusion 1', 'Chanfrein 1', 'Esquisse 2', 'Poche 1']);
  await expect(timeline.getByRole('slider')).toHaveAttribute('aria-valuenow', '3');

  // Au clavier : flèche gauche, puis Fin.
  await timeline.getByRole('slider').focus();
  await page.keyboard.press('ArrowLeft');
  await expectVolume(page, 9000);
  await page.keyboard.press('End');
  await expectVolume(page, PLATE_VOLUME - 60 * 2);
  await expect(history.getByText('Non calculée')).toHaveCount(0);
});
