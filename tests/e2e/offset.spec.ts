import { expect, test } from '@playwright/test';
import { clickSketch, expectVolume, finishSketch, moveSketch, openApp, session, clickTool } from './helpers';

test('décalage : un rectangle recopié 3 mm à l’extérieur à la souris, puis le cadre extrudé', async ({ page }) => {
  await openApp(page);
  await page.click('#tool-sketch');
  await page.getByRole('button', { name: /Plan XY/ }).click();
  await expect.poll(async () => (await session(page))?.tool).toBe('rectangle');
  await page.waitForTimeout(450);
  await clickSketch(page, 0.05, 0.05);
  await moveSketch(page, 40, 20);
  await page.keyboard.type('40');
  await page.keyboard.press('Tab');
  await page.keyboard.type('20');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await session(page))?.dof).toBe(0);

  // Outil Décalage (menu de « Couper ») : clic sur le bord du haut, puis la souris 3 mm plus haut
  // (loin du champ de saisie, en bas de la vue).
  await clickTool(page, 'sk-offset');
  await expect.poll(async () => (await session(page))?.tool).toBe('offset');
  await clickSketch(page, 20, 20);
  await expect.poll(async () => (await session(page))?.picks.length).toBe(1);
  await moveSketch(page, 20, 23);
  await expect(page.getByText(/extérieur 3/)).toBeVisible();
  await page.screenshot({ path: 'tests/output/e2e-decalage.png' });
  await clickSketch(page, 20, 23);
  await expect.poll(async () => (await session(page))?.sketch.entities.filter((e: any) => e.type === 'line').length).toBe(8);
  // Le contour décalé est entièrement contraint (segments parallèles à distance cotée).
  await expect.poll(async () => (await session(page))?.dof).toBe(0);
  await finishSketch(page);

  await page.click('#tool-extrude');
  await page.locator('#draft-distance').fill('5');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  // Cadre : (46 × 26 − 40 × 20) × 5.
  await expectVolume(page, (46 * 26 - 800) * 5);
});
