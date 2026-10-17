import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { appState, openApp } from './helpers';

test('sous-assemblage : créé, rempli, puis inséré comme un bloc dans l’assemblage principal', async ({ page }) => {
  await openApp(page);
  const text = readFileSync('tests/fixtures/reference-schema-1.vibecad', 'utf8');
  await page.evaluate((t) => (window as any).vibecad.controller.loadFromText(t, { savedAt: null, dirty: false }), text);
  await page.click('#tab-assembly');
  await expect.poll(() => appState(page, (s) => s.doc.assembly.instances.length)).toBe(2);

  // Nouveau sous-assemblage : il s'ouvre, vide.
  await page.click('#as-new-sub');
  await expect(page.locator('#as-context')).toHaveValue(/sa-/);
  await expect(page.getByText('Vous modifiez le sous-assemblage')).toBeVisible();
  await page.locator('#as-sub-name').fill('Bloc plaque');
  await page.locator('#as-sub-name').press('Enter');
  await page.click('#as-insert');
  await page.getByRole('menuitem', { name: 'Pièce 1' }).click();
  await expect.poll(() => appState(page, (s) => s.doc.assembly.instances.length)).toBe(1);

  // Retour au principal : ses deux plaques sont là ; on insère le bloc.
  await page.getByRole('button', { name: 'Revenir à l’assemblage principal' }).click();
  await expect.poll(() => appState(page, (s) => [s.doc.editingSubassembly ?? null, s.doc.assembly.instances.length])).toEqual([null, 2]);
  await page.click('#as-insert');
  await page.getByRole('menuitem', { name: 'Sous-assemblage : Bloc plaque' }).click();
  await expect.poll(() => appState(page, (s) => s.doc.assembly.instances.at(-1).subassemblyId)).toMatch(/sa-/);
  await expect(page.getByRole('list', { name: 'Pièces de l’assemblage' })).toContainText('bloc : sous-assemblage « Bloc plaque »');
  expect(await page.evaluate(() => (window as any).vibecad.controller.assemblyLeaves().map((l: any) => l.name))).toEqual(['Plaque', 'Plaque (2)', 'Bloc plaque › Pièce 1']);

  // Un bloc inséré ne peut pas être supprimé ; ouvrir et refermer ne marque pas le projet modifié.
  await page.locator('#as-context').selectOption({ label: 'Sous-assemblage : Bloc plaque' });
  await page.getByRole('button', { name: /Supprimer le sous-assemblage/ }).click();
  await expect(page.getByText(/est inséré dans l’assemblage principal/)).toBeVisible();
  await page.locator('#as-context').selectOption('');
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
  await page.getByRole('list', { name: 'Pièces de l’assemblage' }).getByText('Charnière').click();
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
