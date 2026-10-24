import { expect, test } from '@playwright/test';
import { appState, clickSketch, clickTool, expectVolume, finishSketch, moveSketch, openApp, session } from './helpers';

test('révolution : un rectangle tourné autour de l’axe Y donne un anneau, puis un demi-anneau', async ({ page }) => {
  await openApp(page);
  await page.click('#tool-sketch');
  await page.getByRole('button', { name: /Plan XY/ }).click();
  await expect.poll(async () => (await session(page))?.tool).toBe('rectangle');
  await page.waitForTimeout(450);
  // Rectangle 10 × 20 de x = 10 à x = 20, tapé au clavier.
  await clickSketch(page, 10, 0);
  await moveSketch(page, 18, 15);
  await page.keyboard.type('10');
  await page.keyboard.press('Tab');
  await page.keyboard.type('20');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await session(page))?.sketch.entities.filter((e: any) => e.type === 'line').length).toBe(4);
  await finishSketch(page);

  await clickTool(page, 'tool-revolve');
  await expect(page.locator('#draft-axis')).toHaveValue('sketch-y');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, Math.PI * (400 - 100) * 20);
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'tests/output/e2e-revolution.png' });

  // Modifier : 180°.
  const history = page.getByRole('list', { name: /Étapes de construction/ });
  await history.locator('.feature-main', { hasText: 'Révolution 1' }).dblclick();
  await page.locator('#draft-angle').fill('180');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, (Math.PI * (400 - 100) * 20) / 2);
  expect(await appState(page, (s) => s.doc.parts[0].features[1].params.angle)).toBe(180);
});

test('révolution en poche : une gorge creusée dans un bloc, aperçu en rouge', async ({ page }) => {
  await openApp(page);
  // Bloc 50 × 20 × 50 centré sur l'axe Y.
  await page.click('#tool-primitive');
  await page.locator('#draft-width').fill('50');
  await page.locator('#draft-depth').fill('20');
  await page.locator('#draft-height').fill('50');
  await page.locator('#draft-pos-x').fill('-25');
  await page.locator('#draft-pos-z').fill('-25');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, 50000);

  await page.click('#tool-sketch');
  await page.getByRole('button', { name: /Plan XY/ }).click();
  await expect.poll(async () => (await session(page))?.tool).toBe('rectangle');
  await page.waitForTimeout(450);
  await clickSketch(page, 10, 0);
  await moveSketch(page, 18, 15);
  await page.keyboard.type('10');
  await page.keyboard.press('Tab');
  await page.keyboard.type('20');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await session(page))?.sketch.entities.filter((e: any) => e.type === 'line').length).toBe(4);
  await finishSketch(page);

  await clickTool(page, 'tool-revolve');
  await page.getByRole('group', { name: 'Matière' }).getByRole('button', { name: 'Creuser' }).click();
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await expect.poll(() => appState(page, (s) => s.preview?.tool?.kind)).toBe('cut');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tests/output/e2e-revolution-poche.png' });
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, 50000 - Math.PI * (400 - 100) * 20);
  await expect(page.getByRole('list', { name: /Étapes de construction/ }).getByText(/creusée/)).toBeVisible();
});
