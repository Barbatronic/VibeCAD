import { expect, test, type Page } from '@playwright/test';
import { expectVolume, openApp, worldToScreen } from './helpers';

/** Centre de la face plane de normale donnée (pièce active). */
async function faceCenter(page: Page, normal: [number, number, number]) {
  return page.evaluate((n) => {
    const s = (window as any).vibecad.controller.state;
    const mesh = s.display[s.activePartId].mesh;
    const face = mesh.faces.find((f: any) => f.plane && f.plane.normal.x * n[0] + f.plane.normal.y * n[1] + f.plane.normal.z * n[2] > 0.99);
    let x = 0, y = 0, z = 0;
    for (let k = face.start; k < face.start + face.count; k++) {
      const v = mesh.indices[k];
      x += mesh.positions[3 * v];
      y += mesh.positions[3 * v + 1];
      z += mesh.positions[3 * v + 2];
    }
    return { x: x / face.count, y: y / face.count, z: z / face.count };
  }, normal);
}

async function clickFace(page: Page, normal: [number, number, number]) {
  await expect.poll(() => page.evaluate(() => (window as any).vibecad.controller.viewport.rig.animating)).toBe(false);
  const c = await faceCenter(page, normal);
  const p = await worldToScreen(page, c.x, c.y, c.z);
  await page.mouse.click(p.x, p.y);
}

const percent = async (page: Page, id: string) => Number((await page.locator(id).textContent())!.replace(/[^\d]/g, ''));

test('simulation : alléger une console (optimisation topologique), régler le seuil, exporter et garder la forme', async ({ page }) => {
  test.setTimeout(240_000);
  await openApp(page);
  // Plaque 80 × 10 × 40 mm, tenue par le bout +X, chargée sur le dessus (console).
  await page.click('#tool-primitive');
  await page.locator('#draft-width').fill('80');
  await page.locator('#draft-depth').fill('10');
  await page.locator('#draft-height').fill('40');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, 32000);

  await page.getByRole('tab', { name: 'Simulation' }).click();
  const run = page.locator('.right-panel').getByRole('button', { name: 'Alléger la pièce' });
  await expect(run).toBeDisabled();
  await page.click('#sim-pick-fixed');
  await clickFace(page, [1, 0, 0]);
  await page.click('#sim-pick-load');
  await clickFace(page, [0, 0, 1]);
  await expect.poll(() => page.evaluate(() => (window as any).vibecad.controller.state.doc.simulation?.studies[0]?.fixed.length)).toBe(1);
  await page.keyboard.press('Escape');
  await page.locator('#sim-quality').selectOption('coarse');

  // Face avant gardée : sur une plaque, toute la matière devient « à garder », rien à alléger.
  await page.locator('.topology').getByRole('button', { name: 'Choisir' }).click();
  await clickFace(page, [0, -1, 0]);
  await page.keyboard.press('Escape');
  await expect(page.locator('.topology')).toContainText('Faces à garder : 1');
  await run.click();
  await expect(page.locator('.topology-result')).toContainText('rien à alléger', { timeout: 120_000 });
  await page.locator('.topology').getByRole('button', { name: 'tout retirer' }).click();
  await expect(page.locator('.topology')).toContainText('Faces à garder : 0');
  await expect(page.locator('.topology-result')).toContainText('relancez l’allègement');

  // 40 % de la matière (réglage par défaut).
  await expect(page.locator('label[for="topo-fraction"]')).toContainText('40 %');
  await run.click();
  await expect(page.getByRole('status').locator('progress[aria-label="Avancement de l’allègement"]')).toBeVisible();
  await expect(page.locator('#topo-kept')).toBeVisible({ timeout: 180_000 });
  const kept = await percent(page, '#topo-kept');
  expect(kept).toBeGreaterThan(25);
  expect(kept).toBeLessThan(55);
  expect(await percent(page, '#topo-stiffness')).toBeGreaterThan(20);
  await expect.poll(() => page.evaluate(() => !!(window as any).vibecad.controller.viewport.resultObject)).toBe(true);
  await page.screenshot({ path: 'tests/output/e2e-topologie.png' });
  await page.locator('.topology').scrollIntoViewIfNeeded();
  await page.locator('.right-panel').screenshot({ path: 'tests/output/e2e-topologie-panneau.png' });

  // Seuil plus haut : moins de matière montrée.
  await page.locator('#topo-threshold').fill('0.8');
  await expect.poll(() => percent(page, '#topo-kept')).toBeLessThan(kept + 1);

  // Export STL de la forme.
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exporter en STL' }).click()]);
  expect(download.suggestedFilename()).toMatch(/allégée\.stl$/);

  // Changer la part de matière : le résultat est signalé comme périmé.
  await page.locator('#topo-fraction').fill('0.5');
  await expect(page.locator('.topology-result')).toContainText('relancez l’allègement');

  // Forme symétrique gauche-droite : les densités se répondent de part et d'autre du milieu.
  await page.locator('#topo-symmetry').selectOption({ label: 'Gauche-droite (miroir selon X)' });
  await run.click();
  await expect(page.locator('.topology-result')).not.toContainText('relancez', { timeout: 120_000 });
  await expect(page.locator('#topo-kept')).toBeVisible();
  const symmetric = await page.evaluate(() => {
    const r = (window as any).vibecad.controller.state.topologyRun.result;
    const { nx, ny, nz } = r.grid;
    let worst = 0;
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          const a = r.density[i + nx * (j + ny * k)];
          const b = r.density[nx - 1 - i + nx * (j + ny * k)];
          if (a >= 0 && b >= 0) worst = Math.max(worst, Math.abs(a - b));
        }
    return worst;
  });
  expect(symmetric).toBeLessThan(1e-6);
  await page.screenshot({ path: 'tests/output/e2e-topologie-symetrie.png' });

  // Garder la forme comme nouvelle pièce (fenêtre d'import STL).
  await page.getByRole('button', { name: 'Nouvelle pièce' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('allégée.stl');
  await expect(dialog.getByRole('button', { name: /Importer/ })).toBeEnabled({ timeout: 60_000 });
  await dialog.getByRole('button', { name: /Importer/ }).click();
  await expect.poll(() => page.evaluate(() => (window as any).vibecad.controller.state.doc.parts.length)).toBe(2);
  // La forme importée est un vrai solide, d'un volume proche de la matière gardée.
  const solid = () =>
    page.evaluate(() => {
      const s = (window as any).vibecad.controller.state;
      const a = s.display[s.doc.parts[1].id]?.result.analysis;
      return a ? { solids: a.solidCount, volume: a.volume } : null;
    });
  await expect.poll(async () => (await solid())?.solids ?? 0, { timeout: 60_000 }).toBeGreaterThan(0);
  // D'un seul tenant (pas de contact par une arête qui couperait la forme en morceaux).
  expect((await solid())!.solids).toBe(1);
  const v = (await solid())!.volume;
  expect(v).toBeGreaterThan(0.15 * 32000);
  expect(v).toBeLessThan(0.6 * 32000);
  await page.screenshot({ path: 'tests/output/e2e-topologie-piece.png' });

  // Retour dans Simulation : changer de pièce étudiée referme la forme allégée.
  await page.getByRole('tab', { name: 'Simulation' }).click();
  await page.getByRole('radio', { name: 'Pièce 1', exact: true }).click();
  await expect(page.locator('.topology-result')).toHaveCount(0);
});
