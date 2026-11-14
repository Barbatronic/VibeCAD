import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { appState, buildPlateViaUi, openApp } from './helpers';

/**
 * Onglet Conception : une seule scène et un seul arbre pour Modéliser et Assembler. Arbre des
 * pièces (copies dépliables, yeux, ensembles ouverts depuis l'arbre), bascule entre les deux modes
 * sans recadrage, barre d'avancement à l'ouverture d'un projet.
 */

const camera = (page: Page) =>
  page.evaluate(() => (window as any).vibecad.controller.viewport.rig.camera.position.toArray().map((v: number) => Math.round(v * 1000) / 1000));
const shown = (page: Page) =>
  page.evaluate(() => {
    const c = (window as any).vibecad.controller;
    return c.state.doc.assembly.instances.map((i: any) => c.viewport.parts.get(i.id)?.group.visible);
  });

test('arbre commun : copies, yeux de la pièce et de l’exemplaire, ensemble ouvert depuis l’arbre', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);
  const partId = await appState(page, (s) => s.doc.parts[0].id);
  await page.evaluate((id) => {
    const c = (window as any).vibecad.controller;
    c.duplicatePart(id);
    c.duplicatePart(id);
  }, partId);
  const tree = page.locator('.part-list');
  await expect(tree.locator('.copies')).toHaveText('×3');
  await page.click('#tab-assembly');
  await expect(tree.locator('.copies')).toHaveText('×3');
  await tree.locator('.copies-toggle').click();
  await expect(tree.locator('.copy-row')).toHaveCount(3);
  await expect(tree.locator('.copy-row').first()).toContainText('fixe');

  // Une ligne d'exemplaire le choisit dans l'assemblage.
  const ids = await appState(page, (s) => s.doc.assembly.instances.map((i: any) => i.id));
  await tree.locator('.copy-row').nth(1).locator('.part-select').click();
  await expect.poll(() => appState(page, (s) => s.assemblySelection?.id)).toBe(ids[1]);

  // Œil d'un exemplaire : lui seul ; œil de la pièce : tous ; annuler.
  await tree.locator('.copy-row').nth(2).getByRole('button', { name: /^Masquer/ }).click();
  await expect.poll(() => shown(page)).toEqual([true, true, false]);
  expect(await appState(page, (s) => s.doc.assembly.instances.map((i: any) => !!i.hidden))).toEqual([false, false, true]);
  await tree.getByRole('button', { name: 'Masquer « Pièce 1 » (ses 3 exemplaires)' }).click();
  await expect.poll(() => shown(page)).toEqual([false, false, false]);
  await page.keyboard.press('Control+z');
  await expect.poll(() => shown(page)).toEqual([true, true, false]);

  // Ensemble : choisir un de ses exemplaires l'ouvre ; le fil ramène au principal.
  await page.evaluate((id) => (window as any).vibecad.controller.createEnsemble(id), partId);
  await expect(tree.locator('.folder-row.is-ensemble')).toHaveCount(1);
  if ((await tree.locator('.copy-row', { hasText: 'Pièce 1 (2)' }).count()) === 0) await tree.locator('.copies-toggle').click();
  await tree.locator('.copy-row', { hasText: 'Pièce 1 (2)' }).locator('.part-select').click();
  await expect.poll(() => appState(page, (s) => s.doc.editingSubassembly ?? null)).not.toBe(null);
  await expect(page.locator('.level-bar')).toContainText('Ensemble 1');
  await expect(tree.locator('.folder-row.is-open')).toHaveCount(1);
  await page.click('#as-back');
  await expect.poll(() => appState(page, (s) => s.doc.editingSubassembly ?? null)).toBe(null);
  await expect(page.locator('.level-bar')).toHaveCount(0);
});

test('bascule Modéliser / Assembler : même caméra, la sélection suit, double-clic vers Modéliser', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);
  const partId = await appState(page, (s) => s.doc.parts[0].id);
  await expect(page.locator('#tab-parts')).toHaveAttribute('aria-selected', 'true');
  await page.waitForTimeout(500);
  const before = await camera(page);
  await page.click('#tab-assembly');
  await expect(page.locator('#tab-assembly')).toHaveAttribute('aria-selected', 'true');
  await page.waitForTimeout(500);
  expect(await camera(page)).toEqual(before);
  // La pièce active, posée une fois, est l'exemplaire choisi.
  const first = await appState(page, (s) => s.doc.assembly.instances[0].id);
  await expect.poll(() => appState(page, (s) => s.assemblySelection?.id)).toBe(first);

  // L'exemplaire choisi devient la pièce active, à sa place.
  await page.evaluate((id) => (window as any).vibecad.controller.duplicatePart(id), partId);
  const second = await appState(page, (s) => s.doc.assembly.instances[1].id);
  await page.evaluate((id) => (window as any).vibecad.controller.selectInAssembly({ kind: 'instance', id }), second);
  await page.click('#tab-parts');
  await expect.poll(() => appState(page, (s) => s.assemblyContext?.instanceId)).toBe(second);

  // Double-clic sur une pièce de la vue, en Assembler : Modéliser, sur cet exemplaire.
  await page.click('#tab-assembly');
  await page.waitForTimeout(500);
  const point = await page.evaluate((id) => {
    const c = (window as any).vibecad.controller;
    const p = c.viewport.parts.get(id);
    p.faces.geometry.computeBoundingBox();
    const bb = p.faces.geometry.boundingBox;
    const v = bb.min.clone().set(bb.min.x + (bb.max.x - bb.min.x) * 0.15, bb.min.y + (bb.max.y - bb.min.y) * 0.8, bb.max.z);
    v.applyMatrix4(p.group.matrixWorld).project(c.viewport.rig.camera);
    const r = c.viewport.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }, first);
  await page.mouse.dblclick(point.x, point.y);
  await expect(page.locator('#tab-parts')).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => appState(page, (s) => s.assemblyContext?.instanceId)).toBe(first);
});

