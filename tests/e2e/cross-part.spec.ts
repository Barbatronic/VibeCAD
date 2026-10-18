import { expect, test } from '@playwright/test';
import { appState, clickSketch, clickTool, finishSketch, moveSketch, openApp, session, worldToScreen } from './helpers';

test('références entre pièces : esquisse de la pièce 2 sur une face de la pièce 1, arêtes de la pièce 1 projetées', async ({ page }) => {
  await openApp(page);
  // Pièce 1 : boîte 40 × 30 × 10.
  await clickTool(page, 'tool-primitive');
  await page.locator('#draft-width').fill('40');
  await page.locator('#draft-depth').fill('30');
  await page.locator('#draft-height').fill('10');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expect.poll(() => appState(page, (s) => s.display[s.activePartId]?.result.analysis?.volume ?? 0)).toBeCloseTo(12000, 0);

  // Pièce 2 (active), esquisse posée sur le dessus de la pièce 1.
  await page.getByRole('button', { name: 'Ajouter une nouvelle pièce indépendante' }).click();
  await expect.poll(() => appState(page, (s) => s.doc.parts.length)).toBe(2);
  await page.click('#tool-sketch');
  await expect.poll(() => page.evaluate(() => (window as any).vibecad.controller.viewport.rig.animating)).toBe(false);
  await page.waitForTimeout(300);
  const top = await worldToScreen(page, 20, 15, 10);
  await page.mouse.click(top.x, top.y);
  await expect.poll(async () => (await session(page))?.sketch.support).toMatchObject({ kind: 'face', partId: await appState(page, (s) => s.doc.parts[0].id) });
  expect(await appState(page, (s) => s.mode.session.partId)).toBe(await appState(page, (s) => s.doc.parts[1].id));
  await page.waitForTimeout(450);

  // Projeter : l'arête avant du dessus de la pièce 1 (y = 0).
  await page.click('#sk-project');
  await expect
    .poll(async () => {
      await moveSketch(page, 20 + Math.random() * 0.01, 0);
      return (await session(page))?.projectHover;
    })
    .not.toBeNull();
  await clickSketch(page, 20, 0);
  await expect.poll(async () => (await session(page))?.sketch.entities.filter((e: any) => e.reference?.partId).length).toBe(1);

  // Rectangle 10 × 10, extrudé de 5 : la pièce 2 commence sur le dessus de la pièce 1.
  await page.click('#sk-rectangle');
  await clickSketch(page, 5, 5);
  await clickSketch(page, 15, 15);
  await expect.poll(async () => (await session(page))?.sketch.entities.filter((e: any) => e.type === 'line' && !e.reference).length).toBe(4);
  await finishSketch(page);
  await clickTool(page, 'tool-extrude');
  await page.locator('#draft-distance').fill('5');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  const bbox = () => appState(page, (s) => s.display[s.doc.parts[1].id]?.result.analysis?.bbox);
  await expect.poll(async () => (await bbox())?.min.z ?? 0).toBeCloseTo(10, 3);
  await expect.poll(async () => (await bbox())?.max.z ?? 0).toBeCloseTo(15, 3);
  await page.screenshot({ path: 'tests/output/e2e-references-pieces.png' });
});
