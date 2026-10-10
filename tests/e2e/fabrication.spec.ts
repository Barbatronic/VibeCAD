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
