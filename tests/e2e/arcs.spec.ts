import { expect, test } from '@playwright/test';
import { clickSketch, expectVolume, finishSketch, moveSketch, openApp, session } from './helpers';

test('contour en « D » avec un arc tracé à la souris, puis extrusion au volume exact', async ({ page }) => {
  await openApp(page);
  await page.click('#tool-sketch');
  await page.getByRole('button', { name: /Plan XY/ }).click();
  await expect.poll(async () => (await session(page))?.tool).toBe('rectangle');
  await page.waitForTimeout(450);

  // Segment du bas (0,0) → (30,0).
  await page.click('#sk-line');
  await clickSketch(page, 0.05, 0.05);
  await clickSketch(page, 30, 0);
  await page.keyboard.press('Escape');

  // Arc : centre (30,10), départ sur l'extrémité du segment, on tourne vers le haut.
  await page.click('#sk-circle + .split-toggle');
  await page.getByRole('menuitem', { name: /Arc de cercle/ }).click();
  await expect.poll(async () => (await session(page))?.tool).toBe('arc');
  await clickSketch(page, 30, 10);
  await clickSketch(page, 30, 0);
  for (const [x, y] of [
    [36, 2],
    [39.5, 7],
    [39.5, 13],
    [36, 18],
  ]) {
    await moveSketch(page, x!, y!);
  }
  await page.screenshot({ path: 'tests/output/e2e-arc-trace.png' });
  await clickSketch(page, 30, 20);
  await expect.poll(async () => (await session(page))?.sketch.entities.filter((e: any) => e.type === 'arc').length).toBe(1);

  // Segments du haut et de gauche, qui referment le contour.
  await page.click('#sk-line');
  await clickSketch(page, 30, 20);
  await clickSketch(page, 0, 20);
  await clickSketch(page, 0.05, 0.05);
  await page.screenshot({ path: 'tests/output/e2e-arc-contour.png' });
  await finishSketch(page);

  await page.click('#tool-extrude');
  await page.locator('#draft-distance').fill('5');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, 5 * (30 * 20 + (Math.PI * 100) / 2));
  await page.screenshot({ path: 'tests/output/e2e-arc-volume.png' });
});
