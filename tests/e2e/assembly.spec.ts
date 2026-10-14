import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { readZip } from '../../src/io/zip';
import { openExport, appState, buildPlateViaUi, clickSketch, expectVolume, finishSketch, openApp, session } from './helpers';

/**
 * Point écran d'une arête circulaire (centre à la hauteur z) d'une pièce insérée : le plus haut à
 * l'écran (bord d'un trou, vu par-dessus) ou le plus bas (bord du pied d'une goupille, dont le
 * côté arrière est caché par la goupille elle-même).
 */
async function circleEdgeOnScreen(page: Page, instanceIndex: number, z: number, side: 'top' | 'bottom' = 'top'): Promise<{ x: number; y: number }> {
  const box = (await page.locator('.vp-canvas').boundingBox())!;
  const p = await page.evaluate(
    ([index, zc, which]) => {
      const w = window as any;
      const c = w.vibecad.controller;
      const inst = c.state.doc.assembly.instances[index];
      const part = c.viewport.parts.get(inst.id);
      const edgeIndex = part.data.edges.findIndex((e: any) => e.circle && Math.abs(e.circle.center.z - zc) < 1e-6);
      const e = part.data.edges[edgeIndex];
      const pos = part.data.edgePositions;
      // Le point de l'arête le plus haut (ou le plus bas) à l'écran, qui reste visible.
      let v: any = null;
      for (let k = e.start; k < e.start + e.count; k++) {
        const q = c.viewport.rig.camera.position.clone().set(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]).applyMatrix4(part.group.matrix).project(c.viewport.rig.camera);
        if (!v || (which === 'top' ? q.y > v.y : q.y < v.y)) v = q;
      }
      return { x: ((v.x + 1) / 2) * c.viewport.width, y: ((1 - v.y) / 2) * c.viewport.height };
    },
    [instanceIndex, z, side] as const,
  );
  return { x: box.x + p.x, y: box.y + p.y };
}

const joint = (page: Page) => appState(page, (s) => s.doc.assembly?.joints[0] ?? null);
const pinOrigin = (page: Page) =>
  page.evaluate(() => {
    const c = (window as any).vibecad.controller;
    const m = c.assemblyPlacement().matrices.get(c.state.doc.assembly.instances[1].id);
    return { x: m[12], y: m[13], z: m[14] };
  });

