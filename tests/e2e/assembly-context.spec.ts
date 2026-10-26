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

  // Projeter : les arêtes de la plaque voisine sont proposées, avec leur contexte d'assemblage.
  await page.click('#tool-sketch');
  await page.getByRole('button', { name: /Plan XY/ }).click();
  await expect.poll(async () => (await session(page))?.projectable?.some((c: any) => c.context?.matrix?.[14] === -20)).toBe(true);
  await page.getByRole('button', { name: /Annuler/ }).last().click();
  await expect.poll(() => appState(page, (s) => s.mode.kind)).toBe('model');

  // Retour à l'assemblage : le contexte se ferme, le bloc reste sélectionné.
  await page.click('#leave-context');
  await expect(page.locator('#tab-assembly')).toHaveAttribute('aria-selected', 'true');
  expect(await appState(page, (s) => s.assemblyContext)).toBeNull();

  // Bloc remonté de 10 mm dans l'assemblage : la plaque est 10 mm plus bas vue du bloc ; l'esquisse
  // et le cylindre suivent.
  await page.evaluate(() => {
    const c = (window as any).vibecad.controller;
    const inst = c.state.doc.assembly.instances[1];
    c.moveInstance(inst.id, { ...inst.position, z: 30 });
  });
  await expect
    .poll(() => appState(page, (s) => s.display[s.doc.parts[1].id]?.result.analysis?.bbox?.min.z))
    .toBeCloseTo(-25, 4);

  // Lien figé depuis l'historique : le bloc redescend, l'esquisse ne bouge plus.
  await page.click('#tab-parts');
  await page.locator('.part-select', { hasText: 'Bloc' }).click();
  const history = page.getByRole('list', { name: /Étapes de construction/ });
  await expect(history).toContainText('sur une voisine dans l’assemblage');
  await page.getByRole('button', { name: /Figer la place de la voisine/ }).click();
  await expect(history).toContainText('(figée)');
  await page.evaluate(() => {
    const c = (window as any).vibecad.controller;
    const inst = c.state.doc.assembly.instances[1];
    c.moveInstance(inst.id, { ...inst.position, z: 20 });
  });
  await page.waitForTimeout(800);
  expect(await appState(page, (s) => s.display[s.doc.parts[1].id]?.result.analysis?.bbox?.min.z)).toBeCloseTo(-25, 4);
});