test('niveau Débutant : pas de mode Assembler', async ({ page }) => {
  await openApp(page);
  await page.locator('.statusbar select').first().selectOption('debutant');
  await expect(page.locator('#tab-parts')).toBeVisible();
  await expect(page.locator('#tab-assembly')).toHaveCount(0);
});

test('ouverture d’un projet lourd : barre d’avancement jusqu’au bout du calcul', async ({ page }) => {
  // Projet de la bibliothèque, ouvert par le sélecteur de fichiers du système (simulé).
  const text = readFileSync('tests/fixtures/library/bearings/608-2rs.vibecad', 'utf8');
  await page.addInitScript((t) => {
    const handle = { name: 'roulement.vibecad', getFile: async () => new File([t], 'roulement.vibecad'), createWritable: async () => ({ write: async () => {}, close: async () => {} }) };
    (window as any).showOpenFilePicker = async () => [handle];
  }, text);
  await openApp(page);
  await page.keyboard.press('Control+o');
  await page.getByRole('button', { name: /Ouvrir un fichier/ }).click();
  const seen: number[] = [];
  for (let k = 0; k < 400; k++) {
    const o = await appState(page, (s) => s.opening);
    if (!o && seen.length) break;
    if (o) seen.push(o.progress);
    await page.waitForTimeout(20);
  }
  expect(seen.length).toBeGreaterThan(0);
  expect([...seen].sort((a, b) => a - b)).toEqual(seen);
  await expect.poll(() => appState(page, (s) => s.opening)).toBe(null);
  await expect.poll(() => appState(page, (s) => s.display[s.doc.parts[0].id]?.result.analysis?.solidCount)).toBe(1);
});

test('moniteur de charge : pastille de la barre d’état, détail et relevé', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openApp(page);
  await buildPlateViaUi(page);
  const pill = page.locator('.perf-item');
  await expect(pill).toContainText(/ms · \d+ Mo/);
  await expect(pill.locator('.dot')).toHaveCount(1);
  await pill.click();
  const panel = page.getByRole('dialog', { name: 'Moniteur de charge' });
  await expect(panel).toContainText(/Charge : (Normal|Chargé|Trop lourd)/);
  await expect(panel).toContainText('Moteur de calcul');
  await expect(panel).toContainText('Triangles');
  await panel.getByRole('button', { name: 'Copier le relevé' }).click();
  await expect(panel.getByRole('button', { name: 'Relevé copié' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^Relevé de charge VibeCAD/);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
});

test('cache des formes : un projet lourd rouvert reprend ses pièces sans rejouer leur historique', async ({ page }) => {
  test.setTimeout(120_000);
  const text = readFileSync('tests/fixtures/heavy/mg996r.vibecad', 'utf8');
  const open = async () => {
    await page.evaluate((t) => (window as any).vibecad.controller.loadFromText(t, { savedAt: null, dirty: false }), text);
    await expect.poll(() => appState(page, (s) => s.opening), { timeout: 60_000 }).toBe(null);
    return appState(page, (s) => ({ ms: s.lastEvaluation.durationMs, computed: Object.keys(s.display[s.doc.parts[0].id]?.result.stepMs ?? {}).length }));
  };
  await openApp(page);
  await page.evaluate(() => (window as any).vibecad.controller.shapeCache(true));
  const first = await open();
  expect(first.computed).toBe(61);
  // L'instantané s'enregistre quand le calcul est au repos.
  await expect.poll(() => page.evaluate(() => (window as any).vibecad.controller.shapeCache().then((r: any) => r.count)), { timeout: 15_000 }).toBe(1);
  await page.reload();
  await page.waitForFunction(() => (window as any).vibecad?.store?.get().kernel.status === 'ready');
  const second = await open();
  expect(second.computed).toBe(0);
  expect(second.ms).toBeLessThan(first.ms / 3);
  console.log(`MG996R : ${Math.round(first.ms)} ms à froid, ${Math.round(second.ms)} ms depuis le cache`);
});
