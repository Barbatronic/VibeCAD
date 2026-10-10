import { expect, test } from '@playwright/test';
import { appState, buildPlateViaUi, expectVolume, openApp, PLATE_VOLUME, session } from './helpers';

test('déplacer une cote à la souris : la pièce ne change pas, double-clic toujours possible, conservé au rechargement', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);
  const history = page.getByRole('list', { name: /Étapes de construction/ });
  await history.locator('.feature-main', { hasText: 'Esquisse 1' }).dblclick();
  await expect.poll(() => appState(page, (s) => s.mode.kind)).toBe('sketch');
  await page.waitForTimeout(450);

  const label = page.locator('.vp-dim', { hasText: '60 mm' });
  const before = (await label.boundingBox())!;
  const entities = (await session(page)).sketch.entities;
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2 + 30, { steps: 4 });
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2 + 60, { steps: 4 });
  await page.mouse.up();
  const after = (await label.boundingBox())!;
  expect(after.y - before.y).toBeGreaterThan(40);
  const s = await session(page);
  expect(s.sketch.entities).toEqual(entities);
  expect(s.sketch.constraints.find((k: any) => k.type === 'length' && k.value === 60).offset).toBeDefined();
  await page.screenshot({ path: 'tests/output/e2e-cote-deplacee.png' });

  // Le double-clic modifie toujours la valeur.
  await page.waitForTimeout(450);
  await label.dblclick();
  await expect(page.getByRole('dialog', { name: 'Modifier la cote' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Annuler ramène la cote à sa place automatique.
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await session(page)).sketch.constraints.find((k: any) => k.type === 'length' && k.value === 60).offset).toBeUndefined();
  await page.keyboard.press('Control+y');
  await page.getByRole('button', { name: 'Terminer l’esquisse' }).click();
  await expectVolume(page, PLATE_VOLUME);

  // Conservé dans le projet (sauvegarde automatique, rechargement).
  await page.waitForTimeout(1600);
  await page.reload();
  await page.waitForFunction(() => (window as any).vibecad?.store?.get().kernel.status === 'ready');
  const recover = page.getByRole('button', { name: /Récupérer|Reprendre/ });
  if (await recover.count()) await recover.first().click();
  await expect
    .poll(() => appState(page, (st) => st.doc.parts[0]?.features[0]?.params.constraints.find((k: any) => k.type === 'length' && k.value === 60)?.offset))
    .toBeDefined();
});
