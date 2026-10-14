import { expect, test } from '@playwright/test';
import { appState, buildPlateViaUi, openApp } from './helpers';

test('modes d’affichage : choisis dans le bouton « Affichage », retenus au rechargement', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);
  for (const [name, style] of [
    ['Arêtes cachées en pointillés', 'hidden-lines'],
    ['Transparent', 'transparent'],
    ['Fil de fer', 'wireframe'],
  ] as const) {
    await page.click('#view-display');
    await page.getByRole('menuitemradio', { name }).click();
    await expect.poll(() => appState(page, (s) => s.displayStyle)).toBe(style);
  }
  await expect(page.locator('#view-display')).toHaveAttribute('aria-label', /Fil de fer/);
  await page.reload();
  // Le travail non enregistré est proposé à la récupération.
  await page.getByRole('dialog', { name: 'Récupérer votre travail ?' }).getByRole('button', { name: 'Récupérer' }).click();
  await page.waitForFunction(() => (window as any).vibecad?.store?.get().kernel.status === 'ready');
  await expect.poll(() => appState(page, (s) => s.displayStyle)).toBe('wireframe');
  await page.click('#view-display');
  await expect(page.getByRole('menuitemradio', { name: 'Fil de fer' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('menuitemradio', { name: 'Ombré avec arêtes' }).click();
  await expect.poll(() => appState(page, (s) => s.displayStyle)).toBe('shaded-edges');

  // Épaisseur des arêtes : curseur du même menu, retenue elle aussi.
  await page.click('#view-display');
  await page.locator('#view-edge-width').fill('3');
  await expect.poll(() => appState(page, (s) => s.edgeWidth)).toBe(3);
  await expect(page.locator('.edge-width-field')).toContainText('3 px');
  await page.keyboard.press('Escape');
  await page.screenshot({ path: 'tests/output/e2e-aretes-epaisses.png' });
});
