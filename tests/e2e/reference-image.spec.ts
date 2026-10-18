import { deflateSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import { appState, clickTool, openApp } from './helpers';

/** PNG 200 × 100 : fond blanc, carré noir de 40 × 40 au centre. */
function testPng(): Buffer {
  const w = 200;
  const h = 100;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const black = x >= 80 && x < 120 && y >= 30 && y < 70;
      raw.fill(black ? 0 : 255, y * (w * 3 + 1) + 1 + x * 3, y * (w * 3 + 1) + 4 + x * 3);
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(2, 9);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * Clique un point (normalisé, y vers le haut) de l'image dans la fenêtre de réglage : l'image est
 * centrée et ajustée au cadre de 860 × 520 (proportions gardées).
 */
async function clickImage(page: Page, x: number, y: number, image = { w: 200, h: 100 }) {
  const box = (await page.locator('.image-calibration canvas').boundingBox())!;
  const k = Math.min(860 / image.w, 520 / image.h);
  const ox = (860 - image.w * k) / 2;
  const oy = (520 - image.h * k) / 2;
  const s = box.width / 860;
  await page.mouse.click(box.x + (ox + x * image.w * k) * s, box.y + (oy + (1 - y) * image.h * k) * s);
}

const imageParams = (page: Page) => appState(page, (s) => (s.mode.kind === 'feature' ? s.mode.draft.feature.params : null));

test('image de référence : import, mise à l’échelle par 2 points, redressement, affichage sous l’esquisse', async ({ page }) => {
  await openApp(page);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), clickTool(page, 'tool-image')]);
  await chooser.setFiles({ name: 'photo.png', mimeType: 'image/png', buffer: testPng() });
  await expect(page.locator('#draft-image-width')).toHaveValue('100');
  expect((await imageParams(page))!.pixels).toEqual({ w: 200, h: 100 });
  // L'image est affichée dans la vue (rectangle texturé).
  await expect.poll(() => page.evaluate(() => (window as any).vibecad.controller.viewport.imageObjects.size)).toBe(1);

  // Mise à l'échelle : les bords du carré (x 80 → 120 px, soit 0,4 → 0,6) font 40 mm en vrai.
  await page.getByRole('button', { name: /Mettre à l’échelle/ }).click();
  await clickImage(page, 0.4, 0.5);
  await clickImage(page, 0.6, 0.5);
  await page.locator('#calib-a').fill('40');
  await page.getByRole('button', { name: 'Appliquer' }).click();
  // 0,2 de la largeur = 40 mm → largeur 200 mm (à la précision des clics, 1 %).
  await expect.poll(async () => Math.abs((await imageParams(page))!.width - 200)).toBeLessThan(2);

  // Redressement : les coins du carré (40 × 40 mm) ; l'image redressée fait 80 mm de large.
  await page.getByRole('button', { name: /Redresser/ }).click();
  await clickImage(page, 0.4, 0.3);
  await clickImage(page, 0.6, 0.3);
  await clickImage(page, 0.6, 0.7);
  await clickImage(page, 0.4, 0.7);
  await page.locator('#calib-a').fill('40');
  await page.locator('#calib-b').fill('40');
  await page.getByRole('button', { name: 'Appliquer' }).click();
  await expect.poll(async () => (await imageParams(page))!.width).toBeCloseTo(80, 6);
  expect((await imageParams(page))!.perspective.aspect).toBeCloseTo(1, 6);
  // Zoom à la molette dans la fenêtre de réglage, puis « Tout voir ».
  await page.getByRole('button', { name: /Mettre à l’échelle/ }).click();
  const canvasBox = (await page.locator('.image-calibration canvas').boundingBox())!;
  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  await page.mouse.wheel(0, -300);
  await page.screenshot({ path: 'tests/output/e2e-image-loupe.png' });
  await page.getByRole('button', { name: 'Tout voir' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Annuler', exact: true }).click();
  await page.locator('#draft-image-opacity').fill('0.8');
  await page.getByRole('button', { name: 'Valider', exact: true }).click();

  // Dans l'historique, visible dans la vue ; masquée par l'œil.
  await expect(page.getByText('Image 1', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).vibecad.controller.viewport.imageObjects.size)).toBe(1);
  await page.screenshot({ path: 'tests/output/e2e-image-reference.png' });
  // L'image reste visible pendant une esquisse sur son plan.
  await page.click('#tool-sketch');
  await page.getByRole('button', { name: /Plan XY/ }).click();
  await expect.poll(() => page.evaluate(() => (window as any).vibecad.controller.viewport.imageObjects.size)).toBe(1);
  await page.screenshot({ path: 'tests/output/e2e-image-esquisse.png' });
  await page.keyboard.press('Escape');
});
