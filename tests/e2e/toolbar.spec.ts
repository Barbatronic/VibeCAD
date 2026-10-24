import { expect, test, type Page } from '@playwright/test';
import { buildPlateViaUi, clickTool, openApp } from './helpers';

/** La barre tient sur une ligne, sans rien qui dépasse. */
const fits = (page: Page) =>
  page.evaluate(() => {
    const bar = document.querySelector('.topbar') as HTMLElement;
    return { fits: bar.scrollWidth <= bar.clientWidth + 1 && bar.getBoundingClientRect().height < 80, compact: bar.dataset.compact ?? '0', overflow: !!bar.dataset.overflow };
  });

for (const width of [1850, 1440, 1280]) {
  test(`barre d’outils : tient sur une ligne à ${width} px, sans tiroir (Expert, pièces, assemblage, esquisse)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openApp(page);
    await expect.poll(async () => (await fits(page)).fits).toBe(true);
    expect((await fits(page)).overflow).toBe(false);
    // 1 850 px : tous les outils sortis, avec leur nom (au plus Annuler / Rétablir en icônes).
    if (width === 1850) {
      expect(Number((await fits(page)).compact)).toBeLessThanOrEqual(1);
      expect(await page.locator('.sector.is-grouped, .sector.is-folded').count()).toBe(0);
    }
    await page.click('#tab-assembly');
    await expect.poll(async () => (await fits(page)).fits).toBe(true);
    await page.click('#tab-parts');
    await page.click('#tool-sketch');
    await page.getByRole('button', { name: /Plan XY/ }).click();
    await expect(page.locator('#sk-trim')).toBeVisible();
    await expect.poll(async () => (await fits(page)).fits).toBe(true);
  });
}

test('barre d’outils : écran étroit, les derniers outils passent dans le tiroir « Plus », qui fonctionne', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await openApp(page);
  // Très petit écran : menu et ateliers sur une ligne, les outils sur la suivante, rien ne dépasse.
  await expect.poll(() => page.evaluate(() => { const bar = document.querySelector('.topbar') as HTMLElement; return bar.scrollWidth <= bar.clientWidth + 1; })).toBe(true);
  const tabTop = (await page.locator('#tab-parts').boundingBox())!.y;
  expect((await page.locator('.toolbar').boundingBox())!.y).toBeGreaterThan(tabTop + 20);
  expect(await fits(page)).toMatchObject({ compact: '4', overflow: true });
  // Menu et ateliers (en icônes) restent dans la barre.
  await expect(page.getByRole('button', { name: 'Fichier' })).toBeVisible();
  await expect(page.locator('#tab-assembly')).toBeVisible();
  const more = page.getByRole('button', { name: 'Plus d’outils' });
  await expect(more).toBeVisible();
  // Un outil masqué dans la barre est accessible dans le tiroir, avec son nom.
  const measure = page.getByRole('button', { name: /Mesurer/ });
  await expect(measure).toBeHidden();
  await more.click();
  await expect(page.locator('.toolbar.is-expanded')).toBeVisible();
  await expect(measure).toBeVisible();
  await page.screenshot({ path: 'tests/output/e2e-barre-tiroir.png' });
  // Échap referme ; un outil du tiroir le referme aussi après usage.
  await page.keyboard.press('Escape');
  await expect(page.locator('.toolbar.is-expanded')).toHaveCount(0);
  await more.click();
  await page.locator('.toolbar.is-expanded').getByRole('button', { name: /^Esquisse/ }).click();
  await expect(page.locator('.toolbar.is-expanded')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Plan XY/ })).toBeVisible();
});

test('barre d’outils : la pièce construite, la barre suit la fenêtre qu’on rétrécit puis agrandit', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);
  await page.setViewportSize({ width: 680, height: 900 });
  await expect.poll(async () => (await fits(page)).fits).toBe(true);
  expect(Number((await fits(page)).compact)).toBeGreaterThan(0);
  await page.setViewportSize({ width: 1900, height: 900 });
  await expect.poll(async () => Number((await fits(page)).compact)).toBeLessThanOrEqual(1);
  await expect.poll(() => page.locator('.sector.is-grouped, .sector.is-folded').count()).toBe(0);
  await expect.poll(async () => (await fits(page)).fits).toBe(true);
});

test('barre d’outils : secteurs encadrés, tous sortis sur grand écran, regroupés puis repliés quand la place manque', async ({ page }) => {
  await page.setViewportSize({ width: 1850, height: 900 });
  await openApp(page);
  const sectors = page.locator('.toolbar .sector[data-fold]');
  await expect(sectors.locator('.sector-name')).toHaveText(['Esquisse', 'Ajouter', 'Enlever', 'Modifier', 'Répéter', 'Tôle']);
  await expect(page.locator('#tool-draft')).toBeVisible();
  await expect(page.locator('.sector .split-toggle:visible')).toHaveCount(0);
  await page.screenshot({ path: 'tests/output/e2e-barre-secteurs.png' });

  // Plus étroit : « Répéter » se regroupe en premier, ses outils rares passent dans son menu.
  await page.setViewportSize({ width: 1150, height: 900 });
  await expect(page.getByRole('group', { name: 'Répéter' })).toHaveClass(/is-grouped|is-folded/);
  await expect(page.locator('#tool-move')).toBeHidden();
  await page.getByRole('button', { name: 'Autres outils : répétitions, symétries et déplacements' }).click();
  await expect(page.getByRole('menuitem', { name: /Déplacer/ })).toBeVisible();
  await page.keyboard.press('Escape');
  // Les outils gardent leur nom tant que les secteurs peuvent se replier.
  expect(Number((await fits(page)).compact)).toBeLessThan(2);
  await clickTool(page, 'tool-plane');
  await expect.poll(() => page.evaluate(() => (window as any).vibecad.store.get().mode.kind)).not.toBe('model');
});
