import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

const toggle = 'Afficher ou masquer le panneau des pièces';

test('bouton du panneau des pièces : masque puis réaffiche le panneau sur grand écran', async ({ page }) => {
  await openApp(page);
  const panel = page.locator('.left-panel');
  const canvas = page.locator('.vp-canvas');
  await expect(panel).toBeVisible();
  const before = (await canvas.boundingBox())!.width;
  await page.getByRole('button', { name: toggle }).click();
  await expect(panel).toBeHidden();
  // La vue 3D prend la place libérée.
  await expect.poll(async () => (await canvas.boundingBox())!.width).toBeGreaterThan(before + 200);
  await page.screenshot({ path: 'tests/output/e2e-panneau-masque.png' });
  await page.getByRole('button', { name: toggle }).click();
  await expect(panel).toBeVisible();
  await expect.poll(async () => (await canvas.boundingBox())!.width).toBeCloseTo(before, 0);
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
