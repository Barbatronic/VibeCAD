import { expect, test } from '@playwright/test';
import { menuItem, buildPlateViaUi, openApp } from './helpers';

test('parcours guidés : choix du parcours, assemblage puis fabrication suivis pas à pas', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);
  const tour = page.locator('.tutorial');
  const done = tour.getByText('Bravo, c’est fait !');

  await menuItem(page, /Parcours guidés/);
  await expect(tour.getByRole('heading', { name: 'Que veux-tu apprendre ?' })).toBeVisible();
  await expect(tour.locator('.tutorial-choice')).toHaveCount(3);
  await page.screenshot({ path: 'tests/output/e2e-parcours-choix.png' });

  // Assemblage : la pièce existe déjà (intro réussie), ouvrir l'onglet, insérer deux pièces.
  await tour.getByRole('button', { name: /Assembler et faire bouger/ }).click();
  await expect(done).toBeVisible();
  await tour.getByRole('button', { name: 'Suivant' }).click();
  await expect(page.locator('#tab-assembly')).toHaveClass(/tutorial-target/);
  await page.click('#tab-assembly');
  await expect(done).toBeVisible();
  await tour.getByRole('button', { name: 'Suivant' }).click();
  for (let i = 0; i < 2; i++) {
    await page.click('#as-insert');
    await page.getByRole('menu', { name: 'Pièces à insérer' }).getByRole('menuitem').first().click();
  }
  await expect(done).toBeVisible();
  await tour.getByRole('button', { name: 'Suivant' }).click();
  await expect(tour.getByRole('heading', { name: '3. Relier les deux pièces' })).toBeVisible();
  await tour.getByRole('button', { name: 'Quitter le parcours guidé' }).click();

  // Fabrication.
  await menuItem(page, /Parcours guidés/);
  await tour.getByRole('button', { name: /Préparer la fabrication/ }).click();
  await tour.getByRole('button', { name: 'Suivant' }).click();
  await page.click('#tab-fabrication');
  await expect(done).toBeVisible();
  await tour.getByRole('button', { name: 'Suivant' }).click();
  await page.getByLabel('Exemplaires de « Pièce 1 »').fill('2');
  await expect(done).toBeVisible();
  await tour.getByRole('button', { name: 'Suivant' }).click();
  await tour.getByRole('button', { name: 'Passer' }).click();
  await page.click('#fab-laser');
  await page.getByLabel('Exemplaires à découper de « Pièce 1 »').fill('1');
  await expect(done).toBeVisible();
  await tour.getByRole('button', { name: 'Suivant' }).click();
  await page.click('#fab-docs');
  await expect(done).toBeVisible();
  await page.screenshot({ path: 'tests/output/e2e-parcours-fabrication.png' });
  await tour.getByRole('button', { name: 'Suivant' }).click();
  await tour.getByRole('button', { name: 'Terminer' }).click();
  await expect(tour).toHaveCount(0);
});
