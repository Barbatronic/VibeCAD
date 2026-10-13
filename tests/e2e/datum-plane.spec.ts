import { expect, test } from '@playwright/test';
import { appState, buildPlateViaUi, clickSketch, expectVolume, finishSketch, moveSketch, openApp, PLATE_VOLUME, session } from './helpers';

test('plan de construction : un plan au-dessus de la plaque sert de support à une esquisse, puis de miroir', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);

  // Plan XY décalé de 20 mm.
  await page.getByRole('button', { name: /Autres outils : répétitions, symétries/ }).click();
  await page.click('#tool-menu-plane');
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
  await page.getByRole('button', { name: /Autres outils : répétitions, symétries/ }).click();
  await page.click('#tool-menu-mirror');
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

  await page.getByRole('button', { name: /Autres outils : répétitions, symétries/ }).click();
  await page.click('#tool-menu-axis');
  await page.locator('#draft-pos-x').fill('30');
  await page.locator('#draft-pos-y').fill('15');
  await expect(page.locator('.vp-tag-datum', { hasText: 'Axe 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expect(page.getByRole('list', { name: /Étapes de construction/ })).toContainText('selon Z, par (30 ; 15 ; 0 mm)');

  await page.getByRole('button', { name: /Autres outils : répétitions, symétries/ }).click();
  await page.click('#tool-menu-pattern');
  await page.getByRole('button', { name: 'En cercle' }).click();
  await page.getByRole('button', { name: 'Axe…' }).click();
  await page.locator('#draft-count').fill('2');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, PLATE_VOLUME - Math.PI * 9 * 5);
  await page.screenshot({ path: 'tests/output/e2e-axe-construction.png' });
});
