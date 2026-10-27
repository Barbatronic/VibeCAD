import { expect, test } from '@playwright/test';
import { appState, buildPlateViaUi, expectVolume, openApp, volumes } from './helpers';

const HOLE = Math.PI * 9 * 5;

test('répétition : le trou refait 3 fois en ligne, puis en grille 3 × 2', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);
  await expectVolume(page, 9000 - HOLE);

  await page.click('#tool-pattern');
  // L'étape proposée est la dernière poche (le trou).
  const steps = page.getByRole('group', { name: 'Étapes à répéter' });
  await expect(steps.getByRole('checkbox', { name: 'Poche 1' })).toBeChecked();
  await expect(steps.getByRole('checkbox', { name: 'Poche 1' })).toBeDisabled();
  await expect(steps.getByRole('checkbox', { name: 'Extrusion 1' })).not.toBeChecked();
  await page.locator('#draft-count').fill('3');
  await page.locator('#draft-spacing').fill('15');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, 9000 - 3 * HOLE);
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'tests/output/e2e-repetition.png' });

  // Modifier : ajouter une deuxième direction (Y, 10 mm).
  const history = page.getByRole('list', { name: /Étapes de construction/ });
  await history.locator('.feature-main', { hasText: 'Répétition 1' }).dblclick();
  await page.getByText('Deuxième direction (grille)').click();
  await page.locator('#draft-spacing2').fill('10');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, 9000 - 6 * HOLE);
  expect(await appState(page, (s) => s.doc.parts[0].features.at(-1).params.second)).toMatchObject({ count: 2, spacing: 10, axis: { kind: 'axis', axis: 'Y' } });

  // Annuler revient à la ligne de trois trous.
  await page.keyboard.press('Control+z');
  await expectVolume(page, 9000 - 3 * HOLE);

  // Plusieurs étapes à la fois : la plaque (Extrusion 1) est répétée avec le trou, dans l'ordre
  // de l'historique ; la cocher seule n'est plus bloquée, décocher la dernière l'est.
  await history.locator('.feature-main', { hasText: 'Répétition 1' }).dblclick();
  await page.getByRole('group', { name: 'Étapes à répéter' }).getByRole('checkbox', { name: 'Extrusion 1' }).check();
  await expect(page.getByRole('group', { name: 'Étapes à répéter' }).getByRole('checkbox', { name: 'Poche 1' })).toBeEnabled();
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.screenshot({ path: 'tests/output/e2e-repetition-plusieurs.png' });
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  const params = await appState(page, (s) => s.doc.parts[0].features.at(-1).params);
  expect([params.sourceId, ...params.extraSourceIds]).toEqual(await appState(page, (s) => s.doc.parts[0].features.filter((f: any) => f.name === 'Extrusion 1' || f.name === 'Poche 1').map((f: any) => f.id)));
  // Trois plaques décalées de 15 mm (90 mm de long en tout), percées des copies du trou ; une copie
  // de plaque rebouche en partie le trou d'origine (x = 15), d'où un volume entre ces bornes.
  await expect.poll(async () => (await volumes(page))[0] ?? 0).toBeGreaterThan(90 * 30 * 5 - 3 * HOLE);
  expect((await volumes(page))[0]).toBeLessThan(90 * 30 * 5 - 2 * HOLE);
});
