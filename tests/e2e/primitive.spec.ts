import { expect, test } from '@playwright/test';
import { appState, expectVolume, openApp } from './helpers';

test('forme toute faite au niveau Débutant : une boîte, puis une boule creusée dedans', async ({ page }) => {
  await openApp(page, 'http://localhost:5174/?niveau=debutant');
  await page.click('#tool-primitive');
  const shapes = page.getByRole('group', { name: 'Forme' });
  // Débutant : boîte, cylindre, boule (l'anneau est pour le niveau Intermédiaire).
  await expect(shapes.getByRole('button')).toHaveCount(3);
  await page.locator('#draft-width').fill('40');
  await page.locator('#draft-depth').fill('30');
  await page.locator('#draft-height').fill('10');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, 12000);

  await page.click('#tool-primitive');
  await shapes.getByRole('button', { name: 'Boule' }).click();
  await page.getByRole('group', { name: 'Matière' }).getByRole('button', { name: 'Creuser' }).click();
  await page.locator('#draft-diameter').fill('16');
  await page.locator('#draft-pos-x').fill('20');
  await page.locator('#draft-pos-y').fill('15');
  await page.locator('#draft-pos-z').fill('10');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.screenshot({ path: 'tests/output/e2e-forme-boule.png' });
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, 12000 - ((4 / 3) * Math.PI * 512) / 2);
  expect(await appState(page, (s) => s.doc.parts[0].features.map((f: any) => f.name))).toEqual(['Forme 1', 'Forme 2']);
});
