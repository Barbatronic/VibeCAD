import { expect, test, type Page } from '@playwright/test';
import { buildPlateViaUi, clickTool, openApp } from './helpers';

/** Flèches du clavier, petites flèches ▼ et molette : zéro et négatifs atteignables là où ils sont permis. */
async function stepDown(page: Page, id: string, how: 'key' | 'button' | 'wheel', times = 1) {
  const input = page.locator(`#${id}`);
  for (let i = 0; i < times; i++) {
    if (how === 'key') await input.press('ArrowDown');
    else if (how === 'button') await input.locator('xpath=..').getByRole('button', { name: /^Diminuer/ }).click();
    else {
      await input.hover();
      await page.mouse.wheel(0, 120);
    }
  }
}

test('flèches et molette : décalage, position et angle passent par 0 et deviennent négatifs ; une longueur reste positive', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);

  // Plan décalé : 1 → 0 → −1 (clavier), puis −2 (bouton ▼), −3 (molette) ; l'inclinaison aussi.
  await clickTool(page, 'tool-plane');
  await page.locator('#draft-offset').fill('1');
  await stepDown(page, 'draft-offset', 'key', 2);
  await expect(page.locator('#draft-offset')).toHaveValue('-1');
  await stepDown(page, 'draft-offset', 'button');
  await expect(page.locator('#draft-offset')).toHaveValue('-2');
  await stepDown(page, 'draft-offset', 'wheel');
  await expect(page.locator('#draft-offset')).toHaveValue('-3');
  await page.locator('#draft-angle').fill('0');
  await stepDown(page, 'draft-angle', 'key');
  await expect(page.locator('#draft-angle')).toHaveValue('-1');
  await page.getByRole('button', { name: 'Annuler', exact: true }).click();

  // Axe : position X négative.
  await clickTool(page, 'tool-axis');
  await page.locator('#draft-pos-x').fill('0');
  await stepDown(page, 'draft-pos-x', 'key');
  await expect(page.locator('#draft-pos-x')).toHaveValue('-1');
  await page.getByRole('button', { name: 'Annuler', exact: true }).click();

  // Forme toute faite : une longueur ne descend pas sous 1 avec un pas de 1, ni sous 0 avec Alt.
  await page.click('#tool-primitive');
  await page.locator('#draft-width').fill('1');
  await stepDown(page, 'draft-width', 'key', 2);
  await expect(page.locator('#draft-width')).toHaveValue('1');
  await page.locator('#draft-width').press('Alt+ArrowDown');
  await expect(page.locator('#draft-width')).toHaveValue('0,9');
});
