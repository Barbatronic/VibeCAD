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
  // Le bouton « ƒ » ouvre la liste de tous les paramètres ; ↓ puis Entrée insère le second.
  await page.locator('#draft-distance').fill('');
  await page.getByRole('button', { name: 'Insérer un paramètre du projet' }).first().click();
  await expect(page.getByRole('listbox', { name: 'Paramètres du projet' }).getByRole('option')).toHaveText([/ep/, /largeur/]);
  await page.locator('#draft-distance').press('ArrowDown');
  await page.locator('#draft-distance').press('ArrowUp');
  await page.locator('#draft-distance').press('Enter');
  await expect(page.locator('#draft-distance')).toHaveValue('ep');
  await page.locator('#draft-distance').pressSequentially('*2');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, (1800 - HOLE) * 10);

  // La cote de 60 mm devient « largeur ».
  await history.locator('.feature-main', { hasText: 'Esquisse 1' }).dblclick();
  await expect.poll(() => appState(page, (s) => s.mode.kind)).toBe('sketch');
  await page.waitForTimeout(450);
  await page.locator('.vp-dim', { hasText: '60 mm' }).dblclick();
  const editor = page.getByRole('dialog', { name: 'Modifier la cote' });
  // Le début du nom (casse ignorée) ouvre la liste, triée : « largeur » d'abord.
  const field = editor.getByLabel('Valeur de la cote en millimètres');
  await field.fill('');
  await field.pressSequentially('LAR');
  const list = page.getByRole('listbox', { name: 'Paramètres du projet' });
  await expect(list.getByRole('option').first()).toHaveText(/largeur\s*= 60/);
  await page.screenshot({ path: 'tests/output/e2e-parametres-liste.png' });
  await field.press('Enter');
  await expect(field).toHaveValue('largeur');
  await expect(list).toBeHidden();
  await field.press('Enter');
  await expect(editor).toBeHidden();
  // La cote liée au paramètre change de couleur et porte un « ƒ ».
  const linked = page.locator('.vp-dim.is-param');
  await expect(linked).toHaveCount(1);
  await expect(linked).toHaveText('60 mm');
  expect(await linked.evaluate((el) => getComputedStyle(el, '::before').content)).toBe('"ƒ"');
  await page.keyboard.press('Space');
  await expect(linked).not.toHaveClass(/is-selected/);
  expect(await linked.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(14, 116, 144)');
  await page.screenshot({ path: 'tests/output/e2e-parametres-cote.png' });
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
