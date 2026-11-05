import { expect, test } from '@playwright/test';
import { buildPlateViaUi, clickSketch, clickTool, finishSketch, openApp, PLATE_VOLUME, session, volumes, worldToScreen } from './helpers';

test('texte : poser, modifier dans le panneau, graver dans la plaque', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);
  await page.waitForTimeout(400);

  const top = await worldToScreen(page, 45, 22, 5);
  await page.mouse.dblclick(top.x, top.y);
  await expect.poll(async () => (await session(page))?.sketch.support.kind).toBe('face');
  await page.waitForTimeout(450);

  // Outil Texte : lettres et hauteur réglées dans le panneau, puis un clic pour poser.
  await clickTool(page, 'sk-text');
  await expect.poll(async () => (await session(page))?.tool).toBe('text');
  await page.locator('#sketch-text-content').fill('VIBE');
  await page.locator('#sketch-text-height').fill('6');
  await expect.poll(async () => (await session(page))?.textOptions).toEqual({ text: 'VIBE', height: 6 });
  await clickSketch(page, 28, 8);
  await expect.poll(async () => (await session(page))?.sketch.entities.find((e: any) => e.type === 'text')).toMatchObject({ text: 'VIBE', height: 6 });

  // Le texte posé est sélectionné : on change ses lettres et sa hauteur.
  await page.locator('#sketch-text-content').fill('VIBECAD');
  await page.locator('#sketch-text-height').fill('5');
  await expect.poll(async () => (await session(page))?.sketch.entities.find((e: any) => e.type === 'text')).toMatchObject({ text: 'VIBECAD', height: 5 });
  await page.screenshot({ path: 'tests/output/e2e-texte.png' });
  await finishSketch(page);

  // Gravure : poche de 1 mm.
  await page.click('#tool-pocket');
  await page.getByRole('button', { name: 'Cotée' }).click();
  await page.locator('#draft-distance').fill('1');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expect.poll(async () => (await volumes(page))[0]).toBeLessThan(PLATE_VOLUME - 20);
});
