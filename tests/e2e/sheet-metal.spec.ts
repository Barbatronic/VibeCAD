import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { appState, clickSketch, clickTool, expectVolume, finishSketch, moveSketch, openApp, session, worldToScreen } from './helpers';

const bbox = (page: Page) => appState(page, (s) => s.display[s.activePartId]?.result.analysis?.bbox);

test('tôlerie : tôle, bords pliés choisis à la souris, pli sur un trait, limites du matériau', async ({ page }) => {
  test.setTimeout(180_000);
  await openApp(page);
  // Rectangle 60 × 30 sur le plan XY.
  await page.click('#tool-sketch');
  await page.getByRole('button', { name: /Plan XY/ }).click();
  await expect.poll(async () => (await session(page))?.tool).toBe('rectangle');
  await page.waitForTimeout(450);
  await clickSketch(page, 0.05, 0.05);
  await moveSketch(page, 40, 20);
  await page.keyboard.type('60');
  await page.keyboard.press('Tab');
  await page.keyboard.type('30');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await session(page))?.dof).toBe(0);
  await finishSketch(page);

  // Tôle d'aluminium de 1 mm.
  await clickTool(page, 'tool-sheet');
  await expect(page.locator('#draft-sheet-material')).toHaveValue('aluminium');
  await page.locator('#draft-thickness').fill('1');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, 1800);

  // Trait de pli (x = 40) sur le plan XY (dessous de la tôle) ; côté droit (x > 40) plié de 90°
  // vers le haut.
  await page.click('#tool-sketch');
  await page.getByRole('button', { name: /Plan XY/ }).click();
  await expect.poll(async () => (await session(page))?.sketch.support.kind).toBe('plane');
  await page.waitForTimeout(450);
  await page.click('#sk-line');
  await clickSketch(page, 40, -5);
  await clickSketch(page, 40, 35);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await session(page))?.sketch.entities.filter((e: any) => e.type === 'line').length).toBe(1);
  await finishSketch(page);
  await clickTool(page, 'tool-fold');
  await page.getByRole('button', { name: 'À droite du trait' }).click();
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  // La partie x > 40 se dresse (aluminium 1 mm : rayon 1,5) : plus rien au-delà de x = 40 + r + t.
  await expect.poll(async () => (await bbox(page))?.max.x ?? 99).toBeCloseTo(42.5, 1);
  await expect.poll(async () => (await bbox(page))?.max.z ?? 0).toBeGreaterThan(15);

  // Esquisse sur la face pliée (face extérieure de la partie relevée, x = 40 + r + t) : un trou
  // Ø 6 percé après le pli, reporté sur le développé.
  await page.waitForTimeout(400);
  const raised = await worldToScreen(page, 42.5, 15, 10);
  await page.mouse.dblclick(raised.x, raised.y);
  await expect.poll(async () => (await session(page))?.sketch.support.kind).toBe('face');
  await page.waitForTimeout(450);
  await page.click('#sk-circle');
  const plane = await page.evaluate(() => (window as any).vibecad.store.get().mode.session.sketch);
  expect(plane).toBeTruthy();
  const target = await worldToScreen(page, 42.5, 15, 10);
  await page.mouse.click(target.x, target.y);
  await page.keyboard.type('6');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await session(page))?.sketch.entities.filter((e: any) => e.type === 'circle').length).toBe(1);
  await finishSketch(page);
  await clickTool(page, 'tool-pocket');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expect.poll(() => appState(page, (s) => s.display[s.activePartId].result.statuses.at(-1).state)).toBe('ok');

  // Bord plié de 15 mm sur le bord gauche du dessus (x = 0).
  await page.waitForTimeout(400);
  const left = await worldToScreen(page, 0, 15, 1);
  await page.mouse.click(left.x, left.y);
  await expect.poll(() => appState(page, (s) => s.selection?.kind)).toBe('edge');
  await clickTool(page, 'tool-flange');
  await expect(page.getByText('1 arête', { exact: true })).toBeVisible();
  await page.locator('#draft-length').fill('15');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  // Rayon trop petit pour l'aluminium de 1 mm (au moins 1,5 mm) : avertissement dans l'aperçu.
  await page.locator('#draft-radius').fill('0,5');
  await expect(page.locator('.right-panel')).toContainText('Rayon trop petit', { timeout: 30_000 });
  await page.locator('#draft-radius').fill('');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  // Profil en U : le rebord gauche monte aussi, à x = −(r + t).
  await expect.poll(async () => (await bbox(page))?.min.x ?? 0).toBeCloseTo(-2.5, 1);
  const statuses = await appState(page, (s) => s.display[s.activePartId].result.statuses.map((x: any) => x.state));
  expect(statuses.every((x: string) => x === 'ok')).toBe(true);
  await page.screenshot({ path: 'tests/output/e2e-tolerie.png' });

  // Déplier : la tôle à plat, avec les deux lignes de pli (étiquettes de l'angle).
  await clickTool(page, 'tool-unfold');
  await expect(page.locator('.vp-tag-bend')).toHaveCount(2);
  await expect(page.locator('.vp-tag-bend').first()).toContainText('90°');
  await page.screenshot({ path: 'tests/output/e2e-tolerie-deplie.png' });
  await clickTool(page, 'tool-unfold');
  await expect(page.locator('.vp-tag-bend')).toHaveCount(0);

  // Découpe laser du développé : contour rouge et lignes de pli en tirets verts (2 par pli).
  await page.click('#tab-fabrication');
  await page.click('#fab-laser');
  await page.getByLabel('Exemplaires à découper de « Pièce 1 »').fill('1');
  await expect(page.locator('.sheet-bend')).toHaveCount(4);
  await page.screenshot({ path: 'tests/output/e2e-tolerie-laser.png' });
  const [svg] = await Promise.all([page.waitForEvent('download'), page.click('#fab-export-svg')]);
  await svg.saveAs('tests/output/e2e-tolerie-laser.svg');
  const text = readFileSync('tests/output/e2e-tolerie-laser.svg', 'utf8');
  expect((text.match(/<line [^>]*stroke="#00a000"/g) ?? []).length).toBe(4);
  // Développé : le contour et le trou percé après le pli.
  expect((text.match(/<polygon /g) ?? []).length).toBe(2);
});
