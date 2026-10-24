import { expect, test } from '@playwright/test';
import {
  appState,
  buildPlateViaUi,
  clickEmptyView,
  expectVolume,
  finishSketch,
  openApp,
  PLATE_VOLUME,
  WIDE_PLATE_VOLUME,
} from './helpers';

test('parcours de la plaque percée, modification de la largeur, annuler et rétablir', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);

  // Historique lisible : 4 étapes sans erreur.
  const history = page.getByRole('list', { name: /Étapes de construction/ });
  await expect(history.getByRole('listitem')).toHaveCount(4);
  await expect(page.locator('.status-badge')).toHaveCount(0);

  // Modifier la largeur initiale à 80 mm : la pièce suit, le trou reste coté depuis l'origine.
  await history.locator('.feature-main', { hasText: 'Esquisse 1' }).dblclick();
  await expect.poll(() => appState(page, (s) => s.mode.kind)).toBe('sketch');
  await page.waitForTimeout(450);
  await page.locator('.vp-dim', { hasText: '60 mm' }).dblclick();
  const editor = page.getByRole('dialog', { name: 'Modifier la cote' });
  await editor.getByLabel('Valeur de la cote en millimètres').fill('80');
  await editor.getByLabel('Valeur de la cote en millimètres').press('Enter');
  await finishSketch(page);
  await expectVolume(page, WIDE_PLATE_VOLUME);
  const hole = await appState(page, (s) => {
    const mesh = s.display[s.doc.parts[0].id].mesh;
    return mesh.faces.find((f: any) => f.surface === 'cylinder').cylinder;
  });
  expect(hole.radius).toBeCloseTo(3, 6);
  expect(hole.origin.x).toBeCloseTo(15, 6);
  expect(hole.origin.y).toBeCloseTo(15, 6);

  // Annuler puis rétablir : dimensions, historique et géométrie cohérents.
  await clickEmptyView(page);
  await page.keyboard.press('Control+z');
  await expectVolume(page, PLATE_VOLUME);
  await page.keyboard.press('Control+y');
  await expectVolume(page, WIDE_PLATE_VOLUME);
  await expect(history.getByRole('listitem')).toHaveCount(4);
  await page.screenshot({ path: 'tests/output/e2e-plaque-80.png' });
});

test('une erreur de contour ouvert est expliquée et récupérable', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);
  const history = page.getByRole('list', { name: /Étapes de construction/ });
  await history.locator('.feature-main', { hasText: 'Esquisse 1' }).dblclick();
  await expect.poll(() => appState(page, (s) => s.mode.kind)).toBe('sketch');
  // Supprime le segment du haut du rectangle : le contour devient ouvert.
  const lineId = await appState(page, (s) => {
    const sk = s.mode.session.sketch;
    const pts = Object.fromEntries(sk.entities.filter((e: any) => e.type === 'point').map((e: any) => [e.id, e]));
    return sk.entities.find((e: any) => e.type === 'line' && pts[e.a].y > 20 && pts[e.b].y > 20).id;
  });
  await page.evaluate((id) => {
    const c = (window as any).vibecad.controller;
    c.updateSession((s: any) => ({ ...s, selection: [id] }));
  }, lineId);
  await page.keyboard.press('Delete');
  await finishSketch(page);
  const extrusionIssue = page.locator('.feature-issue.error').first();
  await expect(extrusionIssue).toContainText('Le contour n’est pas fermé. Reliez les deux points indiqués');
  await expect(page.getByText(/n’est plus à jour/)).toBeVisible();
  await expect(page.locator('.status-blocked')).toHaveCount(2);
  // La correction : « Annuler la dernière action » restaure la pièce.
  await extrusionIssue.getByRole('button', { name: 'Annuler la dernière action' }).click();
  await expectVolume(page, PLATE_VOLUME);
  await expect(page.locator('.feature-issue')).toHaveCount(0);
});
