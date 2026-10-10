import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { appState, clickSketch, expectVolume, finishSketch, moveSketch, openFileMenu, PROD_URL, session } from './helpers';

test('après préparation du mode hors ligne, un rechargement sans réseau permet de créer, enregistrer et exporter', async ({ page, context }) => {
  await page.goto(PROD_URL);
  await page.waitForFunction(() => (window as any).vibecad?.store?.get().kernel.status === 'ready', null, { timeout: 60_000 });
  // Le service worker signale la fin de la mise en cache (application, aides, WASM).
  await expect.poll(() => appState(page, (s) => s.offline.status), { timeout: 60_000 }).toBe('ready');
  await expect(page.getByText('Hors ligne : prêt')).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => (window as any).vibecad?.store?.get().kernel.status === 'ready', null, { timeout: 60_000 });

  // Créer une pièce sans réseau.
  await page.click('#tool-sketch');
  await page.getByRole('button', { name: /Plan XY/ }).click();
  await expect.poll(async () => (await session(page))?.tool).toBe('rectangle');
  await page.waitForTimeout(450);
  await clickSketch(page, 0, 0);
  await moveSketch(page, 20, 10);
  await page.keyboard.type('40');
  await page.keyboard.press('Tab');
  await page.keyboard.type('20');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await session(page))?.sketch.entities.length).toBe(12);
  await finishSketch(page);
  await page.click('#tool-extrude');
  await page.locator('#draft-distance').fill('8');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, 40 * 20 * 8);

  // Enregistrer et exporter, toujours hors ligne.
  await page.keyboard.press('Control+s');
  await expect(page.getByText(/Projet enregistré/)).toBeVisible();
  await openFileMenu(page);
  await page.getByRole('menuitem', { name: /Exporter en STEP/ }).click();
  const dialog = page.getByRole('dialog', { name: /Exporter en STEP/ });
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Exporter' }).click()]);
  await download.saveAs('tests/output/e2e-offline.step');
  expect(readFileSync('tests/output/e2e-offline.step', 'utf8')).toMatch(/MANIFOLD_SOLID_BREP/);
  await context.setOffline(false);
});
