import { expect, test } from '@playwright/test';
import { appState, buildPlateViaUi, expectVolume, openApp, PLATE_VOLUME } from './helpers';

const HOLE = Math.PI * 9;

test('paramètres : une épaisseur et une largeur nommées pilotent l’extrusion et la cote d’esquisse', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);
  await expectVolume(page, PLATE_VOLUME);

  // Deux paramètres : ep = 5, largeur = 60.
  const section = page.locator('.params-section');
  const addParameter = page.getByRole('button', { name: 'Ajouter un paramètre' });
  const setParameter = async (index: number, name: string, expression: string) => {
    const name$ = page.getByLabel(`Nom du paramètre ${index}`);
    await name$.fill(name);
    await name$.press('Enter');
    const expr = page.getByLabel(`Valeur ou équation de « ${name} »`);
    await expr.fill(expression);
    await expr.press('Enter');
  };
  await addParameter.click();
  await setParameter(1, 'ep', '5');
  await addParameter.click();
  await setParameter(2, 'largeur', 'ep*12');
  await expect(section.locator('.param-value')).toHaveText('= 60');

  // L'extrusion prend « ep*2 » (10 mm).
  const history = page.getByRole('list', { name: /Étapes de construction/ });
  await history.locator('.feature-main', { hasText: 'Extrusion 1' }).dblclick();
  await page.locator('#draft-distance').fill('ep*2');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, (1800 - HOLE) * 10);

  // La cote de 60 mm devient « largeur ».
  await history.locator('.feature-main', { hasText: 'Esquisse 1' }).dblclick();
  await expect.poll(() => appState(page, (s) => s.mode.kind)).toBe('sketch');
  await page.waitForTimeout(450);
  await page.locator('.vp-dim', { hasText: '60 mm' }).dblclick();
  const editor = page.getByRole('dialog', { name: 'Modifier la cote' });
  await editor.getByLabel('Valeur de la cote en millimètres').fill('largeur');
  await editor.getByLabel('Valeur de la cote en millimètres').press('Enter');
  await expect(editor).toBeHidden();
  await page.getByRole('button', { name: 'Terminer l’esquisse' }).click();
  await expectVolume(page, (1800 - HOLE) * 10);

  // Changer « ep » met à jour l'épaisseur et la largeur (ep*12) : 72 × 30 × 6.
  await page.getByLabel('Valeur ou équation de « ep »').fill('6');
  await page.getByLabel('Valeur ou équation de « ep »').press('Enter');
  await expectVolume(page, (72 * 30 - HOLE) * 12);

  // Renommer suit dans les équations ; un paramètre utilisé ne peut pas être supprimé.
  await setParameter(1, 'epaisseur', '6');
  await expect(page.getByLabel('Valeur ou équation de « largeur »')).toHaveValue('epaisseur*12');
  await page.getByRole('button', { name: 'Supprimer le paramètre « epaisseur »' }).click();
  await expect(page.getByText(/« epaisseur » est utilisé par/)).toBeVisible();
  expect(await appState(page, (s) => s.doc.parts[0].features.find((f: any) => f.type === 'extrude').expressions)).toEqual({ distance: 'epaisseur*2' });

  // En rouvrant l'extrusion, le champ montre l'équation.
  await history.locator('.feature-main', { hasText: 'Extrusion 1' }).dblclick();
  await expect(page.locator('#draft-distance')).toHaveValue('epaisseur*2');
  await page.keyboard.press('Escape');
  await page.screenshot({ path: 'tests/output/e2e-parametres.png' });
});
