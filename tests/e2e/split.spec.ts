import { expect, test } from '@playwright/test';
import { appState, buildPlateViaUi, expectVolume, openApp, PLATE_VOLUME, worldToScreen } from './helpers';

test('découpe : couper la plaque à mi-épaisseur, puis par une face, garder les deux morceaux', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);
  await expectVolume(page, PLATE_VOLUME);

  // Plan XY proposé à mi-hauteur : on garde le bas.
  await page.getByRole('button', { name: /Autres outils : répétitions, symétries/ }).click();
  await page.click('#tool-menu-split');
  await expect(page.locator('#draft-offset')).toHaveValue('2,5');
  await expect(page.getByRole('group', { name: 'Garder' }).getByRole('button', { name: 'Le bas' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, PLATE_VOLUME / 2);

  // Modifier : le plan devient parallèle à la face avant (cliquée), placé à mi-profondeur.
  await page.evaluate(() => (window as any).vibecad.controller.fitAll());
  await page.waitForTimeout(600);
  const history = page.getByRole('list', { name: /Étapes de construction/ });
  await history.locator('.feature-main', { hasText: 'Découpe 1' }).dblclick();
  await page.getByRole('group', { name: 'Plan de découpe' }).getByRole('button', { name: 'Face…' }).click();
  await expect(page.getByText(/Cliquez dans la vue 3D une face plane/)).toBeVisible();
  // La vue doit être immobile (fin du recadrage), sinon le clic tombe à côté sur une machine chargée.
  await expect.poll(() => page.evaluate(() => (window as any).vibecad.controller.viewport.rig.animating)).toBe(false);
  const front = await worldToScreen(page, 45, 0, 1);
  await page.mouse.click(front.x, front.y);
  await expect(page.locator('#draft-offset')).toHaveValue('-15');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  // Les deux morceaux, écartés de 10 mm.
  await page.getByRole('group', { name: 'Garder' }).getByRole('button', { name: 'Les deux' }).click();
  await expect(page.locator('#draft-gap')).toHaveValue('10');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, PLATE_VOLUME);
  const result = await appState(page, (s) => {
    const r = s.display[s.doc.parts[0].id].result;
    return { solids: r.analysis.solidCount, minY: r.analysis.bbox.min.y, plane: s.doc.parts[0].features.at(-1).params.plane.kind };
  });
  expect(result).toEqual({ solids: 2, minY: -10, plane: 'face' });
  await page.evaluate(() => (window as any).vibecad.controller.fitAll());
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'tests/output/e2e-decoupe.png' });
});
