import { addFeature, addPart, findPart, makeFilletFeature, makePrimitiveFeature } from '../../src/domain/document';
import { serializeDocument } from '../../src/io/native-format';
import { buildPlateDocument, topFrontEdge } from '../helpers/plate';
import { expect, test } from '@playwright/test';
import { appState, buildPlateViaUi, clickSketch, expectVolume, finishSketch, moveSketch, openApp, PLATE_VOLUME, session, worldToScreen, clickTool } from './helpers';

test('projeter le bord du trou, cercle concentrique, cote d’angle sur une arête reprise, construction', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);
  await page.waitForTimeout(400);

  // Nouvelle esquisse sur le dessus de la plaque.
  const top = await worldToScreen(page, 45, 22, 5);
  await page.mouse.dblclick(top.x, top.y);
  await expect.poll(async () => (await session(page))?.sketch.support.kind).toBe('face');
  await page.waitForTimeout(450);

  // Projeter : le bord du trou (cercle Ø 6 centré en 15, 15) et le bord avant de la plaque.
  await clickTool(page, 'sk-project');
  // Les arêtes à reprendre peuvent arriver juste après le choix de l'outil : survoler à nouveau.
  await expect
    .poll(async () => {
      await moveSketch(page, 18 + Math.random() * 0.01, 15);
      return (await session(page))?.projectHover;
    })
    .not.toBeNull();
  await page.screenshot({ path: 'tests/output/e2e-projeter.png' });
  await clickSketch(page, 18, 15);
  await clickSketch(page, 30, 0);
  await expect.poll(async () => (await session(page))?.sketch.entities.filter((e: any) => e.reference).length).toBe(2);

  // Cercle Ø 10 accroché au centre du trou repris : il est entièrement contraint.
  await page.click('#sk-circle');
  await clickSketch(page, 15, 15);
  await page.keyboard.type('10');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await session(page))?.dof).toBe(0);

  // Segment de construction (touche G), puis cote d'angle avec le bord avant repris.
  await page.keyboard.press('g');
  await expect.poll(async () => (await session(page))?.construction).toBe(true);
  await page.click('#sk-line');
  await clickSketch(page, 40, 6);
  await clickSketch(page, 52, 14);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await session(page))?.sketch.entities.filter((e: any) => e.construction).length).toBe(1);
  await page.click('#sk-dimension');
  await clickSketch(page, 46, 10);
  await expect(page.getByRole('dialog', { name: 'Nouvelle cote' })).toBeVisible();
  await clickSketch(page, 25, 0);
  const editor = page.getByRole('dialog', { name: 'Nouvelle cote' });
  await expect(editor.getByLabel('Valeur de l’angle en degrés')).toBeVisible();
  await editor.getByLabel('Valeur de l’angle en degrés').fill('30');
  await page.screenshot({ path: 'tests/output/e2e-cote-angle.png' });
  await editor.getByLabel('Valeur de l’angle en degrés').press('Enter');
  await expect.poll(async () => (await session(page))?.sketch.constraints.some((c: any) => c.type === 'angle' && c.value === 30)).toBe(true);

  // Contraintes moins courantes : sorties sur grand écran, sinon dans le menu du secteur.
  await clickTool(page, 'sk-parallel');
  await expect.poll(async () => (await session(page))?.tool).toBe('parallel');
  await page.keyboard.press('Escape');

  // Extrusion : seul le disque Ø 10 compte (le segment de construction et les arêtes reprises non).
  await finishSketch(page);
  await page.click('#tool-extrude');
  await page.locator('#draft-distance').fill('2');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, PLATE_VOLUME + Math.PI * 25 * 2);
  await page.screenshot({ path: 'tests/output/e2e-bossage.png' });
});

