import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { addFeature, addInstance, addPart, findPart, makePrimitiveFeature } from '../../src/domain/document';
import { parseNativeFile } from '../../src/io/native-format';
import { buildPlateDocument } from '../helpers/plate';
import { appState, clickTool, openApp } from './helpers';

/** Glisse une poignée du manipulateur de `dx`, `dy` pixels. */
async function dragHandle(page: Page, handle: { kind: 'move' | 'rotate'; axis: 'x' | 'y' | 'z' }, dx: number, dy: number) {
  const p = await page.evaluate((h) => (window as any).vibecad.controller.viewport.gizmoClientPoint(h), handle);
  expect(p).not.toBeNull();
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(p.x + (dx * i) / 8, p.y + (dy * i) / 8);
  await page.mouse.up();
}

test('manipulateur dans l’assemblage : déplacer et tourner une pièce libre', async ({ page }) => {
  await openApp(page);
  let { doc } = buildPlateDocument();
  const added = addPart(doc, 'Bloc');
  doc = added.doc;
  const box = makePrimitiveFeature(doc, findPart(doc, added.partId)!, 'box');
  doc = addFeature(doc, added.partId, { ...box, params: { ...box.params, width: 20, depth: 20, height: 10 } });
  doc = addInstance(doc, doc.parts[0]!.id, { x: 0, y: 0, z: 0 }).doc;
  const bloc = addInstance(doc, added.partId, { x: 80, y: 0, z: 0 });
  doc = bloc.doc;
  await page.evaluate((d) => (window as any).vibecad.controller.commit(d, 'Projet'), doc as any);
  await expect.poll(() => appState(page, (s) => s.doc.parts.every((p: any) => s.display[p.id]?.mesh))).toBe(true);
  await page.click('#tab-assembly');
  await page.evaluate((id) => (window as any).vibecad.controller.selectInAssembly({ kind: 'instance', id }), bloc.instanceId);
  await page.evaluate(() => (window as any).vibecad.controller.fitAll());
  await page.waitForTimeout(700);
  const inst = () => appState(page, (s) => s.doc.assembly.instances[1]);

  // Flèche X : la pièce avance d'un nombre entier de millimètres, en une seule étape d'annulation.
  const undoBefore = await appState(page, (s) => s.history.past.length);
  await dragHandle(page, { kind: 'move', axis: 'x' }, 60, 0);
  const moved = await inst();
  expect(moved.position.x).not.toBe(80);
  expect(Number.isInteger(moved.position.x)).toBe(true);
  expect(await appState(page, (s) => s.history.past.length)).toBe(undoBefore + 1);

  // Anneau Z : rotation par pas de 15°, autour du centre de la pièce.
  await dragHandle(page, { kind: 'rotate', axis: 'z' }, -40, 50);
  const turned = await inst();
  expect(turned.rotation?.z).toBeTruthy();
  expect(Math.round(turned.rotation.z) % 15).toBe(0);
  await page.screenshot({ path: 'tests/output/e2e-manipulateur.png' });

  // Champs du panneau : orientation saisie au clavier ; la pièce tourne sur elle-même (centre fixe).
  const center = () => page.evaluate((id) => (window as any).vibecad.controller.instanceCenter(id), bloc.instanceId);
  const c0 = await center();
  await page.getByLabel('Rotation autour de X').fill('90');
  await expect.poll(async () => (await inst()).rotation?.x).toBe(90);
  const c1 = await center();
  for (const k of ['x', 'y', 'z'] as const) expect(c1[k]).toBeCloseTo(c0[k], 4);
});

test('manipulateur de l’étape « Déplacer » : la flèche règle le décalage, les champs suivent', async ({ page }) => {
  await openApp(page);
  await page.click('#tool-primitive');
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expect.poll(() => appState(page, (s) => s.display[s.doc.parts[0].id]?.mesh)).toBeTruthy();
  await clickTool(page, 'tool-move');
  await expect.poll(() => page.evaluate(() => (window as any).vibecad.controller.viewport.gizmoClientPoint({ kind: 'move', axis: 'y' }))).not.toBeNull();
  await dragHandle(page, { kind: 'move', axis: 'y' }, 40, -40);
  const ty = await appState(page, (s) => s.mode.draft.feature.params.translation.y);
  expect(ty).not.toBe(0);
  await expect(page.locator('#draft-ty')).toHaveValue(String(ty).replace('.', ','));
});

test('liaisons renommées depuis leur panneau', async ({ page }) => {
  await openApp(page);
  const parsed = parseNativeFile(readFileSync('tests/fixtures/mechanism-arm.vibecad', 'utf8'));
  await page.evaluate((d) => (window as any).vibecad.controller.commit(d, 'Bras'), (parsed as any).doc);
  await page.click('#tab-assembly');
  await page.evaluate(() => (window as any).vibecad.controller.selectInAssembly({ kind: 'joint', id: 'pivot' }));
  const name = page.getByLabel('Nom de la liaison');
  await name.fill('Épaule');
  await name.press('Enter');
  await expect.poll(() => appState(page, (s) => s.doc.assembly.joints[0].name)).toBe('Épaule');
  await expect(page.getByRole('list', { name: 'Liaisons de l’assemblage' })).toContainText('Épaule');
});
