import { expect, test } from '@playwright/test';
import { clickSketch, finishSketch, moveSketch, openApp, session } from './helpers';

test('arbre : pastille orange tant que l’esquisse n’est pas entièrement contrainte', async ({ page }) => {
  await openApp(page);
  await page.click('#tool-sketch');
  await page.getByRole('button', { name: /Plan XY/ }).click();
  await expect.poll(async () => (await session(page))?.tool).toBe('rectangle');
  await page.waitForTimeout(450);
  // Rectangle à la souris, loin de l'origine : il peut encore bouger.
  await clickSketch(page, 10, 10);
  await clickSketch(page, 30, 20);
  await finishSketch(page);
  const history = page.getByRole('list', { name: /Étapes de construction/ });
  const dot = history.locator('.status-dot');
  await expect(dot).toHaveClass(/dot-free/);
  await expect(dot).toHaveAttribute('title', /degrés de liberté/);
  await page.screenshot({ path: 'tests/output/e2e-arbre-pastille.png' });

  // Coter et accrocher à l'origine : la pastille disparaît.
  await history.locator('.feature-main', { hasText: 'Esquisse 1' }).dblclick();
  await expect.poll(async () => (await session(page))?.featureId).toBeTruthy();
  await page.evaluate(() => {
    const lines = (window as any).vibecad.controller.state.mode.session.sketch.entities.filter((e: any) => e.type === 'line');
    (window as any).__corner = { corner: lines[0].a, w: lines[0].id, h: lines[3].id };
  });
  // Contraintes par l'API de session (le dessin des cotes à la souris est couvert ailleurs).
  await page.evaluate(async () => {
    const c = (window as any).vibecad.controller;
    const { corner, w, h } = (window as any).__corner;
    // Modules de l'application servis par Vite (chemins dans des variables : résolus par le navigateur).
    const [modelUrl, solverUrl] = ['/src/sketch/model.ts', '/src/sketch/solver.ts'];
    const mod = await import(/* @vite-ignore */ modelUrl);
    const solver = await import(/* @vite-ignore */ solverUrl);
    c.updateSession((x: any) => {
      let sk = mod.addConstraint(x.sketch, { type: 'coincident', a: 'origin', b: corner }).sketch;
      sk = mod.addConstraint(sk, { type: 'length', line: w, value: 20 }).sketch;
      sk = mod.addConstraint(sk, { type: 'length', line: h, value: 10 }).sketch;
      const r = solver.solveSketch(sk);
      return { ...x, sketch: r.sketch, dof: r.dof, dirty: true };
    });
  });
  await finishSketch(page);
  await expect(history.locator('.status-dot')).toHaveCount(0);
});

test('arbre : pastille rouge sur une étape en erreur', async ({ page }) => {
  await openApp(page);
  await page.click('#tool-sketch');
  await page.getByRole('button', { name: /Plan XY/ }).click();
  await page.waitForTimeout(450);
  // Contour ouvert : un seul segment, puis extrusion impossible.
  await page.click('#sk-line');
  await clickSketch(page, 0.05, 0.05);
  await moveSketch(page, 20, 0);
  await clickSketch(page, 20, 0);
  await page.keyboard.press('Escape');
  await finishSketch(page);
  await page.evaluate(async () => {
    const c = (window as any).vibecad.controller;
    const documentUrl = '/src/domain/document.ts';
    const doc = await import(/* @vite-ignore */ documentUrl);
    const part = c.state.doc.parts[0];
    const ex = doc.makeExtrudeFeature(c.state.doc, part, part.features[0].id, 5);
    c.commit(doc.addFeature(c.state.doc, part.id, ex), 'test');
  });
  const history = page.getByRole('list', { name: /Étapes de construction/ });
  await expect(history.locator('.status-dot.dot-error')).toHaveCount(1);
});
