import { expect, test } from '@playwright/test';
import { appState, expectVolume, openApp, clickTool } from './helpers';

test('lissage : deux carrés reliés en tronc de pyramide, choisis dans le panneau', async ({ page }) => {
  await openApp(page);
  // Deux esquisses (carrés 20 et 10, à 20 mm d'écart) préparées par le modèle ; le dessin à la souris est couvert ailleurs.
  await page.evaluate(async () => {
    const c = (window as any).vibecad.controller;
    const [docUrl, modelUrl, solverUrl] = ['/src/domain/document.ts', '/src/sketch/model.ts', '/src/sketch/solver.ts'];
    const d = await import(/* @vite-ignore */ docUrl);
    const m = await import(/* @vite-ignore */ modelUrl);
    const so = await import(/* @vite-ignore */ solverUrl);
    let doc = c.state.doc;
    const partId = doc.parts[0].id;
    for (const [a, z] of [
      [20, 0],
      [10, 20],
    ] as [number, number][]) {
      const sk = d.makeSketchFeature(doc, d.findPart(doc, partId), { kind: 'plane', plane: 'XY', offset: z });
      const params = so.solveSketch(m.addRectangle(sk.params, { x: -a / 2, y: -a / 2 }, { x: a / 2, y: a / 2 }).sketch).sketch;
      doc = d.addFeature(doc, partId, { ...sk, params });
    }
    c.commit(doc, 'Deux esquisses');
  });
  await clickTool(page, 'tool-loft');
  await expect(page.getByRole('checkbox', { name: /Esquisse 1/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /Esquisse 2/ })).toBeChecked();
  await page.getByRole('checkbox', { name: /Raccords droits/ }).check();
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/output/e2e-lissage.png' });
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, (20 / 3) * 700);
  expect(await appState(page, (s) => s.doc.parts[0].features.at(-1).params.ruled)).toBe(true);
});
