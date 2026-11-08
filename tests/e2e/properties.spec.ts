import { expect, test } from '@playwright/test';
import { appState, buildPlateViaUi, openApp } from './helpers';

test('propriétés de la pièce : matière enregistrée, masse, encombrement, centre de gravité', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);
  // Rappel dans la barre d'état (PLA par défaut), qui ouvre les propriétés.
  const readout = page.locator('.statusbar .part-readout');
  await expect(readout).toContainText('Pièce 1');
  await expect(readout).toContainText('≈ 11 g');
  await readout.click();
  const panel = page.getByRole('complementary', { name: 'Propriétés de « Pièce 1 »' });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('60 × 30 × 5');
  // Plus de volume ni de masse dans le panneau des pièces.
  await expect(page.locator('.left-panel')).not.toContainText('Masse');

  // Matière choisie dans Fabrication › Matières : la masse suit, et la simulation la propose.
  await expect(panel).toContainText('Non choisie (comptée en PLA)');
  await panel.getByRole('button', { name: /Choisir dans Fabrication/ }).click();
  await expect.poll(() => appState(page, (s) => [s.workspace, s.fabricationTab])).toEqual(['fabrication', 'materials']);
  await page.getByLabel('Matière de « Pièce 1 »').selectOption({ label: 'Acier (visserie, axes)' });
  expect(await appState(page, (s) => s.doc.parts[0].material)).toBe('steel');
  await page.click('#tab-parts');
  await expect(readout).toContainText('≈ 69,5 g');
  // Le panneau Propriétés, resté ouvert, montre la fiche choisie.
  await expect(panel).toContainText('Acier (visserie, axes)');
  await expect(panel).toContainText('≈ 69,5 g');

  // Centre de gravité : symbole dans la vue à la demande.
  const box = panel.getByLabel(/centre de gravité/);
  await expect(page.locator('.vp-centroid')).toHaveCount(0);
  await box.check();
  await expect(page.locator('.vp-centroid')).toHaveCount(1);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tests/output/e2e-proprietes.png' });
  await box.uncheck();
  await expect(page.locator('.vp-centroid')).toHaveCount(0);

  // Le bouton de la barre referme le panneau.
  await page.click('#tool-properties');
  await expect(panel).toHaveCount(0);

  await page.click('#tab-simulation');
  await expect(page.locator('#sim-material')).toHaveValue('steel');
});
