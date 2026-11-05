import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { clickSketch, expectVolume, finishSketch, moveSketch, openApp, session, volumes } from './helpers';

async function openSketch(page: import('@playwright/test').Page) {
  await page.click('#tool-sketch');
  await page.getByRole('button', { name: /Plan XY/ }).click();
  await expect.poll(async () => (await session(page))?.tool).toBe('rectangle');
  await page.waitForTimeout(450);
  await page.click('#sk-stamp');
  await expect.poll(async () => (await session(page))?.tool).toBe('stamp');
}

test('poser un tampon de la galerie sur l’origine, le régler, l’extruder', async ({ page }) => {
  await openApp(page);
  await openSketch(page);
  await expect(page.locator('.stamp-tile')).toHaveCount(18);
  await page.screenshot({ path: 'tests/output/e2e-tampon-galerie.png' });

  await page.getByRole('button', { name: 'Cœur', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cœur', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#sketch-stamp-size').fill('40');
  await moveSketch(page, 0.2, 0.2);
  await clickSketch(page, 0.2, 0.2);
  await expect.poll(async () => (await session(page))?.sketch.entities.filter((e: any) => e.type === 'stamp').length).toBe(1);
  await expect.poll(async () => (await session(page))?.sketch.constraints.some((c: any) => c.type === 'coincident' && c.a === 'origin')).toBe(true);
  await page.screenshot({ path: 'tests/output/e2e-tampon-pose.png' });

  await page.keyboard.press('Escape');
  await expect.poll(async () => (await session(page))?.tool).toBe('select');
  // Clic sur le tampon : ses réglages reviennent, la taille change le dessin.
  await clickSketch(page, 12, 8);
  await expect(page.locator('#sketch-stamp-size')).toBeVisible();
  await page.locator('#sketch-stamp-size').fill('50');
  await expect.poll(async () => (await session(page))?.sketch.entities.find((e: any) => e.type === 'stamp')?.size).toBe(50);

  await finishSketch(page);
  await page.click('#tool-extrude');
  await page.locator('#draft-distance').fill('5');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expect.poll(async () => (await volumes(page))[0] ?? 0).toBeGreaterThan(50 * 50 * 5 * 0.4);
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'tests/output/e2e-tampon-extrude.png' });
});

test('importer un SVG : il devient une forme, un mauvais fichier est expliqué', async ({ page }, info) => {
  await openApp(page);
  await openSketch(page);
  const chooseFile = async (name: string, content: string) => {
    const path = info.outputPath(name);
    writeFileSync(path, content);
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Importer un SVG…' }).click();
    await (await chooser).setFiles(path);
  };

  await chooseFile('croise.svg', '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="40" cy="50" r="30"/><circle cx="60" cy="50" r="30"/></svg>');
  await expect(page.getByText(/se chevauchent/)).toBeVisible();

  await chooseFile('maison.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><title>Maison</title><path d="M50 10 L90 50 V90 H10 V50 Z"/></svg>');
  await expect.poll(async () => (await session(page))?.stampOptions.shape?.name).toBe('Maison');
  await expect(page.getByRole('button', { name: 'Maison', exact: true })).toHaveAttribute('aria-pressed', 'true');

  await clickSketch(page, 30, 30);
  await page.keyboard.press('Escape');
  await finishSketch(page);
  await page.click('#tool-extrude');
  await page.locator('#draft-distance').fill('2');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  // Maison de 80 × 80 dans le fichier (aire 4800), ramenée à 30 mm de plus grand côté.
  await expectVolume(page, 4800 * (30 / 80) ** 2 * 2);
});