test('les axes X et Y servent de référence : cote d’un cercle depuis l’axe Y, segment parallèle à l’axe X', async ({ page }) => {
  await openApp(page);
  await page.click('#tool-sketch');
  await page.getByRole('button', { name: /Plan XY/ }).click();
  await expect.poll(async () => (await session(page))?.tool).toBe('rectangle');
  await page.waitForTimeout(450);

  await page.click('#sk-circle');
  await clickSketch(page, 20, 10);
  await clickSketch(page, 24, 10);
  await page.keyboard.press('Escape');

  // Cote : l'axe Y (loin de l'origine), puis le cercle.
  await page.click('#sk-dimension');
  await moveSketch(page, 0, 15);
  await expect.poll(async () => (await session(page))?.hover?.id).toBe('axis-y');
  await clickSketch(page, 0, 15);
  await expect.poll(async () => (await session(page))?.picks).toEqual(['axis-y']);
  await clickSketch(page, 24, 10);
  const editor = page.getByRole('dialog', { name: 'Nouvelle cote' });
  await expect(editor).toBeVisible();
  await page.screenshot({ path: 'tests/output/e2e-cote-axe.png' });
  await editor.getByRole('textbox').first().fill('35');
  await editor.getByRole('textbox').first().press('Enter');
  await expect.poll(async () => (await session(page))?.sketch.constraints.some((c: any) => c.type === 'pointLineDistance' && c.line === 'axis-y' && c.value === 35)).toBe(true);
  await expect.poll(async () => (await session(page))?.sketch.entities.find((e: any) => e.type === 'point' && Math.abs(e.x - 35) < 1e-6)).toBeTruthy();

  // Segment incliné rendu parallèle à l'axe X.
  await page.keyboard.press('Escape');
  await page.click('#sk-line');
  await clickSketch(page, 5, -10);
  await clickSketch(page, 25, -4);
  await page.keyboard.press('Escape');
  await clickTool(page, 'sk-parallel');
  await clickSketch(page, 15, -7);
  await clickSketch(page, 45, 0);
  await expect.poll(async () => (await session(page))?.sketch.constraints.some((c: any) => c.type === 'parallel' && c.b === 'axis-x')).toBe(true);
});

test('un clic sur un axe y relie le point : le repère l’annonce et le dessin reste extrudable', async ({ page }) => {
  await openApp(page);
  await page.click('#tool-sketch');
  await page.getByRole('button', { name: /Plan XY/ }).click();
  await expect.poll(async () => (await session(page))?.tool).toBe('rectangle');
  await page.waitForTimeout(450);

  // Rectangle : un coin sur l'axe X, le coin opposé sur l'axe Y.
  await moveSketch(page, 30, 0);
  await expect(page.locator('.vp-tag-snap', { hasText: 'Axe X' })).toBeVisible();
  await page.screenshot({ path: 'tests/output/e2e-accroche-axe.png' });
  await clickSketch(page, 30, 0);
  await clickSketch(page, 0, 20);
  await expect
    .poll(async () => (await session(page))?.sketch.constraints.filter((c: any) => c.type === 'pointOn').map((c: any) => c.curve).sort())
    .toEqual(['axis-x', 'axis-y']);

  // Le lien tient : une cote de largeur garde le coin sur l'axe X.
  await page.click('#sk-dimension');
  await clickSketch(page, 15, 0);
  await page.getByRole('dialog', { name: 'Nouvelle cote' }).getByRole('textbox').first().fill('40');
  await page.getByRole('dialog', { name: 'Nouvelle cote' }).getByRole('textbox').first().press('Enter');
  await expect.poll(async () => (await session(page))?.message?.kind).not.toBe('error');
  await expect.poll(async () => (await session(page))?.sketch.entities.filter((e: any) => e.type === 'point').every((e: any) => e.x > -1e-6 && e.y > -1e-6)).toBe(true);
  await page.screenshot({ path: 'tests/output/e2e-accroche-axe-cote.png' });

  await finishSketch(page);
  await page.click('#tool-extrude');
  await page.locator('#draft-distance').fill('5');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, 40 * 20 * 5);
});

