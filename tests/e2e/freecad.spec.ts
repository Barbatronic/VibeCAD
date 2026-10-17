import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { buildPlateViaUi, openApp, openExport } from './helpers';

test('export FreeCAD : script qui reconstruit l’historique, et document .FCStd des formes', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);

  const dialog = await openExport(page, 'FreeCAD');
  await expect(dialog).toContainText('Macro → Macros…');
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Exporter' }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.py$/);
  await download.saveAs('tests/output/e2e-freecad.py');
  const script = readFileSync('tests/output/e2e-freecad.py', 'utf8');
  for (const piece of ['PartDesign::Body', 'Sketcher::SketchObject', 'PartDesign::Pad', 'PartDesign::Pocket', '"Distance"']) expect(script).toContain(piece);

  const fcstd = await openExport(page, 'FCStd');
  const [download2] = await Promise.all([page.waitForEvent('download'), fcstd.getByRole('button', { name: 'Exporter' }).click()]);
  expect(download2.suggestedFilename()).toMatch(/\.FCStd$/);
  await download2.saveAs('tests/output/e2e-freecad.FCStd');
  const bytes = readFileSync('tests/output/e2e-freecad.FCStd');
  expect(bytes.subarray(0, 2).toString()).toBe('PK');
});
