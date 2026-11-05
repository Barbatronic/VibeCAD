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

test('importer un SVG : tracé exact, ou retravaillé quand le fichier pose problème', async ({ page }, info) => {
  await openApp(page);
  await openSketch(page);
  const dialog = page.getByRole('dialog', { name: 'Importer un dessin' });
  const chooseFile = async (name: string, content: string) => {
    const path = info.outputPath(name);
    writeFileSync(path, content);
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Importer un dessin…' }).click();
    await (await chooser).setFiles(path);
    await expect(dialog).toBeVisible();
  };

  // Deux formes qui se chevauchent : refusées telles quelles, réunies une fois retravaillées.
  await chooseFile('chevauche.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100"><circle cx="45" cy="50" r="30"/><circle cx="75" cy="50" r="30"/></svg>');
  await expect(dialog.getByText(/se chevauchent/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Tracé du fichier' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Retravailler' })).toHaveCount(0);
  await expect(dialog.getByText(/Inkscape/)).toHaveCount(0);
  await expect.poll(async () => (await dialog.locator('.trace-result path').getAttribute('d'))?.match(/M/g)?.length).toBe(1);
  await page.screenshot({ path: 'tests/output/e2e-import-svg-retravailler.png' });
  await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();

  // Des traits ouverts, refusés par la lecture directe, gardent leur épaisseur.
  await chooseFile('trait.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><path d="M20 20 L80 80" fill="none" stroke="#000" stroke-width="12"/></svg>');
  await expect.poll(async () => (await dialog.locator('.trace-result path').getAttribute('d'))?.match(/M/g)?.length).toBe(1);
  await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();

  // Un SVG sain : le tracé exact d'abord, avec son titre pour nom.
  await chooseFile('maison.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><title>Maison</title><path d="M50 10 L90 50 V90 H10 V50 Z"/></svg>');
  await expect(dialog.getByRole('button', { name: 'Tracé du fichier' })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByLabel('Nom du tampon')).toHaveValue('Maison');
  await expect(dialog.locator('canvas')).toBeHidden();
  await expect(dialog.getByLabel('Noir et blanc')).toHaveCount(0);
  await page.screenshot({ path: 'tests/output/e2e-import-svg-exact.png' });
  await dialog.getByRole('button', { name: 'Utiliser ce dessin' }).click();
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

test('vectoriser la photo d’un dessin : forme pleine, traits seuls, gomme, puis extrusion', async ({ page }, info) => {
  await openApp(page);
  await openSketch(page);
  // Un cercle tracé au feutre sur un papier gris, avec une tache à côté et un trait à gommer.
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 400;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#d8d4cc';
    ctx.fillRect(0, 0, 400, 400);
    ctx.strokeStyle = ctx.fillStyle = '#222';
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.arc(180, 200, 120, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(30, 30, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(350, 60, 30, 280);
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  const path = info.outputPath('dessin.png');
  writeFileSync(path, Buffer.from(png, 'base64'));
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Importer un dessin…' }).click();
  await (await chooser).setFiles(path);

  const dialog = page.getByRole('dialog', { name: 'Importer un dessin' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.trace-result svg')).toBeVisible();
  await page.screenshot({ path: 'tests/output/e2e-vectoriser.png' });
  const outline = async () => dialog.locator('.trace-result path').getAttribute('d');

  // La tache est retirée d'office : restent le cercle et le trait de droite.
  const contours = async () => (await outline())?.match(/M/g)?.length ?? 0;
  await expect.poll(contours).toBe(2);

  // Traits seuls : l'intérieur du cercle revient en trou, donc un contour de plus.
  await dialog.getByRole('button', { name: 'Traits seuls' }).click();
  await expect.poll(contours).toBe(3);
  await dialog.getByRole('button', { name: 'Forme pleine' }).click();
  await expect.poll(contours).toBe(2);

  // Gomme : le trait de droite disparaît.
  const box = (await dialog.locator('canvas').boundingBox())!;
  for (const x of [0.88, 0.92, 0.96]) {
    await page.mouse.move(box.x + box.width * x, box.y + box.height * 0.1);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * x, box.y + box.height * 0.9, { steps: 12 });
    await page.mouse.up();
  }
  await expect.poll(contours).toBe(1);
  await page.screenshot({ path: 'tests/output/e2e-vectoriser-gomme.png' });

  await dialog.getByLabel('Nom du tampon').fill('Mon rond');
  await dialog.getByRole('button', { name: 'Utiliser ce dessin' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await session(page))?.stampOptions.shape?.name).toBe('Mon rond');

  await page.locator('#sketch-stamp-size').fill('40');
  await clickSketch(page, 25, 25);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await finishSketch(page);
  await page.click('#tool-extrude');
  await page.locator('#draft-distance').fill('5');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  // Disque plein de 40 mm de diamètre (la surface tolère le rendu du trait).
  await expect.poll(async () => (await volumes(page))[0] ?? 0).toBeGreaterThan(Math.PI * 400 * 5 * 0.9);
  expect((await volumes(page))[0]!).toBeLessThan(Math.PI * 400 * 5 * 1.05);
});

test('une image illisible est expliquée', async ({ page }, info) => {
  await openApp(page);
  await openSketch(page);
  const path = info.outputPath('faux.png');
  writeFileSync(path, 'pas une image');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Importer un dessin…' }).click();
  await (await chooser).setFiles(path);
  await expect(page.getByText(/n’est pas une image lisible/)).toBeVisible();
});
