import { expect, test, type Page } from '@playwright/test';
import { buildPlateViaUi, openApp } from './helpers';

const toggle = 'Afficher ou masquer le panneau des pièces';

/** Place réservée aux panneaux flottants sur la vue (px). */
const insets = (page: Page) =>
  page.evaluate(() => {
    const main = document.querySelector('.main') as HTMLElement;
    const v = (name: string) => parseFloat(main.style.getPropertyValue(name)) || 0;
    return { left: v('--vp-inset-l'), right: v('--vp-inset-r'), top: v('--vp-inset-t') };
  });

test('panneau des pièces sur grand écran : la languette le replie et le rouvre (pas de bouton de tiroir)', async ({ page }) => {
  await openApp(page);
  const panel = page.locator('.left-panel');
  await expect(panel).toBeVisible();
  await expect(page.getByRole('button', { name: toggle })).toBeHidden();
  // La vue occupe toute la largeur ; le panneau flotte dessus et sa place est réservée.
  const main = (await page.locator('.main').boundingBox())!;
  expect((await page.locator('.vp-canvas').boundingBox())!.width).toBeCloseTo(main.width, 0);
  await expect.poll(async () => (await insets(page)).left).toBeGreaterThan(280);
  await page.getByRole('button', { name: 'Replier le panneau de gauche' }).click();
  await expect(panel).toBeHidden();
  await expect.poll(async () => (await insets(page)).left).toBe(0);
  await page.screenshot({ path: 'tests/output/e2e-panneau-masque.png' });
  await page.getByRole('button', { name: 'Afficher le panneau de gauche' }).click();
  await expect(panel).toBeVisible();
  await expect.poll(async () => (await insets(page)).left).toBeGreaterThan(280);
});

test('barre et panneaux flottants : barre calée à gauche, languettes pour replier et rouvrir, réglages rouverts par une opération', async ({ page }) => {
  await openApp(page);
  const left = page.locator('.left-panel');
  const right = page.locator('.right-panel');
  // Panneau translucide et flouté, aux coins arrondis.
  // (le flou est porté par le fond ::before, pour que les menus contenus floutent aussi la vue).
  const style = await left.evaluate((el) => ({ radius: parseFloat(getComputedStyle(el).borderTopLeftRadius), blur: getComputedStyle(el, '::before').backdropFilter }));
  expect(style.radius).toBeGreaterThan(8);
  expect(style.blur).toContain('blur');
  // Barre flottante, calée à gauche (le menu et les ateliers restent en place d'un atelier à
  // l'autre) ; la vue passe dessous (place réservée en haut).
  const bar = (await page.locator('.topbar').boundingBox())!;
  expect(bar.x).toBeCloseTo(10, 0);
  const tabX = (await page.locator('#tab-parts').boundingBox())!.x;
  await page.click('#tab-assembly');
  expect((await page.locator('#tab-parts').boundingBox())!.x).toBeCloseTo(tabX, 0);
  await page.click('#tab-parts');
  expect((await page.locator('.vp-canvas').boundingBox())!.y).toBeLessThan(bar.y);
  await expect.poll(async () => (await insets(page)).top).toBeGreaterThan(bar.height);
  const panelBox = (await left.boundingBox())!;
  expect(panelBox.y).toBeGreaterThan(bar.y + bar.height);
  // Pas d'opération en cours : pas de panneau de droite, pas de languette.
  await expect(right).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Replier le panneau de droite' })).toBeHidden();

  await page.getByRole('button', { name: 'Replier le panneau de gauche' }).click();
  await expect(left).toBeHidden();
  await page.getByRole('button', { name: 'Afficher le panneau de gauche' }).click();
  await expect(left).toBeVisible();

  // Une esquisse : réglages à droite, place réservée, puis repliés contre le bord.
  await page.click('#tool-sketch');
  await expect(right).toBeVisible();
  await expect.poll(async () => (await insets(page)).right).toBeGreaterThan(330);
  await page.getByRole('button', { name: 'Replier le panneau de droite' }).click();
  await expect(right).toBeHidden();
  await expect.poll(async () => (await insets(page)).right).toBe(0);
  // Les boutons de vue suivent le bord de la zone libre.
  const controls = (await page.locator('.view-controls').boundingBox())!;
  expect(controls.x + controls.width).toBeGreaterThan(page.viewportSize()!.width - 30);
  await page.getByRole('button', { name: 'Afficher le panneau de droite' }).click();
  await expect(right).toBeVisible();

  // Repliés puis nouvelle opération : les réglages se rouvrent d'eux-mêmes.
  await page.getByRole('button', { name: 'Replier le panneau de droite' }).click();
  await expect(right).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(right).toHaveCount(0);
  await page.click('#tool-sketch');
  await expect(right).toBeVisible();
});

test('bouton du panneau des pièces : ouvre et ferme le tiroir sur écran étroit', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await openApp(page);
  const panel = page.locator('.left-panel');
  const inView = async () => {
    const box = await panel.boundingBox();
    return !!box && box.x + box.width > 10;
  };
  await expect.poll(inView).toBe(false);
  await page.getByRole('button', { name: toggle }).click();
  await expect.poll(inView).toBe(true);
  await page.getByRole('button', { name: toggle }).click();
  await expect.poll(inView).toBe(false);
});

test('la barre d’outils tient sur une ligne à 1440 px (pièces et esquisse)', async ({ page }) => {
  await openApp(page);
  const oneLine = () => page.evaluate(() => (document.querySelector('.topbar') as HTMLElement).getBoundingClientRect().height < 80);
  expect(await oneLine()).toBe(true);
  await page.click('#tool-sketch');
  await page.getByRole('button', { name: /Plan XY/ }).click();
  await expect(page.locator('#sk-trim')).toBeVisible();
  expect(await oneLine()).toBe(true);
});

test('pièces et historique repliables : seuls la pièce et l’étape choisies restent visibles', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);
  await page.click('#part-add');
  await page.click('#part-add');
  const rows = page.locator('.part-list .part-row');
  await expect(rows).toHaveCount(3);
  // Pièces repliées : seule la pièce active reste (la dernière ajoutée), le nombre total est indiqué.
  await page.getByRole('button', { name: /^Pièces/ }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Pièce 3');
  await expect(page.locator('.panel-header .count').first()).toHaveText('3');
  await page.getByRole('button', { name: /^Pièces/ }).click();
  await expect(rows).toHaveCount(3);
  await page.locator('.part-select', { hasText: 'Pièce 1' }).click();

  // Historique replié : la dernière étape, puis l'étape choisie.
  const steps = page.getByRole('list', { name: /Étapes de construction/ }).getByRole('listitem');
  await expect(steps).toHaveCount(4);
  await page.getByRole('button', { name: /^Historique/ }).click();
  await expect(steps).toHaveCount(1);
  await expect(steps).toContainText('Poche 1');
  await page.getByRole('button', { name: /^Historique/ }).click();
  await page.locator('.feature-main', { hasText: 'Extrusion 1' }).click();
  await page.getByRole('button', { name: /^Historique/ }).click();
  await expect(steps).toHaveCount(1);
  await expect(steps).toContainText('Extrusion 1');
  // Le repli est gardé d'un atelier à l'autre.
  await page.click('#tab-assembly');
  await page.click('#tab-parts');
  await expect(steps).toHaveCount(1);
});
