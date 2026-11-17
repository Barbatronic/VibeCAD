import { expect, test, type Page } from '@playwright/test';
import { appState, buildPlateViaUi, openApp } from './helpers';

const ctl = <T>(page: Page, fn: (c: any) => T) => page.evaluate(`(${fn.toString()})(window.vibecad.controller)`) as Promise<T>;
const drawingOf = (page: Page) => appState(page, (s) => s.doc.fabrication?.drawings?.[0] ?? null);

/** Centre à l'écran d'un point de la feuille (mm papier, origine en bas à gauche). */
async function paperToScreen(page: Page, x: number, y: number) {
  const paper = (await page.locator('.dwg-paper').boundingBox())!;
  const size = await ctl(page, (c) => {
    const l = c.drawingOf(c.docsPart()).layout;
    return { w: l.width as number, h: l.height as number };
  });
  return { x: paper.x + (x / size.w) * paper.width, y: paper.y + (1 - y / size.h) * paper.height };
}

test('mise en plan : cotes ajoutées, déplacées, supprimées, vue déplacée, cartouche, export DXF', async ({ page }) => {
  await openApp(page);
  // Plaque 60 × 30 × 5 percée d'un trou Ø 6.
  await buildPlateViaUi(page);
  await ctl(page, (c) => {
    c.setWorkspace('fabrication');
    c.setFabricationTab('docs');
  });
  await expect(page.locator('.dwg-paper')).toBeVisible();
  await expect(page.locator('.dwg-dim')).toHaveCount(3);
  expect(await drawingOf(page)).toBeNull();

  // Cote entre deux sommets de la vue de face : deux clics sur des accroches, un troisième pour la poser.
  const face = await ctl(page, (c) => {
    const v = c.drawingOf(c.docsPart()).layout.views.face;
    return { a: v.toPaper({ x: v.min.x, y: v.max.y }), b: v.toPaper({ x: v.max.x, y: v.max.y }), box: v.box };
  });
  await page.click('#dwg-tool-linear');
  const a = await paperToScreen(page, face.a.x, face.a.y);
  const b = await paperToScreen(page, face.b.x, face.b.y);
  const above = await paperToScreen(page, (face.a.x + face.b.x) / 2, face.a.y + 14);
  await page.mouse.click(a.x, a.y);
  await page.mouse.click(b.x, b.y);
  await page.mouse.move(above.x, above.y, { steps: 3 });
  await expect(page.locator('.dwg-dim.is-draft')).toHaveCount(1);
  await page.mouse.click(above.x, above.y);
  await expect(page.locator('.dwg-dim')).toHaveCount(4);
  const added = (await drawingOf(page)).dimensions[3];
  expect(added).toMatchObject({ view: 'face', kind: 'linear', axis: 'x' });
  expect(added.offset).toBeCloseTo(14, 0);
  await page.keyboard.press('Escape');

  // Faire glisser la cote plus haut.
  const grip = await paperToScreen(page, (face.a.x + face.b.x) / 2 + 6, face.a.y + added.offset);
  const higher = await paperToScreen(page, (face.a.x + face.b.x) / 2 + 6, face.a.y + 22);
  await page.mouse.move(grip.x, grip.y);
  await page.mouse.down();
  await page.mouse.move(higher.x, higher.y, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await drawingOf(page)).dimensions[3].offset).toBeCloseTo(22, 0);

  // La cote choisie se supprime au clavier ; l'annulation la rend.
  await page.keyboard.press('Delete');
  await expect(page.locator('.dwg-dim')).toHaveCount(3);
  await ctl(page, (c) => c.undo());
  await expect(page.locator('.dwg-dim')).toHaveCount(4);

  // Cote de diamètre : un clic sur le cercle du trou, dans la vue de dessus.
  const hole = await ctl(page, (c) => {
    const l = c.drawingOf(c.docsPart()).layout;
    const k = l.views.dessus.anchors.circles[0];
    const center = l.views.dessus.toPaper(k.center);
    return { x: center.x + k.radius * l.scale * Math.SQRT1_2, y: center.y + k.radius * l.scale * Math.SQRT1_2, count: l.views.dessus.anchors.circles.length as number };
  });
  expect(hole.count).toBe(1);
  await page.click('#dwg-tool-round');
  const rim = await paperToScreen(page, hole.x, hole.y);
  await page.mouse.move(rim.x, rim.y, { steps: 2 });
  await page.mouse.click(rim.x, rim.y);
  await expect(page.locator('.dwg-dim')).toHaveCount(5);
  expect((await drawingOf(page)).dimensions[4]).toMatchObject({ view: 'dessus', kind: 'diameter', radius: 3, angle: 45 });
  await expect(page.locator('.dwg-dim.is-selected')).toContainText('Ø 6');
  await page.keyboard.press('Escape');

  // Déplacer la vue de face : les deux autres suivent (elles restent alignées).
  const before = await ctl(page, (c) => {
    const v = c.drawingOf(c.docsPart()).layout.views;
    return [v.face.box.x, v.dessus.box.x, v.gauche.box.y - v.face.box.y] as number[];
  });
  const inside = await paperToScreen(page, face.box.x + face.box.w / 2, face.box.y + face.box.h / 2);
  const moved = await paperToScreen(page, face.box.x + face.box.w / 2 + 10, face.box.y + face.box.h / 2 - 5);
  await page.mouse.move(inside.x, inside.y);
  await page.mouse.down();
  await page.mouse.move(moved.x, moved.y, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await drawingOf(page)).views?.face?.x ?? 0).toBeCloseTo(10, 0);
  const after = await ctl(page, (c) => {
    const v = c.drawingOf(c.docsPart()).layout.views;
    return [v.face.box.x, v.dessus.box.x, v.gauche.box.y - v.face.box.y] as number[];
  });
  expect(after[0]! - before[0]!).toBeCloseTo(10, 0);
  expect(after[1]! - before[1]!).toBeCloseTo(10, 0);
  expect(after[2]).toBeCloseTo(before[2]!, 3);

  // Feuille, échelle, cartouche.
  await page.getByLabel('Format de la feuille').selectOption('A3');
  await page.getByLabel('Échelle du plan').selectOption('1');
  await page.getByLabel('Cartouche : Dessiné par').fill('A. Martin');
  await page.getByLabel('Cartouche : Dessiné par').press('Enter');
  await expect.poll(() => drawingOf(page)).toMatchObject({ format: 'A3', scale: 1, title: { author: 'A. Martin' } });
  await expect(page.locator('.dwg-page')).toContainText('A. Martin');
  await expect(page.getByRole('status').filter({ hasText: 'A3 paysage · échelle 1:1 · 5 cotes' })).toBeVisible();
  await page.screenshot({ path: 'tests/output/e2e-mise-en-plan.png' });

  // Export DXF : le fichier porte les calques et la cote ajoutée.
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Cette pièce (DXF)' }).click()]);
  const text = await (await download.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString('utf8'));
  expect(text).toContain('CACHE');
  expect(text).toContain('A. Martin');

  // Retour à la mise en plan automatique : le cartouche reste.
  await page.getByRole('button', { name: 'Automatique', exact: true }).click();
  await expect(page.locator('.dwg-dim')).toHaveCount(3);
  expect(await drawingOf(page)).toEqual({ partId: expect.any(String), title: { author: 'A. Martin' } });
});
