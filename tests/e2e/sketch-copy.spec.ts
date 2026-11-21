import { expect, test, type Page } from '@playwright/test';
import { addFeature, addPart, findPart, makeFilletFeature, makePlaneFeature } from '../../src/domain/document';
import { serializeDocument } from '../../src/io/native-format';
import { buildPlateDocument, cornerEdge } from '../helpers/plate';
import { appState, clickTool, finishSketch, openApp, session, sketchToScreen } from './helpers';

async function load(page: Page, text: string) {
  await openApp(page);
  await page.evaluate((t) => (window as any).vibecad.controller.loadFromText(t, { savedAt: null, dirty: false }), text);
  await expect.poll(() => appState(page, (s) => s.doc.parts.every((p: any) => p.features.length === 0 || s.display[p.id]?.mesh))).toBe(true);
}

test('copier une esquisse et la coller : même support dans la pièce, plan XY dans une autre pièce', async ({ page }) => {
  const { doc: base } = buildPlateDocument();
  const doc = addPart(base, 'Pièce 2').doc;
  await load(page, serializeDocument(doc));
  const [p1, p2] = await appState(page, (s) => s.doc.parts.map((p: any) => p.id));
  await page.evaluate((id) => (window as any).vibecad.controller.setActivePart(id), p1);
  const history = page.getByRole('list', { name: /Étapes de construction/ });
  // Copier « Esquisse 2 » (le trou) : choisie dans l'historique (clic sur son nom), puis Ctrl+C.
  const row = history.locator('.feature-main', { hasText: 'Esquisse 2' });
  await row.click({ position: { x: 40, y: 12 } });
  await page.keyboard.press('Control+c');
  await expect.poll(() => appState(page, (s) => s.sketchClipboard?.name)).toBe('Esquisse 2');
  // Le clic droit propose aussi « Copier ».
  await row.click({ button: 'right', position: { x: 40, y: 12 } });
  await expect(page.getByRole('menuitem', { name: /Copier/ })).toBeVisible();
  await page.keyboard.press('Escape');
  // Coller dans la même pièce, sur le même support.
  await page.keyboard.press('Control+v');
  await expect.poll(() => appState(page, (s) => s.mode.kind)).toBe('pick-support');
  await page.getByRole('button', { name: /Même support que « Esquisse 2 »/ }).click();
  await expect.poll(async () => (await session(page))?.sketch.constraints.length).toBe(3);
  await finishSketch(page);
  const sketches = () => appState(page, (s) => s.doc.parts.map((p: any) => p.features.filter((f: any) => f.type === 'sketch').map((f: any) => ({ support: f.params.support, n: f.params.entities.length }))));
  const after = await sketches();
  expect(after[0]).toHaveLength(3);
  expect(after[0]![2]!.support).toEqual(after[0]![1]!.support);
  expect(after[0]![2]!.n).toBe(after[0]![1]!.n);
  // Coller dans l'autre pièce : le support d'origine (face de la plaque) n'y est pas ; plan XY.
  await page.evaluate((id) => (window as any).vibecad.controller.setActivePart(id), p2);
  await page.keyboard.press('Control+v');
  await expect.poll(() => appState(page, (s) => s.mode.kind)).toBe('pick-support');
  await expect(page.getByRole('button', { name: /Même support que/ })).toHaveCount(0);
  await page.getByRole('button', { name: /Plan XY/ }).click();
  await expect.poll(async () => (await session(page))?.sketch.constraints.length).toBe(3);
  await finishSketch(page);
  const final = await sketches();
  expect(final[1]).toEqual([{ support: { kind: 'plane', plane: 'XY', offset: 0 }, n: after[0]![1]!.n }]);
});

test('projeter un arc de la pièce : repris comme un arc (coin arrondi), pas comme un cercle complet', async ({ page }) => {
  const { doc: base, ids } = buildPlateDocument();
  const doc = addFeature(base, ids.partId, makeFilletFeature(base, findPart(base, ids.partId)!, [cornerEdge(base, ids.sketch1, ids.extrude)], 5));
  await load(page, serializeDocument(doc));
  // Nouvelle esquisse sur le dessus, après le congé.
  await page.evaluate(() => (window as any).vibecad.controller.startSketch());
  await page.evaluate(() => {
    const c = (window as any).vibecad.controller;
    const mesh = c.state.display[c.state.doc.parts[0].id].mesh;
    const index = mesh.faces.findIndex((f: any) => f.plane && f.plane.normal.z > 0.9);
    c.sketchOnFace(c.state.doc.parts[0].id, index, null);
  });
  await expect.poll(() => appState(page, (s) => s.mode.kind)).toBe('sketch');
  await clickTool(page, 'sk-project');
  await expect.poll(async () => ((await session(page))?.projectable ?? []).filter((c: any) => c.kind === 'arc').length).toBe(1);
  // Clic au milieu de l'arc (coin (55, 25), rayon 5, à 45°).
  const at = await sketchToScreen(page, 55 + 5 * Math.SQRT1_2, 25 + 5 * Math.SQRT1_2);
  await page.mouse.click(at.x, at.y);
  await expect.poll(async () => ((await session(page))?.sketch.entities ?? []).filter((e: any) => e.type === 'arc' && e.reference).length).toBe(1);
  expect(((await session(page))?.sketch.entities ?? []).filter((e: any) => e.type === 'circle' && e.reference)).toHaveLength(0);
});

test('masquer et afficher les esquisses, les plans et les axes : une ligne, ou tous dans le menu Affichage', async ({ page }) => {
  const { doc: base, ids } = buildPlateDocument();
  const plane = makePlaneFeature(base, findPart(base, ids.partId)!);
  const doc = addFeature(base, ids.partId, plane);
  await load(page, serializeDocument(doc));
  const shown = () => page.evaluate(() => { const i = (window as any).vibecad.controller.viewport.input; return { sketches: i.sketches.length, planes: (i.datumPlanes ?? []).length }; });
  await expect.poll(shown).toEqual({ sketches: 2, planes: 1 });
  // Plan masqué sur sa ligne (œil), puis réaffiché.
  const history = page.getByRole('list', { name: /Étapes de construction/ });
  await history.getByRole('button', { name: `Masquer « ${plane.name} »` }).click();
  await expect.poll(shown).toEqual({ sketches: 2, planes: 0 });
  expect(await appState(page, (s) => s.doc.parts[0].features.at(-1).visible)).toBe(false);
  await history.getByRole('button', { name: `Afficher « ${plane.name} »` }).click();
  await expect.poll(shown).toEqual({ sketches: 2, planes: 1 });
  // Tous d'un coup : menu Affichage.
  await page.click('#view-display');
  await page.getByRole('menuitemcheckbox', { name: 'Esquisses' }).click();
  await expect.poll(shown).toEqual({ sketches: 0, planes: 1 });
  // Le menu reste ouvert : on décoche aussi les plans.
  await page.getByRole('menuitemcheckbox', { name: 'Plans et axes' }).click();
  await page.keyboard.press('Escape');
  await expect.poll(shown).toEqual({ sketches: 0, planes: 0 });
  // L'esquisse choisie dans l'historique reste visible.
  await history.locator('.feature-main', { hasText: 'Esquisse 2' }).click({ position: { x: 40, y: 12 } });
  await expect.poll(shown).toEqual({ sketches: 1, planes: 0 });
});
