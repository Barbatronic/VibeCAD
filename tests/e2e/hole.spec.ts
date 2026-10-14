import { expect, test } from '@playwright/test';
import { buildPlateViaUi, clickSketch, expectVolume, finishSketch, openApp, PLATE_VOLUME, session, worldToScreen } from './helpers';

const cylinder = (d: number, h: number) => Math.PI * (d / 2) ** 2 * h;

test('perçage : un trou lamé M4 au centre d’un cercle dessiné sur la face du dessus', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);

  // Un petit cercle sur la face du dessus, n'importe quelle taille : il ne sert qu'à placer le trou.
  await page.waitForTimeout(500);
  const top = await worldToScreen(page, 45, 15, 5);
  await page.mouse.dblclick(top.x, top.y);
  await expect.poll(async () => (await session(page))?.sketch.support.kind).toBe('face');
  await page.waitForTimeout(450);
  await page.click('#sk-circle');
  await clickSketch(page, 45, 15);
  await page.keyboard.type('2');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await session(page))?.sketch.entities.filter((e: any) => e.type === 'circle').length).toBe(1);
  await finishSketch(page);

  await page.getByRole('button', { name: /Autres outils : poches et perçages/ }).click();
  await page.click('#tool-menu-hole');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  // Passage M3 par défaut (Ø 3,4).
  await expect(page.locator('#draft-hole-figures')).toContainText('Ø 3,4 mm');
  await page.getByRole('button', { name: 'Lamé' }).click();
  await page.locator('#draft-size').selectOption('M4');
  await expect(page.locator('#draft-headDiameter')).toHaveValue('8');
  await expect(page.locator('#draft-headDepth')).toHaveValue('4,4');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, PLATE_VOLUME - cylinder(8, 4.4) - cylinder(4.5, 0.6));
  const history = page.getByRole('list', { name: /Étapes de construction/ });
  await expect(history).toContainText('Perçage 1');
  await expect(history).toContainText('M4 lamé, traversant');
  await page.screenshot({ path: 'tests/output/e2e-percage.png' });
});

test('perçage : un point posé avec l’outil Point, percé à un diamètre libre de 8 mm', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);
  await page.waitForTimeout(500);
  const top = await worldToScreen(page, 45, 15, 5);
  await page.mouse.dblclick(top.x, top.y);
  await expect.poll(async () => (await session(page))?.sketch.support.kind).toBe('face');
  await page.waitForTimeout(450);
  await page.click('#sk-point');
  await clickSketch(page, 45, 15);
  await expect.poll(async () => (await session(page))?.sketch.entities.filter((e: any) => e.type === 'point').length).toBe(1);
  await finishSketch(page);

  await page.getByRole('button', { name: /Autres outils : poches et perçages/ }).click();
  await page.click('#tool-menu-hole');
  await page.locator('#draft-size').selectOption('custom');
  await page.locator('#draft-diameter').fill('8');
  await expect(page.locator('#draft-hole-figures')).toContainText('Ø 8 mm');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, PLATE_VOLUME - cylinder(8, 5));
});
