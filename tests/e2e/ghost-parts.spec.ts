import { expect, test, type Page } from '@playwright/test';
import { expectVolume, openApp } from './helpers';

/** Apparence affichée de chaque pièce, dans l'ordre du document. */
const appearances = (page: Page) =>
  page.evaluate(() => {
    const c = (window as any).vibecad.controller;
    return c.state.doc.parts.map((p: any) => c.viewport.parts.get(p.id)?.appearance ?? null);
  });

test('pendant une opération ou une esquisse, les autres pièces deviennent transparentes', async ({ page }) => {
  await openApp(page);
  await page.click('#tool-primitive');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, 8000);

  // Seconde pièce : une boîte posée à côté.
  await page.click('#tool-new-part');
  await page.click('#tool-primitive');
  await page.locator('#draft-pos-x').fill('40');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await expect.poll(() => appearances(page)).toEqual(['ghost', 'preview']);
  await page.screenshot({ path: 'tests/output/e2e-pieces-fantomes.png' });
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, 8000, 1);
  await expect.poll(() => appearances(page)).toEqual(['normal', 'normal']);

  // Esquisse sur la seconde pièce : la première est fantôme, la seconde estompée.
  await page.click('#tool-sketch');
  await page.getByRole('button', { name: /Plan XY/ }).click();
  await expect.poll(() => appearances(page)).toEqual(['ghost', 'dimmed']);
  await page.getByRole('button', { name: 'Annuler', exact: true }).click();
  await expect.poll(() => appearances(page)).toEqual(['normal', 'normal']);
});
