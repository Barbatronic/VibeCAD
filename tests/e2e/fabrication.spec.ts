import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { readZip } from '../../src/io/zip';
import { appState, buildPlateViaUi, openApp, openFileMenu } from './helpers';

/** Centre écran de la face du dessus (z = 5 avant orientation) d'un exemplaire sur le plateau. */
async function topFaceOnScreen(page: Page, copy: number): Promise<{ x: number; y: number }> {
  const box = (await page.locator('.vp-canvas').boundingBox())!;
  const p = await page.evaluate((k) => {
    const c = (window as any).vibecad.controller;
    const key = [...c.viewport.parts.keys()].find((x: string) => x.endsWith(`:${k}`));
    const part = c.viewport.parts.get(key);
    const v = c.viewport.rig.camera.position.clone().set(45, 22, 5).applyMatrix4(part.group.matrix).project(c.viewport.rig.camera);
    return { x: ((v.x + 1) / 2) * c.viewport.width, y: ((1 - v.y) / 2) * c.viewport.height };
  }, copy);
  return { x: box.x + p.x, y: box.y + p.y };
}

test('fabrication : deux exemplaires posés sur leur face du dessus, export du plateau en 3MF', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);
  await page.click('#tab-fabrication');
  await expect(page.getByRole('list', { name: 'Pièces à imprimer' })).toBeVisible();
  await page.getByLabel('Exemplaires de « Pièce 1 »').fill('2');
  await expect.poll(() => page.evaluate(() => (window as any).vibecad.controller.printLayout().placements.length)).toBe(2);
  await page.waitForTimeout(500);

  // Retourner la pièce : face du dessus sur le plateau.
  await page.getByRole('button', { name: 'Face du dessous' }).click();
  const top = await topFaceOnScreen(page, 0);
  await page.mouse.click(top.x, top.y);
  await expect.poll(() => appState(page, (s) => !!s.doc.fabrication?.print.items[0]?.downFace)).toBe(true);
  await page.screenshot({ path: 'tests/output/e2e-fabrication-plateau.png' });

  await openFileMenu(page);
  await page.keyboard.press('Escape');
  await page.click('#fab-export-3mf');
  const dialog = page.getByRole('dialog', { name: /3MF/ });
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Exporter' }).click()]);
  expect(download.suggestedFilename()).toMatch(/plateau.*\.3mf$/);
  await download.saveAs('tests/output/e2e-plateau.3mf');
  const model = new TextDecoder().decode((await readZip(new Uint8Array(readFileSync('tests/output/e2e-plateau.3mf')))).get('3D/3dmodel.model'));
  expect((model.match(/<object /g) ?? []).length).toBe(2);
  const zs = Array.from(model.matchAll(/ z="([^"]+)"/g), (m) => Number(m[1]));
  expect(Math.min(...zs)).toBeCloseTo(0, 3);
  expect(Math.max(...zs)).toBeCloseTo(5, 3);
});

test('découpe laser : matériau 5 mm choisi seul, page par matériau, export SVG et DXF à l’échelle 1:1', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);
  await page.click('#tab-fabrication');
  await page.click('#fab-laser');
  await page.getByLabel('Exemplaires à découper de « Pièce 1 »').fill('2');
  await expect.poll(() => page.evaluate(() => (window as any).vibecad.controller.laserLayout().placed.length)).toBe(2);
  // Pièce de 5 mm : matériau « Contreplaqué 5 mm » (préréglé, plaque 300 × 200) choisi automatiquement.
  const tabs = page.getByRole('tablist', { name: 'Matériaux' });
  await expect(tabs.getByRole('tab', { name: /Contreplaqué 5 mm/ })).toHaveAttribute('aria-selected', 'true');
  // Préréglages : contreplaqué et acrylique, 3 et 5 mm.
  await expect(tabs.getByRole('tab')).toHaveCount(4);
  await expect(tabs.getByRole('tab', { name: /Acrylique 3 mm/ })).toBeVisible();
  await expect(tabs.getByRole('tab', { name: /Acrylique 5 mm/ })).toBeVisible();
  await expect(page.locator('.right-panel .callout.warning')).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Aperçu de la plaque 1' })).toBeVisible();
  await page.screenshot({ path: 'tests/output/e2e-laser.png' });

  const [svgDl] = await Promise.all([page.waitForEvent('download'), page.click('#fab-export-svg')]);
  expect(svgDl.suggestedFilename()).toMatch(/laser - Contreplaqué 5 mm\.svg$/);
  await svgDl.saveAs('tests/output/e2e-laser.svg');
  const svg = readFileSync('tests/output/e2e-laser.svg', 'utf8');
  expect(svg).toContain('width="300mm"');
  expect((svg.match(/<polygon /g) ?? []).length).toBe(4);

  const [dxfDl] = await Promise.all([page.waitForEvent('download'), page.click('#fab-export-dxf')]);
  await dxfDl.saveAs('tests/output/e2e-laser.dxf');
  const dxf = readFileSync('tests/output/e2e-laser.dxf', 'utf8');
  expect((dxf.match(/\nPOLYLINE\n/g) ?? []).length).toBe(4);

  // Imposer le 3 mm : avertissement d'épaisseur, la pièce passe sur l'autre page.
  await page.getByLabel('Matériau de « Pièce 1 »').selectOption({ label: 'Contreplaqué 3 mm' });
  await expect(page.locator('.right-panel .callout.warning')).toContainText('Contreplaqué 3 mm');
  // Nouveau matériau, renommé.
  await page.getByRole('button', { name: 'Ajouter un matériau' }).click();
  await expect(tabs.getByRole('tab')).toHaveCount(5);
  await page.getByLabel('Nom du matériau').fill('MDF 3 mm');
  await page.getByLabel('Nom du matériau').press('Enter');
  await expect(tabs.getByRole('tab', { name: /MDF 3 mm/ })).toHaveAttribute('aria-selected', 'true');
});

