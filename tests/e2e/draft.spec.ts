import { expect, test, type Page } from '@playwright/test';
import { appState, expectVolume, openApp } from './helpers';

async function partPointOnScreen(page: Page, p: { x: number; y: number; z: number }) {
  const box = (await page.locator('.vp-canvas').boundingBox())!;
  const q = await page.evaluate((pt) => {
    const c = (window as any).vibecad.controller;
    const v = c.viewport.rig.camera.position.clone().set(pt.x, pt.y, pt.z).project(c.viewport.rig.camera);
    return { x: ((v.x + 1) / 2) * c.viewport.width, y: ((1 - v.y) / 2) * c.viewport.height };
  }, p);
  return { x: box.x + q.x, y: box.y + q.y };
}

const previewVolume = (page: Page) =>
  page.evaluate(() => {
    const c = (window as any).vibecad.controller;
    return c.state.preview?.parts[c.state.doc.parts[0].id]?.analysis?.volume ?? 0;
  });

test('dépouille : deux côtés d’une boîte inclinés d’un clic, puis plan neutre sur le dessus', async ({ page }) => {
  await openApp(page);
  await page.click('#tool-primitive');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, 8000);
  await page.evaluate(() => (window as any).vibecad.controller.fitAll());
  await page.waitForTimeout(700);

  await page.getByRole('button', { name: 'Autres outils : arrondis, chanfreins, coques et dépouilles' }).click();
  await page.click('#tool-menu-draft');
  await expect(page.locator('#draft-angle')).toHaveValue('5');
  await expect(page.getByText(/Cliquez dans la vue 3D les faces à incliner/)).toBeVisible();
  for (const p of [{ x: 10, y: 0, z: 10 }, { x: 20, y: 10, z: 10 }]) {
    const s = await partPointOnScreen(page, p);
    await page.mouse.click(s.x, s.y);
    await page.waitForTimeout(300);
  }
  await expect(page.getByText('2 faces', { exact: true })).toBeVisible();
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  // Deux côtés rentrent de 20 × tan 5° en haut : le volume baisse.
  await expect.poll(() => previewVolume(page)).toBeLessThan(7500);
  await page.screenshot({ path: 'tests/output/e2e-depouille.png' });

  // Plan neutre : la face du dessus (cliquée) ; les côtés ne bougent plus en haut.
  await page.getByRole('group', { name: /Plan neutre/ }).getByRole('button', { name: 'Face…' }).click();
  const top = await partPointOnScreen(page, { x: 10, y: 10, z: 20 });
  await page.mouse.click(top.x, top.y);
  await expect.poll(() => appState(page, (s) => s.mode.draft?.feature.params.neutral.kind)).toBe('face');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  const result = await appState(page, (s) => {
    const r = s.display[s.doc.parts[0].id].result;
    return { volume: r.analysis.volume, maxZ: r.analysis.bbox.max.z, minX: r.analysis.bbox.min.x, maxX: r.analysis.bbox.max.x, faces: s.doc.parts[0].features.at(-1).params.faces.length };
  });
  expect(result.faces).toBe(2);
  expect(result.volume).toBeLessThan(7500);
  expect(result.maxX).toBeCloseTo(20, 5);
  expect(result.minX).toBeCloseTo(0, 5);
});
