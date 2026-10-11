import { expect, test, type Page } from '@playwright/test';
import { appState, buildPlateViaUi, clickSketch, expectVolume, finishSketch, openApp, PLATE_VOLUME, session } from './helpers';

async function partPointOnScreen(page: Page, p: { x: number; y: number; z: number }) {
  const box = (await page.locator('.vp-canvas').boundingBox())!;
  const q = await page.evaluate((pt) => {
    const c = (window as any).vibecad.controller;
    const v = c.viewport.rig.camera.position.clone().set(pt.x, pt.y, pt.z).project(c.viewport.rig.camera);
    return { x: ((v.x + 1) / 2) * c.viewport.width, y: ((1 - v.y) / 2) * c.viewport.height };
  }, p);
  return { x: box.x + q.x, y: box.y + q.y };
}

test('extrusion jusqu’à une face : un plot monte jusqu’au haut d’une tour cliquée', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);

  // Tour 20 × 30 × 20 au bout de la plaque (x 40 → 60).
  await page.click('#tool-primitive');
  await page.locator('#draft-width').fill('20');
  await page.locator('#draft-depth').fill('30');
  await page.locator('#draft-height').fill('20');
  await page.locator('#draft-pos-x').fill('40');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, PLATE_VOLUME + 9000);

  // Cercle Ø 6 sur le plan XY.
  await page.click('#tool-sketch');
  await page.getByRole('button', { name: /Plan XY/ }).click();
  await expect.poll(async () => (await session(page))?.tool).toBe('rectangle');
  await page.waitForTimeout(450);
  await page.click('#sk-circle');
  await clickSketch(page, 25, 8);
  await page.keyboard.type('6');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await session(page))?.sketch.entities.filter((e: any) => e.type === 'circle').length).toBe(1);
  await finishSketch(page);

  await page.click('#tool-extrude');
  await page.getByRole('group', { name: 'Jusqu’où ?' }).getByRole('button', { name: 'Jusqu’à une face…' }).click();
  await expect(page.getByText(/l’extrusion s’arrêtera sur son plan/)).toBeVisible();
  await expect(page.locator('#draft-distance')).toHaveCount(0);
  await page.evaluate(() => (window as any).vibecad.controller.fitAll());
  await page.waitForTimeout(700);
  const top = await partPointOnScreen(page, { x: 50, y: 15, z: 20 });
  await page.mouse.click(top.x, top.y);
  await expect.poll(() => appState(page, (s) => s.mode.draft?.feature.params.upTo?.role)).toBe('end');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/output/e2e-jusqua-une-face.png' });
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  // Le plot (Ø 6) dépasse la plaque de 15 mm, jusqu'à z = 20.
  await expectVolume(page, PLATE_VOLUME + 9000 + Math.PI * 9 * 15);
  await expect(page.getByRole('list', { name: /Étapes de construction/ }).getByText('jusqu’à une face')).toBeVisible();
});
