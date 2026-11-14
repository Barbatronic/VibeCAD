/**
 * Tablette tactile (Chrome sur Android) : dessiner au doigt, zoomer et déplacer la vue à deux
 * doigts sans rien dessiner, glisser un point, puis la 3D. Les gestes passent par le protocole de
 * Chrome (vrais événements tactiles) : parcours réservé à Chromium.
 */
import { expect, test, type Page } from '@playwright/test';
import { appState, clickTool, DEV_URL, session, sketchToScreen, volumes, worldToScreen } from './helpers';

test.use({ viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true });
test.skip(({ browserName }) => browserName !== 'chromium', 'gestes tactiles émulés par Chrome');

type Pt = { x: number; y: number };

/** Glisser à un ou plusieurs doigts, de `from` vers `to` (un point par doigt). */
async function touchDrag(page: Page, from: Pt[], to: Pt[], steps = 10): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const at = (k: number) => from.map((f, i) => ({ x: f.x + ((to[i]!.x - f.x) * k) / steps, y: f.y + ((to[i]!.y - f.y) * k) / steps, id: i }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0) });
  for (let k = 1; k <= steps; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(k) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/** Élément visible à cet endroit de l'écran (pas un panneau posé par-dessus la vue). */
const onCanvas = (page: Page, p: Pt) => page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.classList.contains('vp-canvas') ?? false, [p.x, p.y]);
const sketchZoom = (page: Page) => page.evaluate(() => (window as any).vibecad.controller.viewport.rig.camera.zoom as number);

test('tablette : esquisse au doigt, gestes à deux doigts, 3D', async ({ page }) => {
  await page.goto(DEV_URL);
  await page.waitForFunction(() => (window as any).vibecad?.controller);
  await page.locator('#tool-sketch').tap();
  await page.getByRole('button', { name: /Plan XY/ }).tap();
  await expect.poll(async () => (await session(page))?.tool).toBe('rectangle');
  await page.waitForTimeout(700);

  // L'origine est dans la zone libre, pas sous un panneau : on peut s'y accrocher au doigt.
  const origin = await sketchToScreen(page, 0, 0);
  expect(await onCanvas(page, origin)).toBe(true);
  await page.touchscreen.tap(origin.x + 2, origin.y - 2);
  await expect.poll(async () => (await session(page))?.start?.kind).toBe('origin');
  const corner = await sketchToScreen(page, 40, 20);
  await page.touchscreen.tap(corner.x, corner.y);
  await expect.poll(async () => (await session(page))?.sketch.entities.length).toBe(12);
  expect((await session(page))?.sketch.constraints.some((c: any) => c.type === 'coincident' && c.a === 'origin')).toBe(true);

  // Un doigt glissé sur un coin, outil Sélection : le coin suit (dimensions libres).
  await page.locator('#sk-select').tap();
  const c = await sketchToScreen(page, 40, 20);
  const c2 = await sketchToScreen(page, 50, 20);
  expect(await onCanvas(page, c)).toBe(true);
  await touchDrag(page, [c], [c2]);
  await expect.poll(async () => Math.max(...(await session(page))!.sketch.entities.filter((e: any) => e.type === 'point').map((e: any) => e.x))).toBeGreaterThan(45);
  const width = Math.max(...(await session(page))!.sketch.entities.filter((e: any) => e.type === 'point').map((e: any) => e.x));

  // Deux doigts écartés : zoom, sans rien poser avec l'outil Rectangle resté actif.
  await page.locator('#sk-rectangle').tap();
  const before = await sketchZoom(page);
  const mid = await sketchToScreen(page, 20, 10);
  await touchDrag(page, [{ x: mid.x - 30, y: mid.y }, { x: mid.x + 30, y: mid.y }], [{ x: mid.x - 120, y: mid.y }, { x: mid.x + 120, y: mid.y }]);
  await expect.poll(() => sketchZoom(page)).toBeGreaterThan(before * 1.5);
  expect((await session(page))?.sketch.entities.length).toBe(12);
  expect((await session(page))?.start).toBeNull();
  expect(Math.max(...(await session(page))!.sketch.entities.filter((e: any) => e.type === 'point').map((e: any) => e.x))).toBe(width);

  // Deux doigts glissés ensemble : la vue se déplace, toujours sans dessiner.
  const o1 = await sketchToScreen(page, 0, 0);
  const m2 = await sketchToScreen(page, 20, 10);
  await touchDrag(page, [m2, { x: m2.x + 50, y: m2.y }], [{ x: m2.x - 80, y: m2.y + 60 }, { x: m2.x - 30, y: m2.y + 60 }]);
  const o2 = await sketchToScreen(page, 0, 0);
  expect(Math.hypot(o2.x - o1.x, o2.y - o1.y)).toBeGreaterThan(40);
  expect((await session(page))?.sketch.entities.length).toBe(12);

  await page.screenshot({ path: 'tests/output/e2e-tablette-esquisse.png' });

  await page.getByRole('button', { name: /Terminer/ }).tap();
  await expect.poll(async () => (await session(page)) === null).toBe(true);
  // Écran de tablette : Extrusion peut être rangée dans le menu de son secteur.
  await clickTool(page, 'tool-extrude');
  await page.locator('#draft-distance').fill('5');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).tap();
  await expect.poll(async () => (await volumes(page))[0] ?? 0).toBeGreaterThan(0);
  await page.waitForTimeout(700);

  // 3D : un pincement ne sélectionne rien ; un double toucher sur une face ouvre une esquisse dessus.
  const box = (await page.locator('.vp-canvas').boundingBox())!;
  const top = await worldToScreen(page, 20, 10, 5);
  expect(await onCanvas(page, top)).toBe(true);
  const selected = JSON.stringify(await appState(page, (s) => s.selection));
  await touchDrag(page, [{ x: top.x - 20, y: top.y }, { x: top.x + 20, y: top.y }], [{ x: top.x - 21, y: top.y }, { x: top.x + 21, y: top.y }], 2);
  await page.waitForTimeout(200);
  expect(JSON.stringify(await appState(page, (s) => s.selection))).toBe(selected);
  const again = await worldToScreen(page, 20, 10, 5);
  await page.touchscreen.tap(again.x, again.y);
  await page.waitForTimeout(120);
  await page.touchscreen.tap(again.x + 3, again.y + 2);
  await expect.poll(async () => (await session(page))?.sketch.support.kind).toBe('face');
  await page.screenshot({ path: 'tests/output/e2e-tablette-face.png' });
  expect(box.width).toBeGreaterThan(0);
});
