import { expect, test, type Page } from '@playwright/test';
import { appState, buildPlateViaUi, openApp } from './helpers';

/** Point écran le plus haut d'une arête circulaire (centre à la hauteur z) d'une pièce insérée. */
async function circleEdgeOnScreen(page: Page, instanceIndex: number, z: number): Promise<{ x: number; y: number }> {
  const box = (await page.locator('.vp-canvas').boundingBox())!;
  const p = await page.evaluate(
    ([index, zc]) => {
      const c = (window as any).vibecad.controller;
      const inst = c.state.doc.assembly.instances[index];
      const part = c.viewport.parts.get(inst.id);
      const e = part.data.edges.find((x: any) => x.circle && Math.abs(x.circle.center.z - zc) < 1e-6);
      const pos = part.data.edgePositions;
      let v: any = null;
      for (let k = e.start; k < e.start + e.count; k++) {
        const q = c.viewport.rig.camera.position.clone().set(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]).applyMatrix4(part.group.matrix).project(c.viewport.rig.camera);
        if (!v || q.y > v.y) v = q;
      }
      return { x: ((v.x + 1) / 2) * c.viewport.width, y: ((1 - v.y) / 2) * c.viewport.height };
    },
    [instanceIndex, z] as const,
  );
  return { x: box.x + p.x, y: box.y + p.y };
}

const fasteners = (page: Page) => appState(page, (s) => s.doc.assembly?.fasteners ?? []);
const stillView = (page: Page) => expect.poll(() => page.evaluate(() => (window as any).vibecad.controller.viewport.rig.animating)).toBe(false);

test('visserie : vis et rondelle normalisées dans le trou, taille imposée par le trou, nomenclature', async ({ page }) => {
  await openApp(page);
  // Plaque 60 × 30 × 5 percée d'un trou Ø 6 : trou de passage pour une vis M6.
  await buildPlateViaUi(page);
  await page.click('#tab-assembly');
  await page.click('#as-insert');
  await page.getByRole('menuitem', { name: 'Pièce 1' }).click();
  await expect.poll(() => appState(page, (s) => s.doc.assembly?.instances.length)).toBe(1);

  // Vis CHC : un clic sur le bord du trou ; taille et longueur viennent du trou (5 mm + un diamètre → 12).
  await page.click('#as-fastener');
  await page.getByRole('menuitem', { name: /Vis CHC/ }).click();
  await stillView(page);
  const edge = await circleEdgeOnScreen(page, 0, 5);
  await page.mouse.click(edge.x, edge.y);
  await expect.poll(async () => (await fasteners(page)).map((f: any) => [f.kind, f.size, f.length])).toEqual([['iso4762', 'M6', 12]]);

  // Rondelle : un clic sur la vis posée l'ajoute sur le même trou ; elle se glisse sous la tête.
  await page.locator('#fastener-kind').selectOption('iso7089');
  await stillView(page);
  const head = await page.evaluate(() => {
    const c = (window as any).vibecad.controller;
    const f = c.state.doc.assembly.fasteners[0];
    const m = c.fastenerPlacement().matrices.get(f.id);
    // Centre du dessus de la tête (k = 6 mm pour une CHC M6), un peu décalé de l'empreinte.
    const v = c.viewport.rig.camera.position.clone().set(m[12] + 4, m[13], m[14] + 6).project(c.viewport.rig.camera);
    return { x: ((v.x + 1) / 2) * c.viewport.width, y: ((1 - v.y) / 2) * c.viewport.height };
  });
  const box = (await page.locator('.vp-canvas').boundingBox())!;
  await page.mouse.click(box.x + head.x, box.y + head.y);
  await expect.poll(async () => (await fasteners(page)).length).toBe(2);
  const z = await page.evaluate(() => {
    const c = (window as any).vibecad.controller;
    const p = c.fastenerPlacement();
    return c.state.doc.assembly.fasteners.map((f: any) => p.matrices.get(f.id)[14]);
  });
  expect(z[0]).toBeCloseTo(5 + 1.6, 5); // tête de vis sur la rondelle M6 (1,6 mm)
  expect(z[1]).toBeCloseTo(5, 5);
  await page.screenshot({ path: 'tests/output/e2e-visserie.png' });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // Liste de gauche : un groupe « Visserie » replié, éléments identiques regroupés.
  const group = page.locator('details.fastener-list');
  await expect(group.locator('summary')).toContainText('Visserie');
  await expect(group).not.toHaveAttribute('open', '');
  await expect(group.locator('summary .count')).toHaveText('2');
  await group.locator('summary').click();
  await group.getByRole('button', { name: /^Vis CHC ISO 4762 M6 × 12/ }).click();
  // Seule la taille permise par le trou est proposée ; les longueurs sont celles de la norme.
  await expect(page.locator('#fastener-size option')).toHaveText(['M6']);
  await expect(page.locator('#fastener-length option').first()).toHaveText('10 mm');
  await page.locator('#fastener-length').selectOption('16');
  await expect.poll(async () => (await fasteners(page))[0].length).toBe(16);
  await expect(page.locator('#fastener-hole')).toContainText('passage M6');

  // Nomenclature (Fabrication › Documents) : la pièce puis la visserie.
  await page.click('#tab-fabrication');
  await page.click('#fab-docs');
  await expect(page.getByRole('cell', { name: 'Vis CHC ISO 4762 M6 × 16' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Rondelle plate ISO 7089 M6' })).toBeVisible();
});

test('visserie : seul un bord de trou rond est accepté', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);
  await page.click('#tab-assembly');
  await page.click('#as-insert');
  await page.getByRole('menuitem', { name: 'Pièce 1' }).click();
  await page.click('#as-fastener');
  await page.getByRole('menuitem', { name: /Vis BHC/ }).click();
  await stillView(page);
  // Milieu de l'arête du dessus le long de X (y = 0, z = 5) : ce n'est pas un trou.
  const box = (await page.locator('.vp-canvas').boundingBox())!;
  const p = await page.evaluate(() => {
    const c = (window as any).vibecad.controller;
    const v = c.viewport.rig.camera.position.clone().set(30, 0, 5).project(c.viewport.rig.camera);
    return { x: ((v.x + 1) / 2) * c.viewport.width, y: ((1 - v.y) / 2) * c.viewport.height };
  });
  await page.mouse.click(box.x + p.x, box.y + p.y);
  await expect(page.getByText('Cliquez le bord d’un trou rond').first()).toBeVisible();
  expect(await fasteners(page)).toEqual([]);
  const edge = await circleEdgeOnScreen(page, 0, 5);
  await page.mouse.click(edge.x, edge.y);
  await expect.poll(async () => (await fasteners(page)).map((f: any) => [f.kind, f.size, f.length])).toEqual([['iso7380', 'M6', 12]]);
});
