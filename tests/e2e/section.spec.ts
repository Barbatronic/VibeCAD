import { expect, test } from '@playwright/test';
import { buildPlateViaUi, openApp } from './helpers';

const cut = (page: any) =>
  page.evaluate(() => {
    const s = (window as any).vibecad.store.get();
    const p = s.sectionParts?.parts[s.doc.parts[0].id];
    if (!p?.mesh) return null;
    const xs = Array.from(p.mesh.positions as Float32Array).filter((_v, i) => i % 3 === 0);
    return { maxX: Math.max(...xs), cutFaces: p.cutFaces.length };
  });

test('vue en coupe : la plaque coupée au milieu du trou, plan et position réglables', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);
  await page.getByRole('button', { name: /Coupe : voir l’intérieur/ }).click();
  const panel = page.getByRole('group', { name: 'Vue en coupe' });
  await expect(panel).toBeVisible();
  // Plan YZ, au centre du trou (x = 15).
  await panel.getByRole('button', { name: 'YZ' }).click();
  await panel.getByLabel('Position du plan de coupe').fill('15');
  await expect.poll(async () => (await cut(page))?.maxX).toBeCloseTo(15, 3);
  expect((await cut(page))!.cutFaces).toBeGreaterThan(0);
  await expect(page.locator('.vp-canvas')).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/output/e2e-coupe.png' });
  // Un clic sur la pièce ne la sélectionne pas pendant la coupe.
  await page.getByLabel('Voir l’autre moitié').check();
  await expect.poll(async () => (await cut(page))?.maxX).toBeCloseTo(60, 3);
  await panel.getByRole('button', { name: 'Quitter la vue en coupe' }).click();
  await expect(panel).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).vibecad.store.get().section)).toBeNull();
});
