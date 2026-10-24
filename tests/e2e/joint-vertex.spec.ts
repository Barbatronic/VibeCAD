import { expect, test, type Page } from '@playwright/test';
import { appState, buildPlateViaUi, freeViewArea, openApp } from './helpers';

/** Point écran d'un point de la pièce insérée n° `index` (coordonnées de la pièce). */
async function onScreen(page: Page, index: number, p: { x: number; y: number; z: number }) {
  const box = (await page.locator('.vp-canvas').boundingBox())!;
  const q = await page.evaluate(
    ([i, pt]) => {
      const c = (window as any).vibecad.controller;
      const inst = c.state.doc.assembly.instances[i];
      const part = c.viewport.parts.get(inst.id);
      const v = c.viewport.rig.camera.position.clone().set(pt.x, pt.y, pt.z).applyMatrix4(part.group.matrix).project(c.viewport.rig.camera);
      return { x: ((v.x + 1) / 2) * c.viewport.width, y: ((1 - v.y) / 2) * c.viewport.height };
    },
    [index, p] as const,
  );
  return { x: box.x + q.x, y: box.y + q.y };
}

test('liaison : Maj maintenue verrouille une face, le repère s’accroche au sommet visé', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);
  await page.click('#tab-assembly');
  for (let i = 0; i < 2; i++) {
    await page.click('#as-insert');
    await page.getByRole('menu', { name: 'Pièces à insérer' }).getByRole('menuitem').first().click();
  }
  await expect.poll(() => page.evaluate(() => [...(window as any).vibecad.controller.viewport.parts.values()].filter((p: any) => p.data).length)).toBe(2);
  // Cadrer jusqu'à ce que la seconde plaque soit dans la vue (elle peut s'afficher après un premier cadrage).
  // Dans la zone libre de la vue (pas sous les panneaux flottants).
  await expect
    .poll(async () => {
      await page.evaluate(() => (window as any).vibecad.controller.fitAll());
      await page.waitForTimeout(600);
      const free = await freeViewArea(page);
      const p = await onScreen(page, 1, { x: 60, y: 30, z: 5 });
      return p.x > free.left + 20 && p.x < free.right - 20 && p.y > free.top + 20 && p.y < free.bottom - 40;
    })
    .toBe(true);
  await page.click('#as-joint');
  // Survoler la face du dessus de la seconde plaque (loin du trou), puis maintenir Maj.
  // La vue peut encore se cadrer : on recalcule la position et on refait le survol jusqu'à toucher la face.
  await expect
    .poll(async () => {
      const face = await onScreen(page, 1, { x: 45, y: 20, z: 5 });
      await page.mouse.move(face.x + 1, face.y);
      await page.mouse.move(face.x, face.y);
      return appState(page, (s) => s.hover?.kind);
    })
    .toBe('face');
  await page.keyboard.down('Shift');
  await expect.poll(() => appState(page, (s) => !!s.mode.lockedFace)).toBe(true);
  // Viser le coin (60, 30, 5) : le survol devient un sommet, avec l'aperçu du repère.
  // Le verrou arrive dans la vue une image après l'état : on refait le survol jusqu'au sommet.
  const corner = await onScreen(page, 1, { x: 60, y: 30, z: 5 });
  await expect
    .poll(async () => {
      await page.mouse.move(corner.x - 5, corner.y + 4);
      await page.mouse.move(corner.x - 6, corner.y + 4);
      return appState(page, (s) => s.hover?.kind);
    })
    .toBe('vertex');
  await expect(page.locator('.vp-tag-marker', { hasText: 'Accroche sur la pièce qui bouge' })).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tests/output/e2e-liaison-sommet.png' });
  await page.mouse.click(corner.x - 6, corner.y + 4);
  await page.keyboard.up('Shift');
  await expect.poll(() => appState(page, (s) => s.mode.moving?.lcs.kind)).toBe('vertex');
  await expect.poll(() => appState(page, (s) => s.mode.lockedFace ?? null)).toBeNull();
});
