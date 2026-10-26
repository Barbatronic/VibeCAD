import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { parseNativeFile } from '../../src/io/native-format';
import { appState, openApp } from './helpers';

test('mécanisme : couple sur le pivot d’un bras, courbe, moteurs, position survolée', async ({ page }) => {
  await openApp(page);
  const parsed = parseNativeFile(readFileSync('tests/fixtures/mechanism-arm.vibecad', 'utf8'));
  expect(parsed.ok).toBe(true);
  await page.evaluate((doc) => (window as any).vibecad.controller.commit(doc, 'Bras'), (parsed as any).doc);
  await expect.poll(() => appState(page, (s) => s.doc.parts.every((p: any) => s.display[p.id]?.mesh))).toBe(true);

  await page.click('#tab-simulation');
  await page.click('#sim-mechanism');
  const panel = page.getByRole('complementary', { name: 'Étude du mécanisme' });
  await expect(panel.locator('#mech-joint')).toHaveValue('pivot');
  // Sécurité 1, rien d'autre : le couple à fournir est le couple du poids, m g r.
  await panel.getByLabel('Sécurité').fill('1');
  await expect.poll(() => appState(page, (s) => s.doc.simulation?.mechanism?.safety)).toBe(1);
  await panel.getByRole('button', { name: 'Calculer le couple' }).click();
  await expect(panel.getByText('Couple à fournir')).toBeVisible();
  const result = await appState(page, (s) => s.mechanismRun.result);
  const arm = await appState(page, (s) => s.display[s.doc.parts[1].id].result.analysis);
  const expected = (arm.volume / 1000) * 1.24 / 1000 * 9.81 * 0.02;
  expect(result.required).toBeCloseTo(expected, 4);
  // Bras léger en PLA : un micro-servo suffit.
  await expect(panel.getByRole('list', { name: 'Moteurs courants' }).getByRole('listitem').first()).toContainText('suffit');

  // Survol de la courbe : le bras est montré à cette position (sa matrice change).
  const before = await page.evaluate(() => [...(window as any).vibecad.controller.viewport.parts.get('bras').group.matrix.elements]);
  const chart = panel.locator('.mech-chart svg');
  const box = (await chart.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await expect.poll(() => appState(page, (s) => s.mechanismHover)).not.toBeNull();
  await expect
    .poll(() => page.evaluate((b) => JSON.stringify([...(window as any).vibecad.controller.viewport.parts.get('bras').group.matrix.elements]) !== JSON.stringify(b), before))
    .toBe(true);
  await page.screenshot({ path: 'tests/output/e2e-mecanisme.png' });
  // Réglage changé : résultat signalé périmé.
  await panel.getByLabel('Frottement').fill('0,05');
  await expect(panel.getByText(/recalculez/)).toBeVisible();
});