test('impression 3D : vingt exemplaires répartis sur deux plateaux, export de chaque plateau', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);
  await page.click('#tab-fabrication');
  await page.getByLabel('Exemplaires de « Pièce 1 »').fill('20');
  await expect(page.getByRole('group', { name: 'Plateaux' })).toContainText('Plateau 1 sur 2');
  await expect.poll(() => page.evaluate(() => (window as any).vibecad.controller.viewport.parts.size)).toBe(18);
  await page.getByRole('button', { name: 'Plateau suivant' }).click();
  await expect(page.getByRole('group', { name: 'Plateaux' })).toContainText('Plateau 2 sur 2');
  await expect.poll(() => page.evaluate(() => (window as any).vibecad.controller.viewport.parts.size)).toBe(2);
  await page.screenshot({ path: 'tests/output/e2e-plateaux.png' });

  await page.click('#fab-export-3mf');
  const dialog = page.getByRole('dialog', { name: /3MF/ });
  await expect(dialog.getByRole('radio', { name: 'Plateau 2' })).toBeChecked();
  await dialog.getByRole('radio', { name: /Tous les plateaux/ }).check();
  const downloads: string[] = [];
  page.on('download', (d) => downloads.push(d.suggestedFilename()));
  await dialog.getByRole('button', { name: 'Exporter' }).click();
  await expect.poll(() => downloads.length).toBe(2);
  expect(downloads[0]).toMatch(/plateau 1\.3mf$/);
  expect(downloads[1]).toMatch(/plateau 2\.3mf$/);
});

test('documents : aperçu de la mise en plan, export PDF, gabarit 1:1 et nomenclature CSV', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);
  await page.click('#tab-fabrication');
  await page.click('#fab-docs');
  const preview = page.getByRole('img', { name: 'Mise en plan de « Pièce 1 »' });
  await expect(preview).toBeVisible();
  await expect(preview.locator('text', { hasText: 'Vue de dessus' })).toHaveCount(1);
  await expect(preview.locator('line[stroke-dasharray]').first()).toBeAttached();
  // Les traits cachés exacts (calculés par le noyau) remplacent ceux déduits du maillage.
  await expect.poll(() => page.evaluate(() => (window as any).vibecad.store.get().drawingRevision)).toBeGreaterThan(0);
  await expect(page.getByRole('table', { name: 'Nomenclature' }).locator('tbody tr')).toHaveCount(1);
  await page.screenshot({ path: 'tests/output/e2e-documents.png' });

  const [pdf] = await Promise.all([page.waitForEvent('download'), page.click('#fab-export-drawing')]);
  expect(pdf.suggestedFilename()).toMatch(/mise en plan\.pdf$/);
  await pdf.saveAs('tests/output/e2e-mise-en-plan.pdf');
  const text = readFileSync('tests/output/e2e-mise-en-plan.pdf', 'latin1');
  expect(text.startsWith('%PDF-1.4')).toBe(true);
  expect(text).toContain('/Count 1');
  expect(text).toContain('(60) Tj');

  const [gabarit] = await Promise.all([page.waitForEvent('download'), page.click('#fab-export-template')]);
  expect(gabarit.suggestedFilename()).toMatch(/gabarit\.pdf$/);
  await gabarit.saveAs('tests/output/e2e-gabarit.pdf');
  // A4 portrait : 595,276 × 841,89 points.
  expect(readFileSync('tests/output/e2e-gabarit.pdf', 'latin1')).toContain('/MediaBox [0 0 595.276 841.89]');

  const [csv] = await Promise.all([page.waitForEvent('download'), page.click('#fab-export-bom')]);
  await csv.saveAs('tests/output/e2e-nomenclature.csv');
  const rows = readFileSync('tests/output/e2e-nomenclature.csv', 'utf8').trim().split('\r\n');
  expect(rows).toHaveLength(2);
  expect(rows[1]).toMatch(/^1;Pièce 1;1;60 × 30 × 5;/);
});
