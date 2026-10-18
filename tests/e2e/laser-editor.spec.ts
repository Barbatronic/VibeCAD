import { expect, test, type Page } from '@playwright/test';
import { buildPlateViaUi, openApp } from './helpers';

const pieceBox = (page: Page, key: string) => page.locator(`[data-piece="${key}"] path`).boundingBox();
const placements = (page: Page) => page.evaluate(() => (window as any).vibecad.controller.state.doc.fabrication?.laser.materials.find((m: any) => m.placements)?.placements ?? null);

test('plaques en grand : déplacer, tourner, chevauchement signalé, optimiser', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);
  await page.click('#tab-fabrication');
  await page.click('#fab-laser');
  await page.getByLabel('Exemplaires à découper de « Pièce 1 »').fill('6');
  await page.getByRole('button', { name: 'Plaques en grand…' }).click();
  const editor = page.getByRole('dialog', { name: /Plaques en grand/ });
  await expect(editor).toBeVisible();
  await expect(editor.locator('.laser-piece')).toHaveCount(6);
  const partId = await page.evaluate(() => (window as any).vibecad.controller.state.doc.parts[0].id);

  // Glisser la pièce 2 sur la pièce 1 : chevauchement signalé (en rouge).
  const a = (await pieceBox(page, `${partId}#0`))!;
  const b = (await pieceBox(page, `${partId}#1`))!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(editor.locator('.laser-piece.is-bad')).toHaveCount(2);
  await expect(editor.getByRole('status')).toContainText('se chevauchent');
  expect(await placements(page)).toHaveLength(6);
  await page.screenshot({ path: 'tests/output/e2e-laser-editeur-chevauchement.png' });

  // Tourner la pièce sélectionnée de 90° (touche R).
  await page.keyboard.press('r');
  await expect.poll(async () => (await placements(page)).find((p: any) => p.copy === 1).angle).toBe(90);

  // Optimiser : plus aucun chevauchement, tout sur une plaque.
  await editor.getByRole('button', { name: 'Optimiser' }).click();
  await expect(editor.locator('.laser-piece.is-bad')).toHaveCount(0);
  await expect(editor.getByRole('tab')).toHaveCount(1);
  await page.screenshot({ path: 'tests/output/e2e-laser-editeur.png' });

  // Ranger automatiquement : retour au rangement par rangées (placements oubliés).
  await editor.getByRole('button', { name: 'Ranger automatiquement' }).click();
  await expect.poll(() => placements(page)).toBeNull();
  await page.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
});
