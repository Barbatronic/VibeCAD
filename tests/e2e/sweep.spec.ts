import { expect, test } from '@playwright/test';
import { expectVolume, openApp } from './helpers';

test('balayage : un cercle qui suit un chemin droit donne un cylindre', async ({ page }) => {
  await openApp(page);
  // Chemin (segment vertical sur XZ) et profil (cercle Ø 6 sur XY) préparés par le modèle.
  await page.evaluate(async () => {
    const c = (window as any).vibecad.controller;
    const [docUrl, modelUrl, solverUrl] = ['/src/domain/document.ts', '/src/sketch/model.ts', '/src/sketch/solver.ts'];
    const d = await import(/* @vite-ignore */ docUrl);
    const m = await import(/* @vite-ignore */ modelUrl);
    const so = await import(/* @vite-ignore */ solverUrl);
    let doc = c.state.doc;
    const partId = doc.parts[0].id;
    const path = d.makeSketchFeature(doc, d.findPart(doc, partId), { kind: 'plane', plane: 'XZ', offset: 0 });
    doc = d.addFeature(doc, partId, { ...path, params: so.solveSketch(m.addLine(path.params, { x: 0, y: 0 }, { x: 0, y: 30 }).sketch).sketch });
    const prof = d.makeSketchFeature(doc, d.findPart(doc, partId), { kind: 'plane', plane: 'XY', offset: 0 });
    doc = d.addFeature(doc, partId, { ...prof, params: so.solveSketch(m.addCircle(prof.params, { x: 0, y: 0 }, 3).sketch).sketch });
    c.commit(doc, 'Chemin et profil');
  });
  await page.getByRole('button', { name: 'Autres outils : révolutions, lissages et balayages' }).click();
  await page.click('#tool-menu-sweep');
  await expect(page.locator('#draft-profile option:checked')).toHaveText('Esquisse 2');
  await expect(page.locator('#draft-path option:checked')).toHaveText('Esquisse 1');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, Math.PI * 9 * 30);
});