test('assemblage : goupille en pivot dans le trou de la plaque, curseur, glissière, glisser à la souris, export', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);

  // Seconde pièce : goupille Ø 6 × 10 centrée sur l'origine.
  await page.click('#part-add');
  await page.click('#tool-sketch');
  await page.getByRole('button', { name: /Plan XY/ }).click();
  await expect.poll(async () => (await session(page))?.tool).toBe('rectangle');
  await page.waitForTimeout(450);
  await page.click('#sk-circle');
  await clickSketch(page, 0.05, 0.05);
  await page.keyboard.type('6');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await session(page))?.sketch.entities.filter((e: any) => e.type === 'circle').length).toBe(1);
  await finishSketch(page);
  await page.click('#tool-extrude');
  await page.locator('#draft-distance').fill('10');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, Math.PI * 9 * 10, 1);

  // Onglet Assemblage : insérer la plaque (fixe) puis la goupille.
  await page.click('#tab-assembly');
  for (const name of ['Pièce 1', 'Pièce 2']) {
    await page.click('#as-insert');
    await page.getByRole('menuitem', { name }).click();
  }
  await expect.poll(() => appState(page, (s) => s.doc.assembly?.instances.length)).toBe(2);
  // Cadrer jusqu'à ce que la goupille soit bien dans la vue (elle peut s'afficher après un premier cadrage).
  const canvas = (await page.locator('.vp-canvas').boundingBox())!;
  await expect
    .poll(async () => {
      await page.evaluate(() => (window as any).vibecad.controller.fitAll());
      await page.waitForTimeout(600);
      const p = await circleEdgeOnScreen(page, 1, 0, 'bottom');
      return p.y + 2 < canvas.y + canvas.height - 40 && p.y > canvas.y;
    })
    .toBe(true);

  // Liaison : bord bas de la goupille, puis bord haut du trou → pivot.
  await page.click('#as-joint');
  const pinEdge = await circleEdgeOnScreen(page, 1, 0, 'bottom');
  // Juste sous le bord (hors de la goupille) : c'est l'arête la plus proche qui est désignée.
  await page.mouse.click(pinEdge.x, pinEdge.y + 2);
  await expect.poll(() => appState(page, (s) => !!s.mode.moving)).toBe(true);
  // Le repère choisi reste affiché ; au survol, l'aperçu montre le repère de la pièce de référence.
  await expect(page.locator('.vp-tag-marker', { hasText: 'Pièce qui bouge' })).toBeVisible();
  const holeEdge = await circleEdgeOnScreen(page, 0, 5);
  await page.mouse.move(holeEdge.x, holeEdge.y);
  await expect(page.locator('.vp-tag-marker.is-base', { hasText: 'Accroche sur la pièce de référence' })).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/output/e2e-liaison-apercu.png' });
  await page.mouse.click(holeEdge.x, holeEdge.y);
  await expect.poll(async () => (await joint(page))?.kind).toBe('revolute');
  const o = await pinOrigin(page);
  expect(o.x).toBeCloseTo(15, 5);
  expect(o.y).toBeCloseTo(15, 5);
  expect(o.z).toBeCloseTo(5, 5);
  await page.screenshot({ path: 'tests/output/e2e-assemblage-pivot.png' });

  // Curseur d'angle : 90°, une seule action à annuler.
  await page.locator('#joint-angle').evaluate((el: HTMLInputElement) => {
    for (const v of ['30', '60', '90']) {
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect.poll(async () => (await joint(page))?.angle).toBe(90);

  // Glissière : la goupille descend dans le trou avec le curseur de décalage.
  await page.getByRole('button', { name: 'Glissière', exact: true }).click();
  await expect.poll(async () => (await joint(page))?.kind).toBe('slider');
  await page.locator('#joint-offset').evaluate((el: HTMLInputElement) => {
    el.value = '-5';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect.poll(async () => (await pinOrigin(page)).z).toBeCloseTo(0, 5);
  await page.screenshot({ path: 'tests/output/e2e-assemblage-glissiere.png' });

  // Outil Main, à la souris : la goupille ne bouge que le long de l'axe du trou.
  await page.click('#as-hand');
  await expect(page.locator('#as-hand')).toHaveAttribute('aria-pressed', 'true');
  const top = await circleEdgeOnScreen(page, 1, 10);
  await page.mouse.move(top.x, top.y);
  await page.mouse.down();
  await page.mouse.move(top.x, top.y - 30, { steps: 5 });
  await page.mouse.move(top.x, top.y - 60, { steps: 5 });
  await page.mouse.up();
  const after = await pinOrigin(page);
  expect(after.z).toBeGreaterThan(1);
  expect(after.x).toBeCloseTo(15, 5);
  expect(after.y).toBeCloseTo(15, 5);
  // Annuler revient d'un seul geste à la position d'avant le glisser.
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await pinOrigin(page)).z).toBeCloseTo(0, 5);

  // Export 3MF de l'assemblage : deux objets, la goupille à sa place (bas à z = 0).
  const dialog = await openExport(page, '3MF');
  await expect(dialog).toContainText('assemblage');
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Exporter' }).click()]);
  await download.saveAs('tests/output/e2e-assemblage.3mf');
  const files = await readZip(new Uint8Array(readFileSync('tests/output/e2e-assemblage.3mf')));
  const model = new TextDecoder().decode(files.get('3D/3dmodel.model'));
  expect((model.match(/<object /g) ?? []).length).toBe(2);

  // L'assemblage est enregistré avec le projet (sauvegarde automatique, rechargement).
  await page.waitForTimeout(1600);
  await page.reload();
  await page.waitForFunction(() => (window as any).vibecad?.store?.get().kernel.status === 'ready');
  const recover = page.getByRole('button', { name: /Récupérer|Reprendre/ });
  if (await recover.count()) await recover.first().click();
  await expect.poll(() => appState(page, (s) => s.doc.assembly?.joints.length ?? 0)).toBe(1);
});
