import { expect, test } from '@playwright/test';
import { clickTool, openApp } from './helpers';

test('profilé : un 20 × 40 V-slot de 300 mm depuis le ruban', async ({ page }) => {
  await openApp(page);
  await clickTool(page, 'tool-beam');
  await page.locator('#draft-beam-size').selectOption('2040');
  await page.locator('#draft-length').fill('300');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.screenshot({ path: 'tests/output/e2e-profile.png' });
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  // Section 20 × 40 rainurée, sur 300 mm.
  await expect
    .poll(() => page.evaluate(() => (window as any).vibecad.controller.state.display[(window as any).vibecad.controller.state.doc.parts[0].id]?.result.analysis?.bbox))
    .toMatchObject({ min: { z: 0 }, max: { z: 300 } });
});

test('profilé : MakerBeam 10 × 10 (la section suit le système)', async ({ page }) => {
  await openApp(page);
  await clickTool(page, 'tool-beam');
  await page.getByRole('button', { name: 'MakerBeam', exact: true }).click();
  await expect(page.locator('#draft-beam-size')).toHaveValue('1010');
  await expect(page.locator('#draft-beam-size option')).toHaveCount(1);
  await expect(page.getByText(/MakerBeam · rainure 3 mm/)).toBeVisible();
  await page.locator('#draft-length').fill('150');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).vibecad.controller.state.display[(window as any).vibecad.controller.state.doc.parts[0].id]?.result.analysis?.bbox))
    .toMatchObject({ min: { x: -5, y: -5, z: 0 }, max: { x: 5, y: 5, z: 150 } });
  // Retour en V-slot : la section reprend la gamme série 20.
  await page.evaluate(() => (window as any).vibecad.controller.editFeature((window as any).vibecad.controller.state.doc.parts[0].features[0].id));
  await page.getByRole('button', { name: 'V-slot', exact: true }).click();
  await expect(page.locator('#draft-beam-size')).toHaveValue('2020');
});
