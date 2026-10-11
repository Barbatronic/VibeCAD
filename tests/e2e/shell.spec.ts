import { expect, test, type Page } from '@playwright/test';
import { expectVolume, openApp } from './helpers';

async function partPointOnScreen(page: Page, p: { x: number; y: number; z: number }) {
  const box = (await page.locator('.vp-canvas').boundingBox())!;
  const q = await page.evaluate((pt) => {
    const c = (window as any).vibecad.controller;
    const v = c.viewport.rig.camera.position.clone().set(pt.x, pt.y, pt.z).project(c.viewport.rig.camera);
    return { x: ((v.x + 1) / 2) * c.viewport.width, y: ((1 - v.y) / 2) * c.viewport.height };
  }, p);
  return { x: box.x + q.x, y: box.y + q.y };
}

test('coque : une boîte vidée, ouverte sur le dessus d’un clic', async ({ page }) => {
  await openApp(page);
  await page.click('#tool-primitive');
  await page.locator('#draft-width').fill('40');
  await page.locator('#draft-depth').fill('30');
  await page.locator('#draft-height').fill('20');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, 24000);
  await page.evaluate(() => (window as any).vibecad.controller.fitAll());
  await page.waitForTimeout(700);

  await page.getByRole('button', { name: 'Autres outils : arrondis, chanfreins, coques et dépouilles' }).click();
  await page.click('#tool-menu-shell');
  await expect(page.locator('#draft-thickness')).toHaveValue('2');
  // Aperçu : pièce creuse et fermée tant qu'aucune face n'est ouverte.
  await expect.poll(() => page.evaluate(() => { const c = (window as any).vibecad.controller; const p = c.state.preview?.parts[c.state.doc.parts[0].id]; return p?.analysis?.volume ?? 0; })).toBeCloseTo(24000 - 36 * 26 * 16, 1);
  const top = await partPointOnScreen(page, { x: 20, y: 15, z: 20 });
  await page.mouse.click(top.x, top.y);
  await expect(page.getByText('1 face', { exact: true })).toBeVisible();
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/output/e2e-coque.png' });
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, 24000 - 36 * 26 * 18);
});
