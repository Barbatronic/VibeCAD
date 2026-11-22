import { expect, test } from '@playwright/test';
import { appState, buildPlateViaUi, worldToScreen, clickSketch, expectVolume, finishSketch, moveSketch, openApp, PLATE_VOLUME, session, clickTool } from './helpers';

test('plan de construction : un plan au-dessus de la plaque sert de support à une esquisse, puis de miroir', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);

  // Plan XY décalé de 20 mm.
  await clickTool(page, 'tool-plane');
  await page.locator('#draft-offset').fill('20');
  await expect(page.locator('.vp-tag-datum', { hasText: 'Plan 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expect(page.getByRole('list', { name: /Étapes de construction/ })).toContainText('plan XY, décalé de 20 mm');

  // Esquisse sur ce plan : il est proposé avec les plans d'origine.
  await page.click('#tool-sketch');
  await page.locator('.plane-choice', { hasText: 'Plan 1' }).click();
  await expect.poll(async () => (await session(page))?.sketch.support.kind).toBe('datum');
  await expect.poll(async () => (await session(page))?.tool).toBe('rectangle');
  await page.waitForTimeout(450);
  await clickSketch(page, 0.05, 0.05);
  await moveSketch(page, 8, 8);
  await page.keyboard.type('10');
  await page.keyboard.press('Tab');
  await page.keyboard.type('10');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await session(page))?.dof).toBe(0);
  await finishSketch(page);
  await page.click('#tool-extrude');
  await page.locator('#draft-distance').fill('2');
  // Le bloc flotte au-dessus de la plaque : avertissement attendu.
  await expect(page.getByText(/morceaux séparés/)).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, PLATE_VOLUME + 200);
  expect(await appState(page, (s) => Math.round(s.display[s.doc.parts[0].id].result.analysis.bbox.max.z))).toBe(22);

  // Symétrie par rapport au plan : le bloc se retrouve aussi sous la plaque (z de 18 à 20 → 20 à 22 reflétés en 18 à 20).
  await clickTool(page, 'tool-mirror');
  await page.getByRole('button', { name: 'Plan…' }).click();
  await expect(page.locator('#draft-datum')).toHaveValue(await appState(page, (s) => s.doc.parts[0].features.find((f: any) => f.type === 'plane').id));
  await expect.poll(() => appState(page, (s) => Math.round(s.preview?.parts[s.doc.parts[0].id]?.analysis?.bbox?.max.z ?? 0))).toBe(40);
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  // La plaque (0 à 5) se reflète de 35 à 40 ; le bloc (20 à 22) de 18 à 20.
  await expect.poll(() => appState(page, (s) => Math.round(s.display[s.doc.parts[0].id].result.analysis.bbox.max.z))).toBe(40);
  await page.screenshot({ path: 'tests/output/e2e-plan-construction.png' });
});

test('axe de construction : le trou refait en cercle autour d’un axe vertical passant par le milieu de la plaque', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);

  await clickTool(page, 'tool-axis');
  await page.locator('#draft-pos-x').fill('30');
  await page.locator('#draft-pos-y').fill('15');
  await expect(page.locator('.vp-tag-datum', { hasText: 'Axe 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expect(page.getByRole('list', { name: /Étapes de construction/ })).toContainText('selon Z, par (30 ; 15 ; 0 mm)');

  await clickTool(page, 'tool-pattern');
  await page.getByRole('button', { name: 'En cercle' }).click();
  await page.getByRole('button', { name: 'Axe…' }).click();
  await page.locator('#draft-count').fill('2');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, PLATE_VOLUME - Math.PI * 9 * 5);
  await page.screenshot({ path: 'tests/output/e2e-axe-construction.png' });
});

test('plan par trois points (origine, puis deux bouts d’arête cliqués), puis plan perpendiculaire à une arête', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);
  const lastPlane = () => appState(page, (s) => s.doc.parts[0].features.filter((f: any) => f.type === 'plane').at(-1));
  const datum = () => appState(page, (s) => s.display[s.doc.parts[0].id].result.planes.at(-1)?.frame);

  // Trois points : l'origine, puis les deux bouts de l'arête avant du dessus (y = 0, z = 5).
  await clickTool(page, 'tool-plane');
  await page.getByLabel('Construction du plan').selectOption('threePoints');
  await expect.poll(() => appState(page, (s) => s.mode.draft?.fields.pick)).toBe('p0');
  await page.getByRole('button', { name: 'Origine' }).first().click();
  await expect.poll(() => appState(page, (s) => s.mode.draft?.fields.pick)).toBe('p1');
  for (const x of [2, 58]) {
    const at = await worldToScreen(page, x, 0, 5);
    await page.mouse.click(at.x, at.y);
  }
  await expect.poll(() => appState(page, (s) => s.mode.draft?.feature.params.points?.length)).toBe(3);
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  expect((await lastPlane()).params.points[0]).toEqual({ kind: 'origin' });
  expect((await lastPlane()).params.offset).toBe(0);
  await expect.poll(async () => Math.abs((await datum())?.normal.y ?? 0)).toBeCloseTo(1, 4);

  // Perpendiculaire à l'arête avant, à 25 % : normale selon X, passe par x = 15.
  await clickTool(page, 'tool-plane');
  await page.getByLabel('Construction du plan').selectOption('normalToEdge');
  await expect.poll(() => appState(page, (s) => s.mode.draft?.fields.pick)).toBe('edgeRef');
  const mid = await worldToScreen(page, 30, 0, 5);
  await page.mouse.click(mid.x, mid.y);
  await expect.poll(() => appState(page, (s) => !!s.mode.draft?.feature.params.edge)).toBe(true);
  await page.locator('#draft-along').fill('25');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expect(page.getByRole('list', { name: /Étapes de construction/ })).toContainText('perpendiculaire à une arête, à 25 %');
  await expect.poll(async () => Math.abs((await datum())?.normal.x ?? 0)).toBeCloseTo(1, 4);
  const f = (await datum())!;
  expect(Math.abs(f.origin.x)).toBeCloseTo(15, 3);
  // Plan par trois points : y = 0 (pas de décalage hérité du plan décalé par défaut).
  expect(Math.abs((await appState(page, (s) => s.display[s.doc.parts[0].id].result.planes[0].frame.origin.y)))).toBeCloseTo(0, 4);
});
