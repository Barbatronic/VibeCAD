import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { readGlb } from '../../src/io/gltf';
import { readZip } from '../../src/io/zip';
import { openExport,
  appState,
  buildPlateViaUi,
  clickSketch,
  expectVolume,
  finishSketch,
  moveSketch,
  openApp,
  openFileMenu,
  PLATE_VOLUME,
  session,
  WIDE_PLATE_VOLUME,
} from './helpers';

async function exportStep(page: Page, file: string): Promise<string> {
  const dialog = await openExport(page, 'STEP');
  await expect(dialog).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Exporter' }).click()]);
  await download.saveAs(file);
  return readFileSync(file, 'utf8');
}

test('enregistrer dans le navigateur, recharger, puis modifier la première esquisse', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);
  await page.getByRole('textbox', { name: 'Nom du projet' }).fill('Ma plaque');
  await page.getByRole('textbox', { name: 'Nom du projet' }).press('Enter');
  await page.keyboard.press('Control+s');
  await expect(page.getByText(/Projet enregistré/)).toBeVisible();
  await expect(page.getByText(/Enregistré à/)).toBeVisible();

  await page.reload();
  await page.waitForFunction(() => (window as any).vibecad?.store?.get().kernel.status === 'ready');
  await expect(page.getByRole('textbox', { name: 'Nom du projet' })).toHaveValue('Ma plaque');
  await expectVolume(page, PLATE_VOLUME);
  const history = page.getByRole('list', { name: /Étapes de construction/ });
  await expect(history.getByRole('listitem')).toHaveCount(4);

  await history.locator('.feature-main', { hasText: 'Esquisse 1' }).dblclick();
  await expect.poll(() => appState(page, (s) => s.mode.kind)).toBe('sketch');
  await page.waitForTimeout(450);
  await page.locator('.vp-dim', { hasText: '60 mm' }).dblclick();
  const input = page.getByRole('dialog', { name: 'Modifier la cote' }).getByLabel('Valeur de la cote en millimètres');
  await input.fill('80');
  await input.press('Enter');
  await finishSketch(page);
  await expectVolume(page, WIDE_PLATE_VOLUME);
});

test('exporter en STEP, importer le fichier dans un nouveau projet et le retrouver après rechargement', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);
  const step = await exportStep(page, 'tests/output/e2e-export.step');
  expect(step).toMatch(/^ISO-10303-21;/);
  expect(step).toMatch(/SI_UNIT\(\.MILLI\.,\.METRE\.\)/);
  expect(step).toMatch(/PRODUCT\('Pièce 1'/);

  // Nouveau projet sans enregistrer l'actuel.
  await openFileMenu(page);
  await page.getByRole('menuitem', { name: 'Nouveau projet' }).click();
  await page.getByRole('button', { name: 'Ne pas enregistrer' }).click();
  await expect.poll(() => appState(page, (s) => s.doc.parts[0].features.length)).toBe(0);

  // Import du fichier STEP exporté.
  await openFileMenu(page);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('menuitem', { name: /Importer un fichier/ }).click()]);
  await chooser.setFiles('tests/output/e2e-export.step');
  const dialog = page.getByRole('dialog', { name: /Importer/ });
  await expect(dialog.getByText(/1 solide trouvé/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Importer' }).click();
  await expectVolume(page, PLATE_VOLUME, 1);
  await expect(page.locator('.feature-main', { hasText: 'e2e-export' })).toBeVisible();

  // Le contenu importé est embarqué : il reste disponible après enregistrement et rechargement.
  await page.keyboard.press('Control+s');
  await expect(page.getByText(/Projet enregistré/)).toBeVisible();
  await page.reload();
  await page.waitForFunction(() => (window as any).vibecad?.store?.get().kernel.status === 'ready');
  await expectVolume(page, PLATE_VOLUME, 1);
  const resources = await appState(page, (s) => Object.values(s.doc.resources).map((r: any) => [r.fileName, r.byteLength > 1000]));
  expect(resources).toEqual([['e2e-export.step', true]]);
});

test('deux pièces nommées, masquées et exportées séparément', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);

  // Seconde pièce : un bloc 15 × 15 × 10 posé à côté de la plaque.
  await page.click('#part-add');
  await page.getByRole('button', { name: 'Renommer « Pièce 2 »' }).click();
  await page.getByRole('textbox', { name: 'Nouveau nom de la pièce' }).fill('Cale');
  await page.getByRole('textbox', { name: 'Nouveau nom de la pièce' }).press('Enter');
  await page.click('#tool-sketch');
  await page.getByRole('button', { name: /Plan XY/ }).click();
  await expect.poll(async () => (await session(page))?.tool).toBe('rectangle');
  await page.waitForTimeout(450);
  await clickSketch(page, 70, 0);
  await moveSketch(page, 80, 10);
  await page.keyboard.type('15');
  await page.keyboard.press('Tab');
  await page.keyboard.type('15');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await session(page))?.sketch.entities.length).toBe(12);
  await finishSketch(page);
  await page.click('#tool-extrude');
  await page.locator('#draft-distance').fill('10');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, 15 * 15 * 10, 1);

  // Masquer la plaque.
  await page.getByRole('button', { name: 'Masquer « Pièce 1 »' }).click();
  await expect.poll(() => appState(page, (s) => s.doc.parts.map((p: any) => p.visible))).toEqual([false, true]);

  // Exporter seulement la cale.
  const dialog = await openExport(page, 'STEP');
  await dialog.getByRole('checkbox').first().uncheck();
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Exporter' }).click()]);
  await download.saveAs('tests/output/e2e-cale.step');
  const text = readFileSync('tests/output/e2e-cale.step', 'utf8');
  expect(text).toMatch(/PRODUCT\('Cale'/);
  expect(text).not.toMatch(/PRODUCT\('Pièce 1'/);

  // Exporter les deux pièces en 3MF (impression 3D) : un objet nommé par pièce.
  const dialog3mf = await openExport(page, '3MF');
  for (const box of await dialog3mf.getByRole('checkbox').all()) await box.check();
  const [download3mf] = await Promise.all([page.waitForEvent('download'), dialog3mf.getByRole('button', { name: 'Exporter' }).click()]);
  expect(download3mf.suggestedFilename()).toMatch(/\.3mf$/);
  await download3mf.saveAs('tests/output/e2e-assemblage.3mf');
  const files = await readZip(new Uint8Array(readFileSync('tests/output/e2e-assemblage.3mf')));
  const model = new TextDecoder().decode(files.get('3D/3dmodel.model'));
  expect(model).toContain('unit="millimeter"');
  expect(model).toContain('name="Cale"');
  expect(model).toContain('name="Pièce 1"');
});

test('exporter en GLB (3D pour le web) : un maillage coloré par pièce, en mètres', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);
  await expectVolume(page, PLATE_VOLUME);
  const dialog = await openExport(page, 'GLB');
  await expect(dialog).toContainText('montrer');
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Exporter' }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.glb$/);
  await download.saveAs('tests/output/e2e-export.glb');
  const { json } = readGlb(new Uint8Array(readFileSync('tests/output/e2e-export.glb')));
  const j = json as any;
  expect(j.meshes).toHaveLength(1);
  expect(j.nodes[1].name).toBe('Pièce 1');
  const max = j.accessors[j.meshes[0].primitives[0].attributes.POSITION].max;
  expect(max.map((v: number) => Math.round(v))).toEqual([60, 30, 5]);
  expect(j.nodes[0].matrix[0]).toBe(0.001);
});
