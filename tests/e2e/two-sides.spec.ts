import { expect, test } from '@playwright/test';
import { clickSketch, expectVolume, finishSketch, moveSketch, openApp, session } from './helpers';

async function sketchOnXY(page: import('@playwright/test').Page) {
  await page.click('#tool-sketch');
  await page.getByRole('button', { name: /Plan XY/ }).click();
  await expect.poll(async () => (await session(page))?.tool).toBe('rectangle');
  await page.waitForTimeout(450);
}

test('deux côtés : extrusion 4 + 2 mm, puis poche de 1 mm d’un côté et traversante de l’autre', async ({ page }) => {
  await openApp(page);
  // Carré 10 × 10 extrudé de 4 mm vers le haut et 2 mm vers le bas.
  await sketchOnXY(page);
  await clickSketch(page, 0.05, 0.05);
  await moveSketch(page, 8, 8);
  await page.keyboard.type('10');
  await page.keyboard.press('Tab');
  await page.keyboard.type('10');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await session(page))?.dof).toBe(0);
  await finishSketch(page);
  await page.click('#tool-extrude');
  await page.locator('#draft-distance').fill('4');
  await page.getByRole('group', { name: 'Sens' }).getByRole('button', { name: 'Deux côtés' }).click();
  await expect(page.locator('#draft-distance2')).toHaveValue('4');
  await page.locator('#draft-distance2').fill('2');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, 600);

  // Cercle Ø 6 sur le même plan (au milieu de la pièce) : 1 mm dans la matière, traversante de l'autre côté.
  await sketchOnXY(page);
  await page.click('#sk-circle');
  await clickSketch(page, 5, 5);
  await page.keyboard.type('6');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await session(page))?.sketch.entities.filter((e: any) => e.type === 'circle').length).toBe(1);
  await finishSketch(page);
  await page.click('#tool-pocket');
  await page.getByRole('group', { name: 'Profondeur', exact: true }).getByRole('button', { name: 'Cotée' }).click();
  await page.locator('#draft-distance').fill('1');
  await page.getByRole('group', { name: 'Sens' }).getByRole('button', { name: 'Deux côtés' }).click();
  await page.getByRole('group', { name: 'Profondeur de l’autre côté' }).getByRole('button', { name: 'Traversante' }).click();
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.screenshot({ path: 'tests/output/e2e-deux-cotes.png' });
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  // « Dans la matière » : contre la normale (vers le bas), 1 mm ; de l'autre côté, les 4 mm traversés.
  await expectVolume(page, 600 - Math.PI * 9 * 5);
  await expect(page.getByRole('list', { name: /Étapes de construction/ }).getByText(/deux côtés/).first()).toBeVisible();
});
