import { expect, test } from '@playwright/test';
import { addFeature, addInstance, addPart, findPart, makePrimitiveFeature } from '../../src/domain/document';
import { appState, clickSketch, clickTool, finishSketch, openApp, session, worldToScreen } from './helpers';
import { buildPlateDocument } from '../helpers/plate';

/** Plaque 60 × 30 × 5 (fixe) et bloc 20 × 20 × 10, inséré 20 mm au-dessus et décalé de 40 en X. */
function project() {
  let { doc } = buildPlateDocument();
  const added = addPart(doc, 'Bloc');
  doc = added.doc;
  const box = makePrimitiveFeature(doc, findPart(doc, added.partId)!, 'box');
  doc = addFeature(doc, added.partId, { ...box, params: { ...box.params, width: 20, depth: 20, height: 10 } });
  doc = addInstance(doc, doc.parts[0]!.id, { x: 0, y: 0, z: 0 }).doc;
  doc = addInstance(doc, added.partId, { x: 40, y: 0, z: 20 }).doc;
  return doc;
}

test('conception dans l’assemblage : esquisse du bloc posée sur la plaque voisine, à sa place', async ({ page }) => {
  await openApp(page);
  await page.evaluate((doc) => (window as any).vibecad.controller.commit(doc, 'Projet'), project() as any);
  await expect.poll(() => appState(page, (s) => s.doc.parts.every((p: any) => s.display[p.id]?.mesh))).toBe(true);

  // Onglet Assemblage : le bloc, puis « Modifier dans l'assemblage ».
  await page.click('#tab-assembly');
  await page.getByRole('button', { name: /Modifier « Bloc » dans l’assemblage/ }).click();
  await expect(page.locator('#tab-parts')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText(/Dans l’assemblage : « Bloc »/)).toBeVisible();
  // Vue : le bloc et la plaque voisine (placée dans le repère du bloc), pas les autres pièces seules.
  await expect.poll(() => page.evaluate(() => [...(window as any).vibecad.controller.viewport.parts.keys()].sort())).toEqual(
    await page.evaluate(() => {
      const s = (window as any).vibecad.store.get();
      return [s.activePartId, `ctx:${s.doc.assembly.instances[0].id}`].sort();
    }),
  );
  await page.evaluate(() => (window as any).vibecad.controller.fitAll());
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'tests/output/e2e-contexte-assemblage.png' });

  // Double-clic sur le dessus de la plaque, loin du bloc : dans le repère du bloc, (10 − 40, 5, 5 − 20).
  const top = await worldToScreen(page, -30, 5, -15);
  await page.mouse.dblclick(top.x, top.y);
  await expect.poll(async () => (await session(page))?.sketch.support.kind).toBe('face');
  const support = (await session(page)).sketch.support;
  expect(support.partId).toBe(await appState(page, (s) => s.doc.parts[0].id));
  expect(support.context.matrix.slice(12, 15)).toEqual([-40, 0, -20]);
  await page.waitForTimeout(450);
  await page.click('#sk-circle');
  await clickSketch(page, -10, 25);
  await page.keyboard.type('8');
  await page.keyboard.press('Enter');
  await finishSketch(page);
  await clickTool(page, 'tool-extrude');
  await page.locator('#draft-distance').fill('3');
  // Le cylindre ne touche pas le bloc (il est posé sur la plaque) : avertissement attendu.
  await expect(page.getByText(/plusieurs morceaux séparés/)).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  // Le bloc a gagné un cylindre posé sur la plaque : il descend jusqu'à z = −15 dans son repère.
  await expect
    .poll(() => appState(page, (s) => s.display[s.activePartId]?.result.analysis?.bbox?.min.z))
    .toBeCloseTo(-15, 4);

  // Retour à l'assemblage : le contexte se ferme, le bloc reste sélectionné.
  await page.click('#leave-context');
  await expect(page.locator('#tab-assembly')).toHaveAttribute('aria-selected', 'true');
  expect(await appState(page, (s) => s.assemblyContext)).toBeNull();
});
