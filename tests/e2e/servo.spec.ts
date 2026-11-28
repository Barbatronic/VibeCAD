import { expect, test } from '@playwright/test';
import { appState, buildPlateViaUi, clickSketch, clickTool, expectVolume, finishSketch, openApp, PLATE_VOLUME, session, worldToScreen } from './helpers';

const disc = (d: number) => Math.PI * (d / 2) ** 2;
const starArea = (teeth: number, tip: number, root: number) => teeth * (tip / 2) * (root / 2) * Math.sin(Math.PI / teeth);

test('cannelure de servo : centrée sur le bord rond d’un trou cliqué dans la vue 3D', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);
  await page.waitForTimeout(400);

  // Bord du trou Ø 6 (centre 15, 15) sur la face du dessus, sélectionné avant l'outil (loin de la
  // couture du cylindre, en x = 18).
  const rim = await worldToScreen(page, 15 - 3 * Math.SQRT1_2, 15 - 3 * Math.SQRT1_2, 5);
  await page.mouse.click(rim.x, rim.y);
  await expect.poll(() => appState(page, (s) => s.selection?.kind)).toBe('edge');
  await clickTool(page, 'tool-servo');
  await expect(page.locator('#draft-servo-edge')).toContainText('Bord rond choisi');
  // 25 dents (MG996R), puis cotes plus larges que le trou pour que tout se voie dans le volume.
  await page.getByRole('button', { name: /25 dents/ }).click();
  await expect(page.locator('#draft-teeth')).toHaveValue('25');
  await page.locator('#draft-tipDiameter').fill('8');
  await page.locator('#draft-rootDiameter').fill('7');
  await page.locator('#draft-depth').fill('2');
  await page.locator('#draft-screwDiameter').fill('0');
  await expect(page.getByRole('button', { name: 'Autre', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.screenshot({ path: 'tests/output/e2e-cannelure-apercu.png' });
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, PLATE_VOLUME - (starArea(25, 8, 7) - disc(6)) * 2);
  await expect(page.getByRole('list', { name: /Étapes de construction/ })).toContainText('Cannelure servo 1');
});

test('cannelure de servo : MG90S sur un point d’esquisse, avec le trou de vis traversant', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);
  await page.waitForTimeout(500);
  const top = await worldToScreen(page, 45, 15, 5);
  await page.mouse.dblclick(top.x, top.y);
  await expect.poll(async () => (await session(page))?.sketch.support.kind).toBe('face');
  await page.waitForTimeout(450);
  await clickTool(page, 'sk-point');
  await clickSketch(page, 45, 15);
  await expect.poll(async () => (await session(page))?.sketch.entities.filter((e: any) => e.type === 'point').length).toBe(1);
  await finishSketch(page);

  // Rien de sélectionné : le point de la dernière esquisse est repris.
  await page.keyboard.press('Escape');
  await clickTool(page, 'tool-servo');
  await expect(page.getByRole('button', { name: 'Esquisse…' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#draft-servo-sketch')).toContainText('Point');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, PLATE_VOLUME - starArea(21, 5.25, 4.4) * 3 - disc(2.8) * 2);
  await page.screenshot({ path: 'tests/output/e2e-cannelure.png' });
});
