import { expect, test, type Page } from '@playwright/test';
import { openApp } from './helpers';

/** Direction de la caméra (vers elle depuis la cible), une fois la vue immobile. */
async function viewDir(page: Page) {
  await expect.poll(() => page.evaluate(() => (window as any).vibecad.controller.viewport.rig.animating)).toBe(false);
  return page.evaluate(() => {
    const rig = (window as any).vibecad.controller.viewport.rig;
    const d = rig.camera.position.clone().sub(rig.target).normalize();
    return [d.x, d.y, d.z];
  });
}

async function clickCube(page: Page, dir: [number, number, number]) {
  const p = await page.evaluate((d) => (window as any).vibecad.controller.viewport.viewCubeClientPoint(d), dir);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
}

const expectDir = (got: number[], want: [number, number, number]) => {
  const n = Math.hypot(...want);
  want.forEach((w, i) => expect(got[i]!).toBeCloseTo(w / n, 2));
};

test('cube de navigation : un clic sur une face, une arête ou un coin oriente la vue', async ({ page }) => {
  await openApp(page);
  await page.click('#tool-primitive');
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await viewDir(page);

  // Face « Dessus » (visible dans la vue isométrique de départ).
  await clickCube(page, [0, 0, 1]);
  expectDir(await viewDir(page), [0, 0, 1]);
  // Vue de dessus : l'arête « Face + Dessus » est la bande du bas du cube.
  await clickCube(page, [0, -1, 1]);
  expectDir(await viewDir(page), [0, -1, 1]);
  // Vue de cette arête : la face « Face » est visible ; un clic dessus donne la vue de face.
  await clickCube(page, [0, -1, 0]);
  expectDir(await viewDir(page), [0, -1, 0]);
  // Coin « Face + Droite + Dessus » : vue isométrique.
  await clickCube(page, [1, -1, 1]);
  expectDir(await viewDir(page), [1, -1, 1]);
  // Survol : morceau nommé dans l'infobulle.
  const p = await page.evaluate(() => (window as any).vibecad.controller.viewport.viewCubeClientPoint([1, 0, 0]));
  await page.mouse.move(p.x + 1, p.y);
  await expect(page.locator('canvas').first()).toHaveAttribute('title', 'Orienter la vue : Droite');
  await page.screenshot({ path: 'tests/output/e2e-cube-navigation.png', clip: { x: 286, y: 660, width: 240, height: 220 } });
});

test('cube de navigation : bien visible en thème sombre', async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await openApp(page);
  await viewDir(page);
  await page.screenshot({ path: 'tests/output/e2e-cube-navigation-sombre.png', clip: { x: 286, y: 660, width: 240, height: 220 } });
  await context.close();
});
