import { expect, type Page } from '@playwright/test';

/** Les parcours de test utilisent tous les outils : niveau Expert par l'adresse. */
export const DEV_URL = 'http://localhost:5174/?niveau=expert';
export const PROD_URL = 'http://localhost:4174/';
export const PLATE_VOLUME = 60 * 30 * 5 - Math.PI * 9 * 5;
export const WIDE_PLATE_VOLUME = 80 * 30 * 5 - Math.PI * 9 * 5;

type Win = { vibecad: { controller: any; store: { get(): any } } };

export async function openApp(page: Page, url = DEV_URL): Promise<void> {
  await page.goto(url);
  await page.waitForFunction(() => (window as unknown as Win).vibecad?.store?.get().kernel.status === 'ready', null, { timeout: 60_000 });
}

export async function appState<T>(page: Page, fn: (s: any) => T): Promise<T> {
  return page.evaluate(`(${fn.toString()})(window.vibecad.store.get())`) as Promise<T>;
}

export async function volumes(page: Page): Promise<number[]> {
  return appState(page, (s) => s.doc.parts.map((p: any) => s.display[p.id]?.result.analysis?.volume ?? 0));
}

export async function expectVolume(page: Page, expected: number, partIndex = 0): Promise<void> {
  await expect
    .poll(async () => (await volumes(page))[partIndex] ?? 0, { message: `volume de la pièce ${partIndex + 1}` })
    .toBeCloseTo(expected, 2);
}

/** Position écran (page) d'un point d'esquisse de la session en cours. */
export async function sketchToScreen(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = (await page.locator('.vp-canvas').boundingBox())!;
  const p = await page.evaluate(
    ([px, py]) => {
      const c = (window as unknown as Win).vibecad.controller;
      return c.viewport.projectSketchPoint(c.state.mode.session.frame, { x: px, y: py });
    },
    [x, y],
  );
  return { x: box.x + p.x, y: box.y + p.y };
}

/** Position écran d'un point 3D du modèle. */
export async function worldToScreen(page: Page, x: number, y: number, z: number): Promise<{ x: number; y: number }> {
  const box = (await page.locator('.vp-canvas').boundingBox())!;
  const p = await page.evaluate(
    ([px, py, pz]) => {
      const c = (window as unknown as Win).vibecad.controller;
      const frame = { origin: { x: 0, y: 0, z: pz }, xAxis: { x: 1, y: 0, z: 0 }, yAxis: { x: 0, y: 1, z: 0 }, normal: { x: 0, y: 0, z: 1 } };
      return c.viewport.projectSketchPoint(frame, { x: px, y: py });
    },
    [x, y, z],
  );
  return { x: box.x + p.x, y: box.y + p.y };
}

export async function clickSketch(page: Page, x: number, y: number): Promise<void> {
  const p = await sketchToScreen(page, x, y);
  await page.mouse.move(p.x, p.y, { steps: 2 });
  await page.mouse.down();
  await page.mouse.up();
}

export async function moveSketch(page: Page, x: number, y: number): Promise<void> {
  const p = await sketchToScreen(page, x, y);
  await page.mouse.move(p.x, p.y, { steps: 3 });
}

export async function session(page: Page): Promise<any> {
  return appState(page, (s) => (s.mode.kind === 'sketch' ? s.mode.session : null));
}

export async function finishSketch(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Terminer l’esquisse' }).click();
  await expect.poll(() => appState(page, (s) => s.mode.kind)).toBe('model');
}

/** Ajoute une cote entre deux points d'esquisse avec l'outil Cote. */
export async function dimensionBetween(page: Page, a: { x: number; y: number }, b: { x: number; y: number }, kind: 'Horizontale' | 'Verticale' | 'Alignée', value: string): Promise<void> {
  await page.click('#sk-dimension');
  await clickSketch(page, a.x, a.y);
  await clickSketch(page, b.x, b.y);
  const editor = page.getByRole('dialog', { name: 'Nouvelle cote' });
  await expect(editor).toBeVisible();
  await editor.getByRole('button', { name: kind }).click();
  const input = editor.getByLabel('Valeur de la cote en millimètres');
  await input.fill(value);
  await input.press('Enter');
  await expect(editor).toBeHidden();
}

