import { expect, test, type Page } from '@playwright/test';
import { buildPlateViaUi, openApp } from './helpers';

const pieceBox = (page: Page, key: string) => page.locator(`[data-piece="${key}"] .laser-cut`).boundingBox();
const placements = (page: Page) => page.evaluate(() => (window as any).vibecad.controller.state.doc.fabrication?.laser.materials.find((m: any) => m.placements)?.placements ?? null);

test('atelier laser : plaques au centre, déplacer, tourner, chevauchement signalé, optimiser', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);
  await page.click('#tab-fabrication');
  await page.click('#fab-laser');
  // Les plaques remplacent la vue 3D.
  await expect(page.locator('.laser-board')).toBeVisible();
  await page.getByLabel('Exemplaires à découper de « Pièce 1 »').fill('6');
  await expect(page.locator('.laser-board .laser-piece')).toHaveCount(6);
  await page.screenshot({ path: 'tests/output/e2e-laser-atelier.png' });
  const partId = await page.evaluate(() => (window as any).vibecad.controller.state.doc.parts[0].id);

  // Glisser la pièce 2 sur la pièce 1 : chevauchement signalé (en rouge).
  const a = (await pieceBox(page, `${partId}#0`))!;
  const b = (await pieceBox(page, `${partId}#1`))!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  // Un peu à gauche : la voisine de droite de la n° 1 reste à distance.
  await page.mouse.move(a.x + a.width / 2 - 10, a.y + a.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.laser-board .laser-piece.is-bad')).toHaveCount(2);
  await expect(page.locator('.laser-board-status')).toContainText('chevauchement');
  expect(await placements(page)).toHaveLength(6);

  // Tourner la pièce sélectionnée de 90° (touche R).
  await page.keyboard.press('r');
  await expect.poll(async () => (await placements(page)).find((p: any) => p.copy === 1).angle).toBe(90);

  // Optimiser : plus aucun chevauchement, tout sur une plaque.
  await page.locator('.laser-board').getByRole('button', { name: 'Optimiser' }).click();
  await expect(page.locator('.laser-board .laser-piece.is-bad')).toHaveCount(0);
  await expect(page.getByRole('tablist', { name: 'Plaques' }).getByRole('tab')).toHaveCount(1);

  // Ranger automatiquement : retour au rangement par rangées (placements oubliés).
  await page.locator('.laser-board').getByRole('button', { name: 'Ranger automatiquement' }).click();
  await expect.poll(() => placements(page)).toBeNull();
});

test('atelier laser : choisir la face découpée dans une vue 3D temporaire', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);
  await page.click('#tab-fabrication');
  await page.click('#fab-laser');
  await page.getByRole('button', { name: 'Face du contour' }).click();
  // Vue 3D le temps du choix : les plaques s'effacent, un bandeau dit quoi faire.
  await expect(page.locator('.laser-board')).toHaveCount(0);
  await expect(page.locator('.laser-pick')).toContainText('Face à découper');
  await page.screenshot({ path: 'tests/output/e2e-laser-choix-face.png' });
  await page.locator('.laser-pick').getByRole('button', { name: 'Annuler' }).click();
  await expect(page.locator('.laser-board')).toBeVisible();
});
