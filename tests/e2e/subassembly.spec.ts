import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { appState, openApp } from './helpers';

test('sous-assemblage : créé, rempli, puis inséré comme un bloc dans l’assemblage principal', async ({ page }) => {
  await openApp(page);
  const text = readFileSync('tests/fixtures/reference-schema-1.vibecad', 'utf8');
  await page.evaluate((t) => (window as any).vibecad.controller.loadFromText(t, { savedAt: null, dirty: false }), text);
  await page.click('#tab-assembly');
  await expect.poll(() => appState(page, (s) => s.doc.assembly.instances.length)).toBe(2);

  // Nouvel ensemble vide (en-tête de l'arbre) : il s'ouvre, vide, et se nomme tout de suite.
  await page.click('#as-new-sub');
  await expect.poll(() => appState(page, (s) => s.doc.editingSubassembly ?? null)).toMatch(/sa-/);
  const rename = page.getByRole('textbox', { name: 'Nouveau nom de l’ensemble' });
  await rename.fill('Bloc plaque');
  await rename.press('Enter');
  await expect(page.locator('.level-bar')).toContainText('Bloc plaque');
  await page.click('#as-insert');
  await page.getByRole('menuitem', { name: 'Pièce 1' }).click();
  await expect.poll(() => appState(page, (s) => s.doc.assembly.instances.length)).toBe(1);

  // Retour au principal (fil de l'arbre) : ses deux plaques sont là ; on insère le bloc.
  await page.click('#as-back');
  await expect.poll(() => appState(page, (s) => [s.doc.editingSubassembly ?? null, s.doc.assembly.instances.length])).toEqual([null, 2]);
  await page.click('#as-insert');
  await page.getByRole('menuitem', { name: 'Sous-assemblage : Bloc plaque' }).click();
  await expect.poll(() => appState(page, (s) => s.doc.assembly.instances.at(-1).subassemblyId)).toMatch(/sa-/);
  const tree = page.locator('.part-list');
  await expect(tree.locator('.folder-row.is-ensemble', { hasText: 'Bloc plaque' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).vibecad.controller.assemblyLeaves().map((l: any) => l.name))).toEqual(['Plaque', 'Plaque (2)', 'Bloc plaque › Pièce 1']);

  // La pièce posée dans l'ensemble ET dans le principal : ses exemplaires des deux niveaux sont
  // sous sa ligne ; choisir celui de l'ensemble ouvre l'ensemble, le fil ramène au principal.
  const row = tree.locator('.part-row:not(.copy-row)', { hasText: 'Pièce 1' });
  if ((await row.locator('.copies-toggle').getAttribute('aria-expanded')) !== 'true') await row.locator('.copies-toggle').click();
  await expect(tree.locator('.copy-row', { hasText: /^Plaque.*principal/ })).toHaveCount(2);
  await tree.locator('.copy-row', { hasText: /^Pièce 1/ }).first().locator('.part-select').click();
  await expect.poll(() => appState(page, (s) => s.doc.editingSubassembly ?? null)).toMatch(/sa-/);
  await page.click('#as-back');
  await expect.poll(() => appState(page, (s) => s.doc.subassemblies.length)).toBe(1);
  await page.screenshot({ path: 'tests/output/e2e-sous-assemblage.png' });
});

test('bloc souple : le pivot du bloc se règle à cette insertion, sans changer le sous-assemblage', async ({ page }) => {
  await openApp(page);
  const file = JSON.parse(readFileSync('tests/fixtures/reference-schema-1.vibecad', 'utf8'));
  const doc = file.document;
  // Le sous-assemblage reprend l'assemblage de référence (deux plaques en pivot à 30°), inséré une fois.
  doc.subassemblies = [{ ...doc.assembly, id: 'sa-1', name: 'Charnière', fasteners: [] }];
  doc.assembly = { instances: [{ id: 'in-b', partId: '', subassemblyId: 'sa-1', name: 'Charnière', position: { x: 0, y: 0, z: 0 } }], joints: [] };
  await page.evaluate((t) => (window as any).vibecad.controller.loadFromText(t, { savedAt: null, dirty: false }), JSON.stringify(file));
  await page.click('#tab-assembly');
  // L'insertion du bloc, sous la ligne de son ensemble dans l'arbre.
  await page.locator('.part-list .copy-row', { hasText: 'Charnière' }).locator('.part-select').click();
  await page.locator('#as-block-flexible').check();
  const angle = page.getByLabel('Angle exact');
  await expect(angle).toHaveValue('30');
  await angle.fill('75');
  await expect.poll(() => appState(page, (s) => s.doc.assembly.instances[0].jointValues)).toEqual({ 'jt-1': { angle: 75, offset: 0 } });
  // Le sous-assemblage lui-même garde son réglage.
  expect(await appState(page, (s) => s.doc.subassemblies[0].joints[0].angle)).toBe(30);
  // Rigide à nouveau : les réglages propres sont oubliés.
  await page.locator('#as-block-flexible').uncheck();
  await expect.poll(() => appState(page, (s) => s.doc.assembly.instances[0].jointValues ?? null)).toBe(null);
});

test('importer un autre projet comme sous-assemblage, puis l’insérer', async ({ page }) => {
  await openApp(page);
  await page.evaluate((t) => (window as any).vibecad.controller.loadFromText(t, { savedAt: null, dirty: false }), readFileSync('tests/fixtures/reference-schema-1.vibecad', 'utf8'));
  await page.click('#tab-assembly');
  await page.click('#as-insert');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('menuitem', { name: /Importer un projet comme sous-assemblage/ }).click()]);
  await chooser.setFiles('tests/fixtures/reference-schema-1.vibecad');
  await expect(page.getByText(/est maintenant un sous-assemblage/)).toBeVisible();
  expect(await appState(page, (s) => s.doc.parts.length)).toBe(2);
  const name = await appState(page, (s) => s.doc.subassemblies.at(-1).name);
  await page.click('#as-insert');
  await page.getByRole('menuitem', { name: `Sous-assemblage : ${name}` }).click();
  await expect.poll(() => page.evaluate(() => (window as any).vibecad.controller.assemblyLeaves().length)).toBe(4);
});
