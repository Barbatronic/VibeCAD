import { expect, test } from '@playwright/test';
import { openApp, openFileMenu } from './helpers';

const BASE = 'http://localhost:5174/';

test('niveaux : Débutant par défaut (outils de base), Intermédiaire puis Expert, niveau retenu', async ({ page }) => {
  await openApp(page, BASE);
  const level = page.getByLabel('Niveau de l’interface');
  await expect(level).toHaveValue('debutant');
  // Débutant : esquisse, extrusion, poche ; pas de révolution, ni d'assemblage, ni d'import.
  await expect(page.locator('#tool-extrude')).toBeVisible();
  await expect(page.locator('#tool-pocket')).toBeVisible();
  await expect(page.locator('#tool-revolve')).toHaveCount(0);
  await expect(page.locator('#tool-pattern')).toHaveCount(0);
  await expect(page.locator('#tab-assembly')).toHaveCount(0);
  // L'import STEP / STL (menu Fichier) est un outil Expert ; les formes toutes faites sont pour tous.
  await expect(page.locator('#tool-primitive')).toBeVisible();
  await openFileMenu(page);
  await expect(page.getByRole('menuitem', { name: /Importer un fichier/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.click('#tool-sketch');
  await page.getByRole('button', { name: /Plan XY/ }).click();
  await expect(page.locator('#sk-line')).toBeVisible();
  await expect(page.locator('#sk-coincident')).toBeVisible();
  await expect(page.locator('#sk-trim')).toHaveCount(0);
  await expect(page.locator('#sk-parallel')).toHaveCount(0);
  // Rectangle et cercle seuls : sans leurs variantes.
  await expect(page.locator('#sk-centerRectangle')).toHaveCount(0);
  await expect(page.locator('#sk-arc')).toHaveCount(0);
  await page.screenshot({ path: 'tests/output/e2e-niveau-debutant.png' });
  // Raccourci d'un outil masqué : ignoré.
  await page.keyboard.press('t');
  await expect.poll(() => page.evaluate(() => (window as any).vibecad.store.get().mode.session.tool)).not.toBe('trim');

  // Intermédiaire : les outils apparaissent, même en pleine esquisse.
  await level.selectOption('intermediaire');
  await expect(page.locator('#sk-trim')).toBeVisible();
  await expect(page.locator('#sk-parallel')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Annuler/ }).last().click();
  await expect(page.locator('#tool-revolve')).toBeVisible();
  await expect(page.locator('#tab-assembly')).toBeVisible();

  // Retenu après rechargement.
  await page.reload();
  await page.waitForFunction(() => (window as any).vibecad?.store?.get().kernel.status === 'ready');
  await expect(page.getByLabel('Niveau de l’interface')).toHaveValue('intermediaire');
  await page.getByLabel('Niveau de l’interface').selectOption('expert');
  await openFileMenu(page);
  await expect(page.getByRole('menuitem', { name: /Importer un fichier/ })).toBeVisible();
});
