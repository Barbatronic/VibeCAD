import { expect, test } from '@playwright/test';
import { appState, clickSketch, expectVolume, finishSketch, moveSketch, openApp, session } from './helpers';

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

  await page.click('#tool-revolve');
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
