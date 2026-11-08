import { expect, test } from '@playwright/test';
import { appState, buildPlateViaUi, openApp } from './helpers';

/** Couleur et opacité affichées de la première pièce de la vue. */
const shown = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const v = (window as any).vibecad.controller.viewport;
    const obj = [...v.parts.values()][0];
    const m = obj.faces.material;
    return { color: `#${m.color.getHexString()}`, opacity: Math.round(m.opacity * 100) / 100 };
  });

test('matières : choisir une fiche du catalogue, la voir dans tous les ateliers, la modifier, la garder', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);
  const design = await appState(page, (s) => s.doc.parts[0].color);

  // L'atelier Fabrication s'ouvre sur Matières.
  await page.click('#tab-fabrication');
  await expect(page.getByRole('list', { name: 'Matière de chaque pièce' })).toBeVisible();
  // Un premier choix, puis un autre : le projet ne garde que la matière utilisée.
  await page.getByLabel('Matière de « Pièce 1 »').selectOption({ label: 'PLA rouge' });
  await expect.poll(() => appState(page, (s) => s.doc.materials?.map((m: any) => m.name))).toEqual(['PLA rouge']);
  await page.getByLabel('Matière de « Pièce 1 »').selectOption({ label: 'Acrylique transparent 3 mm' });
  await expect.poll(() => appState(page, (s) => s.doc.materials?.map((m: any) => m.name))).toEqual(['Acrylique transparent 3 mm']);
  await expect(page.getByRole('list', { name: 'Fiches du projet' }).getByRole('listitem')).toHaveCount(1);
  // L'atelier Fabrication montre toujours la matière réelle : translucide.
  await expect.poll(() => shown(page)).toEqual({ color: '#d8eef5', opacity: 0.35 });
  await page.screenshot({ path: 'tests/output/e2e-matieres.png' });

  // Atelier Pièces : couleurs de conception par défaut, matières réelles au choix (retenu).
  await page.click('#tab-parts');
  await expect.poll(() => shown(page)).toEqual({ color: design, opacity: 1 });
  await page.click('#view-display');
  await page.getByRole('menuitemradio', { name: 'Matières réelles' }).click();
  await expect.poll(() => shown(page)).toEqual({ color: '#d8eef5', opacity: 0.35 });

  // La fiche du projet se modifie : la pièce suit (couleur, base donc masse).
  await page.click('#tab-fabrication');
  await page.getByRole('button', { name: /Acrylique transparent 3 mm/ }).click();
  const editor = page.getByRole('group', { name: 'Fiche « Acrylique transparent 3 mm »' });
  await editor.getByLabel('Nom de la matière').fill('Acrylique bleu 3 mm');
  await editor.getByLabel('Nom de la matière').press('Enter');
  await expect.poll(() => appState(page, (s) => s.doc.materials[0].name)).toBe('Acrylique bleu 3 mm');
  await page.getByRole('button', { name: /Acrylique bleu 3 mm/ }).click();
  await page.getByRole('button', { name: /Acrylique bleu 3 mm/ }).click();
  await page.getByRole('group', { name: 'Fiche « Acrylique bleu 3 mm »' }).getByLabel('Couleur de la matière').fill('#2f6fd1');
  await expect.poll(() => shown(page)).toEqual({ color: '#2f6fd1', opacity: 0.35 });

  // Gardée dans « Mon catalogue » : elle survit au rechargement, pour les autres projets.
  await page.getByRole('group', { name: 'Fiche « Acrylique bleu 3 mm »' }).getByRole('button', { name: 'Garder dans mon catalogue' }).click();
  await expect(page.getByRole('list', { name: 'Mon catalogue' })).toContainText('Acrylique bleu 3 mm');
  // « Nouvelle matière » depuis la pièce : une variante de sa fiche, donnée à la pièce et ouverte.
  await page.click('#tab-parts');
  await page.click('#tab-fabrication');
  await page.getByLabel('Matière de « Pièce 1 »').selectOption({ label: '+ Nouvelle matière…' });
  await expect.poll(() => appState(page, (s) => s.doc.materials.map((m: any) => m.name))).toEqual(['Acrylique bleu 3 mm (variante)']);
  await expect(page.getByRole('group', { name: 'Fiche « Acrylique bleu 3 mm (variante) »' })).toBeVisible();

  await page.reload();
  await page.waitForFunction(() => (window as any).vibecad?.controller);
  await expect.poll(() => appState(page, (s) => s.materialCatalogue.map((m: any) => m.name))).toEqual(['Acrylique bleu 3 mm']);
  await expect.poll(() => appState(page, (s) => s.colorMode)).toBe('materials');

});
