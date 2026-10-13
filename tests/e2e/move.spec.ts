import { expect, test } from '@playwright/test';
import { appState, expectVolume, openApp } from './helpers';

const bbox = (page: import('@playwright/test').Page) => appState(page, (s) => s.display[s.doc.parts[0].id]?.result.analysis?.bbox);

test('déplacer : décaler puis faire pivoter la pièce d’un quart de tour', async ({ page }) => {
  await openApp(page);
  // Boîte 20 × 20 × 20 au coin de l'origine.
  await page.click('#tool-primitive');
  await page.locator('#draft-width').fill('40');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, 8000 * 2);

  await page.getByRole('button', { name: /Autres outils : répétitions, symétries/ }).click();
  await page.click('#tool-menu-move');
  await page.locator('#draft-tx').fill('5');
  await page.getByRole('button', { name: 'Axe Z' }).click();
  await page.locator('#draft-angle').fill('90');
  await expect(page.locator('#draft-cx')).toBeVisible();
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  // Rotation de 90° autour de Z (centre à l'origine) puis décalage de 5 en X : 40 × 20 → 20 × 40.
  await expect.poll(async () => {
    const b = await bbox(page);
    return b ? [b.min.x, b.max.x, b.min.y, b.max.y].map((v: number) => Math.round(v)) : null;
  }).toEqual([-15, 5, 0, 40]);
  await expectVolume(page, 8000 * 2);
  await expect(page.getByRole('list', { name: /Étapes de construction/ })).toContainText('Déplacement 1');
});