test('projeter : les arêtes de la pièce avant l’esquisse, même arrondies par un congé ajouté après', async ({ page }) => {
  const { doc: base, ids } = buildPlateDocument();
  const doc = addFeature(base, ids.partId, makeFilletFeature(base, findPart(base, ids.partId)!, [topFrontEdge(base, ids.sketch1, ids.extrude)], 3));
  await openApp(page);
  await page.evaluate((t) => (window as any).vibecad.controller.loadFromText(t, { savedAt: null, dirty: false }), serializeDocument(doc));
  await expect.poll(() => appState(page, (s) => !!s.display[s.doc.parts[0].id]?.mesh)).toBe(true);
  const history = page.getByRole('list', { name: /Étapes de construction/ });
  await history.locator('.feature-main', { hasText: 'Esquisse 2' }).dblclick();
  await expect.poll(() => appState(page, (s) => s.mode.kind)).toBe('sketch');
  await clickTool(page, 'sk-project');
  // L'arête avant du dessus (y = 0, entre le dessus et la face avant) est proposée, entière.
  await expect
    .poll(async () => {
      const s = await session(page);
      return s.projectable.filter((c: any) => c.kind === 'line' && Math.abs(c.a.y) < 1e-6 && Math.abs(c.b.y) < 1e-6 && c.ref.faces.some((f: any) => f.role === 'end')).length;
    })
    .toBe(1);
  // La vue montre la pièce à ce point de l'historique (sans le congé ni la poche), l'historique est grisé après l'esquisse.
  const shownKey = () => page.evaluate(() => (window as any).vibecad.controller.viewport.input.parts[0]?.meshKey as string | null);
  await expect.poll(shownKey).toMatch(/^avant\|/);
  await expect(history.locator('.feature-row.is-rolled-back')).toHaveCount(2);
  await page.screenshot({ path: 'tests/output/e2e-esquisse-avant.png' });
  // Esquisse refermée : la pièce terminée revient.
  await page.getByRole('button', { name: 'Annuler', exact: true }).click();
  await expect.poll(shownKey).not.toMatch(/^avant\|/);
  await expect(history.locator('.feature-row.is-rolled-back')).toHaveCount(0);
});

test('projeter dans une pièce isolée : seules ses arêtes sont proposées (les autres pièces sont cachées)', async ({ page }) => {
  const { doc: base, ids } = buildPlateDocument();
  // Seconde pièce : un pavé posé à côté de la plaque.
  const added = addPart(base, 'Pavé');
  const box = makePrimitiveFeature(added.doc, findPart(added.doc, added.partId)!);
  const doc = addFeature(added.doc, added.partId, { ...box, params: { ...box.params, position: { x: 70, y: 0, z: 0 }, width: 20, depth: 20, height: 5 } });
  await openApp(page);
  await page.evaluate((t) => (window as any).vibecad.controller.loadFromText(t, { savedAt: null, dirty: false }), serializeDocument(doc));
  await expect.poll(() => appState(page, (s) => s.doc.parts.every((p: any) => s.display[p.id]?.mesh))).toBe(true);
  const fromOthers = async () => ((await session(page))?.projectable ?? []).filter((c: any) => c.partId).length;
  const history = page.getByRole('list', { name: /Étapes de construction/ });
  // Sans isolement : les arêtes du pavé sont proposées aussi.
  await page.evaluate((id) => (window as any).vibecad.controller.setActivePart(id), ids.partId);
  await history.locator('.feature-main', { hasText: 'Esquisse 2' }).dblclick();
  await clickTool(page, 'sk-project');
  await expect.poll(fromOthers).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Annuler', exact: true }).click();
  await expect.poll(() => appState(page, (s) => s.mode.kind)).toBe('model');
  // Plaque isolée : le pavé est caché, ses arêtes ne sont plus proposées.
  await page.evaluate((id) => (window as any).vibecad.controller.toggleIsolate(id), ids.partId);
  await history.locator('.feature-main', { hasText: 'Esquisse 2' }).dblclick();
  await clickTool(page, 'sk-project');
  await expect.poll(async () => ((await session(page))?.projectable ?? []).length).toBeGreaterThan(0);
  expect(await fromOthers()).toBe(0);
});
