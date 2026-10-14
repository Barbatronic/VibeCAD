import { expect, test, type Page } from '@playwright/test';
import { expectVolume, openApp } from './helpers';

/** Pièces visibles dans la vue, dans l'ordre du document. */
const shown = (page: Page) =>
  page.evaluate(() => {
    const c = (window as any).vibecad.controller;
    return c.state.doc.parts.map((p: any) => !!c.viewport.parts.get(p.id)?.group.visible);
  });

async function addBox(page: Page, x: number, index: number) {
  if (index > 0) await page.click('#part-add');
  await page.click('#tool-primitive');
  await page.locator('#draft-pos-x').fill(String(x));
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, 8000, index);
}

test('isoler une pièce en un clic, puis revenir exactement à l’affichage d’avant', async ({ page }) => {
  await openApp(page);
  await addBox(page, 0, 0);
  await addBox(page, 30, 1);
  await addBox(page, 60, 2);
  // La pièce 3 est masquée avant d'isoler.
  await page.getByRole('button', { name: 'Masquer « Pièce 3 »' }).click();
  await expect.poll(() => shown(page)).toEqual([true, true, false]);

  await page.getByRole('button', { name: /Isoler « Pièce 1 »/ }).click();
  await expect.poll(() => shown(page)).toEqual([true, false, false]);
  await expect(page.getByRole('status').filter({ hasText: '« Pièce 1 » est isolée' })).toBeVisible();
  await page.screenshot({ path: 'tests/output/e2e-isoler.png' });

  // Second clic : retour à l'état d'avant (la pièce 3 reste masquée), sans rien enregistrer.
  await page.getByRole('button', { name: 'Réafficher toutes les pièces' }).click();
  await expect.poll(() => shown(page)).toEqual([true, true, false]);
  expect(await page.evaluate(() => (window as any).vibecad.controller.state.doc.parts.map((p: any) => p.visible))).toEqual([true, true, false]);

  // Isoler une pièce masquée l'affiche seule ; « Tout réafficher » revient en arrière.
  await page.getByRole('button', { name: /Isoler « Pièce 3 »/ }).click();
  await expect.poll(() => shown(page)).toEqual([false, false, true]);
  await page.getByRole('button', { name: 'Tout réafficher' }).click();
  await expect.poll(() => shown(page)).toEqual([true, true, false]);
});
