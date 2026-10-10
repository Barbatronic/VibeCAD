import { expect, test } from '@playwright/test';
import { clickSketch, expectVolume, finishSketch, moveSketch, openApp, session } from './helpers';

test('couper : un rectangle et un cercle réunis en un seul contour, puis extrudés', async ({ page }) => {
  await openApp(page);
  await page.click('#tool-sketch');
  await page.getByRole('button', { name: /Plan XY/ }).click();
  await expect.poll(async () => (await session(page))?.tool).toBe('rectangle');
  await page.waitForTimeout(450);

  // Rectangle 20 × 10 depuis l'origine.
  await clickSketch(page, 0.05, 0.05);
  await moveSketch(page, 15, 8);
  await page.keyboard.type('20');
  await page.keyboard.press('Tab');
  await page.keyboard.type('10');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await session(page))?.sketch.entities.filter((e: any) => e.type === 'line').length).toBe(4);

  // Cercle Ø 6 centré sur le côté droit.
  await page.keyboard.press('c');
  await clickSketch(page, 20, 5);
  await moveSketch(page, 23, 5);
  await page.keyboard.type('6');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await session(page))?.sketch.entities.filter((e: any) => e.type === 'circle').length).toBe(1);

  // Couper : le morceau du côté droit dans le cercle, puis la moitié gauche du cercle.
  await page.keyboard.press('Escape');
  await page.keyboard.press('t');
  await expect.poll(async () => (await session(page))?.tool).toBe('trim');
  await moveSketch(page, 20, 6);
  await page.screenshot({ path: 'tests/output/e2e-couper-survol.png' });
  await clickSketch(page, 20, 6);
  await expect.poll(async () => (await session(page))?.sketch.entities.filter((e: any) => e.type === 'line').length).toBe(5);
  const center = await page.evaluate(() => {
    const sk = (window as any).vibecad.controller.state.mode.session.sketch;
    const circle = sk.entities.find((e: any) => e.type === 'circle');
    return sk.entities.find((e: any) => e.id === circle.center);
  });
  await clickSketch(page, center.x - 3, center.y);
  await expect.poll(async () => (await session(page))?.sketch.entities.filter((e: any) => e.type === 'arc').length).toBe(1);
  await page.screenshot({ path: 'tests/output/e2e-couper.png' });
  await finishSketch(page);

  await page.click('#tool-extrude');
  await page.locator('#draft-distance').fill('5');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  // Le rectangle plus un demi-disque de rayon 3, où que soit le centre sur le côté.
  await expectVolume(page, (200 + 4.5 * Math.PI) * 5);
});
