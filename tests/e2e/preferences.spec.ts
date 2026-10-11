import { expect, test } from '@playwright/test';
import { appState, openApp, session } from './helpers';

test('préférences : thème, niveau, aide et aimantation retenus sur l’appareil, puis rétablis', async ({ page }) => {
  await openApp(page);
  await page.click('#tool-preferences');
  const dialog = page.getByRole('dialog', { name: 'Préférences' });
  await expect(dialog).toBeVisible();

  await dialog.getByRole('group', { name: 'Thème' }).getByRole('button', { name: 'Sombre' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await dialog.getByRole('radio', { name: /Intermédiaire/ }).check();
  await expect.poll(() => appState(page, (s) => s.level)).toBe('intermediaire');
  await dialog.getByRole('checkbox', { name: /Aimanter les points à la grille/ }).uncheck();
  await dialog.getByRole('checkbox', { name: /Bulles d’explication/ }).uncheck();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tests/output/e2e-preferences.png' });
  await dialog.getByRole('button', { name: 'Fermer' }).last().click();

  // Une nouvelle esquisse démarre sans aimantation.
  await page.click('#tool-sketch');
  await page.getByRole('button', { name: /Plan XY/ }).click();
  await expect.poll(async () => (await session(page))?.snapToGrid).toBe(false);
  await page.getByRole('button', { name: 'Annuler', exact: true }).click();

  // Retenu après rechargement (sans l'adresse qui impose le niveau).
  await page.goto('http://localhost:5174/');
  await page.waitForFunction(() => (window as any).vibecad?.store?.get().kernel.status === 'ready');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => appState(page, (s) => [s.level, s.tips, s.sketchGrid])).toEqual(['intermediaire', false, false]);

  // Depuis le menu Fichier ; « Rétablir les réglages par défaut ».
  await page.getByRole('button', { name: /Fichier/ }).click();
  await page.getByRole('menuitem', { name: 'Préférences…' }).click();
  await page.getByRole('dialog', { name: 'Préférences' }).getByRole('button', { name: 'Rétablir les réglages par défaut' }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  await expect.poll(() => appState(page, (s) => [s.level, s.tips, s.sketchGrid, s.theme])).toEqual(['debutant', true, true, 'auto']);
});