/** Construit la plaque percée 60 × 30 × 5 avec un trou Ø 6 coté à 15 / 15, uniquement par l'interface. */
export async function buildPlateViaUi(page: Page): Promise<void> {
  // 1. Esquisse sur le plan XY : rectangle 60 × 30 depuis l'origine, dimensions tapées au clavier.
  await page.click('#tool-sketch');
  await page.getByRole('button', { name: /Plan XY/ }).click();
  await expect.poll(async () => (await session(page))?.tool).toBe('rectangle');
  await page.waitForTimeout(450);
  await clickSketch(page, 0.05, 0.05);
  await moveSketch(page, 40, 20);
  await page.keyboard.type('60');
  await page.keyboard.press('Tab');
  await page.keyboard.type('30');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await session(page))?.sketch.entities.length).toBe(12);
  await expect.poll(async () => (await session(page))?.dof).toBe(0);
  await finishSketch(page);

  // 2. Extrusion de 5 mm.
  await page.click('#tool-extrude');
  await page.locator('#draft-distance').fill('5');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, 9000);

  // 3. Esquisse sur la face supérieure (double-clic sur la face).
  await page.waitForTimeout(500);
  const top = await worldToScreen(page, 45, 22, 5);
  await page.mouse.dblclick(top.x, top.y);
  await expect.poll(async () => (await session(page))?.sketch.support.kind).toBe('face');
  await page.waitForTimeout(450);

  // 4. Cercle de diamètre 6, puis placé par deux cotes depuis l'origine.
  await page.click('#sk-circle');
  await clickSketch(page, 13, 17);
  await page.keyboard.type('6');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await session(page))?.sketch.entities.filter((e: any) => e.type === 'circle').length).toBe(1);
  const center = await page.evaluate(() => {
    const s = (window as unknown as Win).vibecad.store.get().mode.session;
    const c = s.sketch.entities.find((e: any) => e.type === 'circle');
    return s.sketch.entities.find((e: any) => e.id === c.center);
  });
  await dimensionBetween(page, center, { x: 0, y: 0 }, 'Horizontale', '15');
  const center2 = await page.evaluate(() => {
    const s = (window as unknown as Win).vibecad.store.get().mode.session;
    const c = s.sketch.entities.find((e: any) => e.type === 'circle');
    return s.sketch.entities.find((e: any) => e.id === c.center);
  });
  await dimensionBetween(page, center2, { x: 0, y: 0 }, 'Verticale', '15');
  await expect.poll(async () => (await session(page))?.dof).toBe(0);
  await finishSketch(page);

  // 5. Poche traversante.
  await page.click('#tool-pocket');
  await expect(page.getByRole('button', { name: 'Traversante' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, PLATE_VOLUME);
}

/**
 * Clique un outil de la barre (`tool-…` ou `sk-…`), qu'il soit sorti ou rangé dans le menu de son
 * secteur quand la barre manque de place.
 */
export async function clickTool(page: Page, id: string): Promise<void> {
  const button = page.locator(`#${id}`);
  if (await button.isVisible()) return button.click();
  await page.locator('.sector', { has: button }).locator('.split-toggle').click();
  await page.click(`#${id.replace(/^(tool|sk)-/, '$1-menu-')}`);
}

export async function openFileMenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Fichier' }).click();
}

/** Une entrée du menu Fichier (parcours, aide, préférences…). */
export async function menuItem(page: Page, name: RegExp): Promise<void> {
  await openFileMenu(page);
  await page.getByRole('menuitem', { name }).click();
}

/** Fichier → Exporter…, puis choix du format dans la fenêtre d'export (renvoyée). */
export async function openExport(page: Page, format: 'STEP' | '3MF' | 'STL' | 'GLB' | 'FreeCAD' | 'FCStd') {
  await openFileMenu(page);
  await page.getByRole('menuitem', { name: /Exporter…/ }).click();
  const dialog = page.getByRole('dialog', { name: /Exporter/ });
  const button = dialog.getByRole('button', { name: format, exact: true });
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  return dialog;
}
