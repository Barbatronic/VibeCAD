import { expect, test } from '@playwright/test';
import { appState, expectVolume, openApp, openFileMenu } from './helpers';

test('importer un STL : une boîte exportée en STL revient en solide à six faces, gardé dans le projet', async ({ page }) => {
  await openApp(page);
  await page.click('#tool-primitive');
  await page.locator('#draft-width').fill('40');
  await page.locator('#draft-depth').fill('20');
  await page.locator('#draft-height').fill('10');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, 8000);

  // Export STL de la boîte.
  await openFileMenu(page);
  await page.getByRole('menuitem', { name: /Exporter en STL/ }).click();
  const exportDialog = page.getByRole('dialog', { name: /Exporter en STL/ });
  const [download] = await Promise.all([page.waitForEvent('download'), exportDialog.getByRole('button', { name: 'Exporter' }).click()]);
  await download.saveAs('tests/output/e2e-boite.stl');

  // Nouveau projet, puis import du STL.
  await openFileMenu(page);
  await page.getByRole('menuitem', { name: 'Nouveau projet' }).click();
  await page.getByRole('button', { name: 'Ne pas enregistrer' }).click();
  await expect.poll(() => appState(page, (s) => s.doc.parts[0].features.length)).toBe(0);
  await openFileMenu(page);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('menuitem', { name: /Importer un fichier \(STEP, STL\)/ }).click()]);
  await chooser.setFiles('tests/output/e2e-boite.stl');
  const dialog = page.getByRole('dialog', { name: /Importer/ });
  await expect(dialog.getByText(/1 solide trouvé à partir de 12 triangles/)).toBeVisible();
  await expect(dialog.getByText(/surfaces courbes restent en facettes/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Importer' }).click();
  await expectVolume(page, 8000, 1);
  await expect.poll(() => page.evaluate(() => { const c = (window as any).vibecad.controller; return c.state.display[c.state.doc.parts[1].id]?.mesh?.faces.length; })).toBe(6);

  // Gardé dans le projet après enregistrement et rechargement.
  await page.keyboard.press('Control+s');
  await expect(page.getByText(/Projet enregistré/)).toBeVisible();
  await page.reload();
  await page.waitForFunction(() => (window as any).vibecad?.store?.get().kernel.status === 'ready');
  await expectVolume(page, 8000, 1);
  expect(await appState(page, (s) => Object.values(s.doc.resources).map((r: any) => [r.fileName, r.kind]))).toEqual([['e2e-boite.stl', 'stl']]);
});
