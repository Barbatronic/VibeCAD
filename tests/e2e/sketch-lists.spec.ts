import { expect, test } from '@playwright/test';
import { clickSketch, moveSketch, openApp, session } from './helpers';

async function drawRectangle(page: import('@playwright/test').Page) {
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
}

test('listes de l’esquisse (Expert) : éléments et contraintes, sélection depuis la liste', async ({ page }) => {
  await openApp(page);
  await drawRectangle(page);
  const elements = page.getByRole('list', { name: 'Éléments de l’esquisse' });
  const constraints = page.getByRole('list', { name: 'Contraintes de l’esquisse' });
  await expect(elements.getByRole('button')).toHaveCount(12);
  await expect(elements.getByRole('button', { name: /Segment 1\s*40 mm/ })).toBeVisible();
  await expect(constraints.getByRole('button', { name: /Longueur 40 mm/ })).toBeVisible();

  // Un clic choisit l'élément (comme dans la vue), un second le retire.
  const seg = elements.getByRole('button', { name: /Segment 1/ });
  await seg.click();
  await expect(seg).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await session(page))?.selection.length).toBe(1);
  await seg.click();
  await expect.poll(async () => (await session(page))?.selection.length).toBe(0);

  // Double-clic sur une cote : sa valeur s'ouvre en modification.
  await constraints.getByRole('button', { name: /Longueur 40 mm/ }).dblclick();
  await expect.poll(async () => !!(await session(page))?.editor).toBe(true);

  // La liste se replie.
  await page.getByText(/^Éléments \(12\)$/).click();
  await expect(elements).toBeHidden();
});

test('listes de l’esquisse masquées au niveau Intermédiaire', async ({ page }) => {
  await openApp(page, 'http://localhost:5174/?niveau=intermediaire');
  await drawRectangle(page);
  await expect(page.getByRole('list', { name: 'Éléments de l’esquisse' })).toHaveCount(0);
});
