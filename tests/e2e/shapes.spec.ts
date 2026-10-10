import { expect, test } from '@playwright/test';
import { clickSketch, expectVolume, finishSketch, moveSketch, openApp, session } from './helpers';

test('polygone régulier et oblong tapés au clavier, puis extrudés au volume exact', async ({ page }) => {
  await openApp(page);
  await page.click('#tool-sketch');
  await page.getByRole('button', { name: /Plan XY/ }).click();
  await expect.poll(async () => (await session(page))?.tool).toBe('rectangle');
  await page.waitForTimeout(450);

  // Hexagone : centre (20, 20), cercle des sommets Ø 30.
  await page.click('#sk-rectangle + .split-toggle');
  await page.getByRole('menuitem', { name: /Polygone régulier/ }).click();
  await expect.poll(async () => (await session(page))?.tool).toBe('polygon');
  await clickSketch(page, 20, 20);
  await moveSketch(page, 20, 33);
  await page.keyboard.type('30');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('6');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await session(page))?.sketch.entities.filter((e: any) => e.type === 'line').length).toBe(6);

  // Oblong : centres (50, 10) et 30 mm plus loin, largeur 10.
  await page.click('#sk-circle + .split-toggle');
  await page.getByRole('menuitem', { name: /Oblong/ }).click();
  await expect.poll(async () => (await session(page))?.tool).toBe('slot');
  await clickSketch(page, 50, 10);
  await moveSketch(page, 70, 10);
  await page.keyboard.type('30');
  await page.keyboard.press('Enter');
  await moveSketch(page, 65, 14);
  await page.keyboard.type('10');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await session(page))?.sketch.entities.filter((e: any) => e.type === 'arc').length).toBe(2);
  await page.screenshot({ path: 'tests/output/e2e-polygone-oblong.png' });
  await finishSketch(page);

  await page.click('#tool-extrude');
  await page.locator('#draft-distance').fill('5');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, ((3 * Math.sqrt(3)) / 2 * 225 + 300 + 25 * Math.PI) * 5);
});
