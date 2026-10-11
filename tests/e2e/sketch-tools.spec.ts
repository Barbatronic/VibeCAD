import { expect, test } from '@playwright/test';
import { buildPlateViaUi, clickSketch, expectVolume, finishSketch, moveSketch, openApp, PLATE_VOLUME, session, worldToScreen } from './helpers';

test('projeter le bord du trou, cercle concentrique, cote d’angle sur une arête reprise, construction', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);
  await page.waitForTimeout(400);

  // Nouvelle esquisse sur le dessus de la plaque.
  const top = await worldToScreen(page, 45, 22, 5);
  await page.mouse.dblclick(top.x, top.y);
  await expect.poll(async () => (await session(page))?.sketch.support.kind).toBe('face');
  await page.waitForTimeout(450);

  // Projeter : le bord du trou (cercle Ø 6 centré en 15, 15) et le bord avant de la plaque.
  await page.click('#sk-project');
  // Les arêtes à reprendre peuvent arriver juste après le choix de l'outil : survoler à nouveau.
  await expect
    .poll(async () => {
      await moveSketch(page, 18 + Math.random() * 0.01, 15);
      return (await session(page))?.projectHover;
    })
    .not.toBeNull();
  await page.screenshot({ path: 'tests/output/e2e-projeter.png' });
  await clickSketch(page, 18, 15);
  await clickSketch(page, 30, 0);
  await expect.poll(async () => (await session(page))?.sketch.entities.filter((e: any) => e.reference).length).toBe(2);

  // Cercle Ø 10 accroché au centre du trou repris : il est entièrement contraint.
  await page.click('#sk-circle');
  await clickSketch(page, 15, 15);
  await page.keyboard.type('10');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await session(page))?.dof).toBe(0);

  // Segment de construction (touche G), puis cote d'angle avec le bord avant repris.
  await page.keyboard.press('g');
  await expect.poll(async () => (await session(page))?.construction).toBe(true);
  await page.click('#sk-line');
  await clickSketch(page, 40, 6);
  await clickSketch(page, 52, 14);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await session(page))?.sketch.entities.filter((e: any) => e.construction).length).toBe(1);
  await page.click('#sk-dimension');
  await clickSketch(page, 46, 10);
  await expect(page.getByRole('dialog', { name: 'Nouvelle cote' })).toBeVisible();
  await clickSketch(page, 25, 0);
  const editor = page.getByRole('dialog', { name: 'Nouvelle cote' });
  await expect(editor.getByLabel('Valeur de l’angle en degrés')).toBeVisible();
  await editor.getByLabel('Valeur de l’angle en degrés').fill('30');
  await page.screenshot({ path: 'tests/output/e2e-cote-angle.png' });
  await editor.getByLabel('Valeur de l’angle en degrés').press('Enter');
  await expect.poll(async () => (await session(page))?.sketch.constraints.some((c: any) => c.type === 'angle' && c.value === 30)).toBe(true);

  // Menu « Autres » : toutes les contraintes, y compris celles de la barre (coïncidence…).
  await expect(page.locator('#sk-more-constraints')).toContainText('Autres');
  await page.click('#sk-more-constraints');
  const menu = page.getByRole('menu', { name: 'Toutes les contraintes' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Coïncidence/ })).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveCount(12);
  await page.screenshot({ path: 'tests/output/e2e-menu-contraintes.png' });
  await page.getByRole('menuitem', { name: /Parallèle/ }).click();
  await expect(page.locator('#sk-more-constraints')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');

  // Extrusion : seul le disque Ø 10 compte (le segment de construction et les arêtes reprises non).
  await finishSketch(page);
  await page.click('#tool-extrude');
  await page.locator('#draft-distance').fill('2');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, PLATE_VOLUME + Math.PI * 25 * 2);
  await page.screenshot({ path: 'tests/output/e2e-bossage.png' });
});
