import { expect, test } from '@playwright/test';
import { addFeature, findPart, makePlaneFeature, makePocketFeature, makeSketchFeature } from '../../src/domain/document';
import { serializeDocument } from '../../src/io/native-format';
import { buildPlateDocument, holeSketch } from '../helpers/plate';
import { appState, buildPlateViaUi, expectVolume, openApp, clickTool } from './helpers';

const PLATE = 9000 - Math.PI * 9 * 5;

test('symétrie : reflet de toute la pièce par rapport à YZ, puis à XY', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);
  await expectVolume(page, PLATE);

  await clickTool(page, 'tool-mirror');
  await expect(page.getByRole('group', { name: 'Copier' }).getByRole('button', { name: 'Toute la pièce' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, 2 * PLATE);
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'tests/output/e2e-symetrie.png' });
  // Le secteur montre la symétrie : son bouton à lui, ou (secteur replié) le dernier outil utilisé.
  await expect(page.locator('.sector', { hasText: 'Répéter' }).getByRole('button', { name: /Symétrie/ }).locator('visible=true').first()).toBeVisible();

  const history = page.getByRole('list', { name: /Étapes de construction/ });
  await history.locator('.feature-main', { hasText: 'Symétrie 1' }).dblclick();
  await page.getByRole('group', { name: 'Plan de symétrie (le miroir)' }).getByRole('button', { name: 'XY' }).click();
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, 2 * PLATE);
  expect(await appState(page, (s) => s.doc.parts[0].features.at(-1).params.plane)).toEqual({ kind: 'plane', plane: 'XY' });
});

/** Plaque percée de deux trous (Ø 6 en (15, 15), Ø 4 en (8, 8)) et un plan de construction à x = 30. */
function twoHolesDocument(): string {
  const { doc: base, ids } = buildPlateDocument();
  let doc = base;
  const part = () => findPart(doc, ids.partId)!;
  const sk = makeSketchFeature(doc, part(), { kind: 'face', ref: { featureId: ids.extrude, role: 'end' } });
  doc = addFeature(doc, ids.partId, { ...sk, params: holeSketch(sk.params, 8, 8, 4) });
  doc = addFeature(doc, ids.partId, makePocketFeature(doc, part(), sk.id, { kind: 'throughAll' }));
  const plane = makePlaneFeature(doc, part());
  doc = addFeature(doc, ids.partId, { ...plane, params: { base: { kind: 'plane', plane: 'YZ' }, offset: 30, angle: 0, hinge: { kind: 'axis', axis: 'X' } } });
  return serializeDocument(doc);
}

test('symétrie de plusieurs étapes à la fois : les deux trous reflétés en une seule symétrie', async ({ page }) => {
  await openApp(page);
  await page.evaluate((t) => (window as any).vibecad.controller.loadFromText(t, { savedAt: null, dirty: false }), twoHolesDocument());
  const holes = Math.PI * 9 * 5 + Math.PI * 4 * 5;
  await expectVolume(page, 9000 - holes);
  await clickTool(page, 'tool-mirror');
  await page.getByRole('group', { name: 'Copier' }).getByRole('button', { name: 'Des étapes' }).click();
  const steps = page.getByRole('group', { name: 'Étapes à reproduire' });
  // La dernière étape est cochée d'office ; on coche aussi la première poche.
  await expect(steps.getByRole('checkbox', { name: 'Poche 2' })).toBeChecked();
  await steps.getByRole('checkbox', { name: 'Poche 1' }).check();
  await page.getByRole('group', { name: 'Plan de symétrie (le miroir)' }).getByRole('button', { name: 'Plan…' }).click();
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  // Quatre trous : les deux d'origine et leurs reflets de l'autre côté du plan x = 30.
  await expectVolume(page, 9000 - 2 * holes);
  const source = await appState(page, (s) => s.doc.parts[0].features.at(-1).params.source);
  expect(source.kind).toBe('feature');
  expect(source.extraFeatureIds).toHaveLength(1);
  await page.screenshot({ path: 'tests/output/e2e-symetrie-plusieurs.png' });
});

test('variante symétrique d’une pièce (clic droit dans la liste) : nouvelle pièce, reflet de l’original, qui le suit', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);
  await expectVolume(page, PLATE);
  await page.locator('.part-row', { hasText: 'Pièce 1' }).first().click({ button: 'right', position: { x: 60, y: 12 } });
  await page.getByRole('menuitem', { name: /Variante symétrique/ }).click();
  await expect.poll(() => appState(page, (s) => s.doc.parts.map((p: any) => p.name))).toEqual(['Pièce 1', 'Pièce 1 (symétrique)']);
  const variant = () => appState(page, (s) => s.display[s.doc.parts[1].id]?.result.analysis);
  await expect.poll(async () => Math.round((await variant())?.volume ?? 0)).toBe(Math.round(PLATE));
  await expect.poll(async () => Math.round((await variant())?.bbox.min.x ?? 0)).toBe(-60);
  // Le plan du miroir se change dans l'étape de la variante.
  await expect(page.getByRole('list', { name: /Étapes de construction/ })).toContainText('Variante symétrique');
});
