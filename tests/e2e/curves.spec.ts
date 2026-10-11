import { expect, test } from '@playwright/test';
import { appState, clickSketch, finishSketch, moveSketch, openApp, session } from './helpers';

test('ellipse et spline tracées à la souris, puis extrudées', async ({ page }) => {
  await openApp(page);
  await page.click('#tool-sketch');
  await page.getByRole('button', { name: /Plan XY/ }).click();
  await expect.poll(async () => (await session(page))?.tool).toBe('rectangle');
  await page.waitForTimeout(450);

  // Ellipse : centre (15, 10), grand axe jusqu'à (30, 10), largeur à 6 mm de l'axe.
  await page.getByRole('button', { name: 'Autres façons de tracer : cercles, arcs et courbes' }).click();
  await page.click('#sk-menu-ellipse');
  await clickSketch(page, 15, 10);
  await clickSketch(page, 30, 10);
  await moveSketch(page, 16, 16);
  // Le centre et le bout du grand axe s'accrochent à la grille : seule la largeur est vérifiée ici.
  await expect(page.getByText(/ × 12 mm/)).toBeVisible();
  await clickSketch(page, 16, 16);
  await expect.poll(async () => (await session(page))?.sketch.entities.filter((e: any) => e.type === 'ellipse').length).toBe(1);

  // Spline fermée par quatre points, refermée en cliquant le premier.
  await page.getByRole('button', { name: 'Autres façons de tracer : cercles, arcs et courbes' }).click();
  await page.click('#sk-menu-spline');
  for (const [x, y] of [[40, 0], [60, 0], [60, 15], [40, 15]] as const) await clickSketch(page, x, y);
  await moveSketch(page, 40, 0);
  await expect(page.getByText('fermer la courbe', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'tests/output/e2e-ellipse-spline.png' });
  await clickSketch(page, 40, 0);
  await expect.poll(async () => (await session(page))?.sketch.entities.find((e: any) => e.type === 'spline')?.closed).toBe(true);
  await finishSketch(page);

  await page.click('#tool-extrude');
  await page.locator('#draft-distance').fill('5');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  // Deux volumes : l'ellipse (largeur 12 mm) et la spline.
  await expect
    .poll(() => appState(page, (s) => s.display[s.doc.parts[0].id]?.result.analysis?.solidCount))
    .toBe(2);
  const volume = await appState(page, (s) => s.display[s.doc.parts[0].id].result.analysis.volume);
  expect(volume).toBeGreaterThan(Math.PI * 14 * 6 * 5 + 200 * 5);
});
