import { expect, test } from '@playwright/test';
import { appState, openApp } from './helpers';

const lastFeature = (page: import('@playwright/test').Page) =>
  appState(page, (s) => {
    const part = s.doc.parts.find((p: any) => p.id === s.activePartId);
    const f = part.features[part.features.length - 1];
    return { name: f.name, kind: f.params.kind, volume: s.display[part.id]?.result.analysis?.volume ?? 0 };
  });

test('générateurs : roue dentée puis poulie GT2 depuis le menu « Forme »', async ({ page }) => {
  await openApp(page);
  const openGenerator = async () => {
    await page.getByRole('button', { name: /Autres outils : formes et générateurs/ }).click();
    await page.click('#tool-menu-gear');
  };
  await openGenerator();
  await expect(page.getByRole('group', { name: 'Pièce à générer' })).toBeVisible();
  // Module 1,5 × 20 dents : Ø primitif 30 mm.
  await expect(page.locator('#draft-gear-figures')).toContainText('Ø primitif 30 mm');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expect.poll(async () => (await lastFeature(page)).volume).toBeGreaterThan(1000);
  expect(await lastFeature(page)).toMatchObject({ name: 'Roue dentée 1', kind: 'spur' });
  await page.screenshot({ path: 'tests/output/e2e-roue-dentee.png' });

  // Nouvelle pièce : poulie GT2 20 dents, le nom suit le choix.
  await page.click('#tool-new-part');
  await openGenerator();
  await page.getByRole('group', { name: 'Pièce à générer' }).getByRole('button', { name: 'Poulie' }).click();
  await expect(page.locator('.right-panel .panel-title')).toContainText('Poulie 1');
  await expect(page.locator('#draft-gear-figures')).toContainText('Ø extérieur 12,22 mm');
  await expect(page.locator('#draft-flanges')).toBeChecked();
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expect.poll(async () => (await lastFeature(page)).volume).toBeGreaterThan(300);
  expect(await lastFeature(page)).toMatchObject({ name: 'Poulie 1', kind: 'pulley' });
  await page.screenshot({ path: 'tests/output/e2e-poulie.png' });
});

test('générateurs : réservés à partir du niveau Intermédiaire', async ({ page }) => {
  await openApp(page, 'http://localhost:5174/?niveau=debutant');
  await expect(page.locator('#tool-primitive')).toBeVisible();
  await expect(page.getByRole('button', { name: /Autres outils : formes et générateurs/ })).toHaveCount(0);
});
