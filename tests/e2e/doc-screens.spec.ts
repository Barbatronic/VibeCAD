/**
 * Captures de la documentation et du README (thème sombre), à partir du projet de démonstration
 * (petite voiture, `tests/helpers/demo-car.ts`). Ne tourne qu'à la demande :
 *   DOC_SCREENS=1 npx playwright test doc-screens --project=chromium
 * Les images sont écrites dans docs/images/. Les captures de l'assemblage avec visserie
 * (assemblage-visserie.png) et de la simulation (simulation-bras.png) sont faites à la main.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import { demoCar } from '../helpers/demo-car';
import { buildPlateViaUi, clickSketch, clickTool, menuItem, session, worldToScreen } from './helpers';

const OUT = 'docs/images';
test.skip(!process.env.DOC_SCREENS, 'Captures de la documentation : DOC_SCREENS=1 pour les refaire.');
test.describe.configure({ mode: 'serial' });

async function darkPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto('http://localhost:5174/?niveau=expert');
  await page.waitForFunction(() => (window as any).vibecad?.store?.get().kernel.status === 'ready', null, { timeout: 60_000 });
  return page;
}

const settle = async (page: Page) => {
  await expect.poll(() => page.evaluate(() => (window as any).vibecad.controller.viewport.rig.animating)).toBe(false);
  await page.waitForTimeout(500);
};

/** Charge le projet de démonstration et attend son calcul. */
async function loadDemo(page: Page) {
  await page.evaluate((doc) => (window as any).vibecad.controller.commit(doc, 'Projet de démonstration'), demoCar() as any);
  await expect.poll(() => page.evaluate(() => { const s = (window as any).vibecad.store.get(); return s.doc.parts.every((p: any) => s.display[p.id]?.mesh); }), { timeout: 60_000 }).toBe(true);
}

const call = (page: Page, fn: string, ...args: unknown[]) => page.evaluate(([f, a]) => (window as any).vibecad.controller[f as string](...(a as unknown[])), [fn, args] as const);
const dismissToasts = (page: Page) => page.evaluate(() => { const v = (window as any).vibecad; for (const t of v.store.get().toasts) v.controller.dismissToast(t.id); });
const partId = (page: Page, name: string) => page.evaluate((n) => (window as any).vibecad.store.get().doc.parts.find((p: any) => p.name === n).id, name);

test('pièce, tôlerie, découpe laser', async ({ browser }) => {
  test.setTimeout(240_000);
  const page = await darkPage(browser);
  await loadDemo(page);

  // Pièce : la roue et son historique (répétition des trous d'allègement).
  await page.click('#tab-parts');
  const wheel = await partId(page, 'Roue');
  await call(page, 'toggleIsolate', wheel);
  await call(page, 'setView', 'iso');
  await call(page, 'fitAll');
  await settle(page);
  await page.screenshot({ path: `${OUT}/roue-historique.png` });
  await call(page, 'toggleIsolate', wheel);

  // Tôlerie : la carrosserie pliée, puis dépliée avec ses lignes de pli.
  const body = await partId(page, 'Carrosserie');
  await call(page, 'toggleIsolate', body);
  await call(page, 'fitAll');
  await settle(page);
  await page.screenshot({ path: `${OUT}/tolerie.png` });
  await clickTool(page, 'tool-unfold');
  await settle(page);
  await page.screenshot({ path: `${OUT}/tolerie-deplie.png` });
  await clickTool(page, 'tool-unfold');
  await call(page, 'toggleIsolate', body);

  // Découpe laser : châssis et carrosserie (développé), plaques en grand après optimisation.
  await page.click('#tab-fabrication');
  await page.click('#fab-laser');
  for (const [name, n] of [['Châssis', '2'], ['Carrosserie', '2'], ['Roue', '4']] as const) {
    const field = page.getByLabel(`Exemplaires à découper de « ${name} »`);
    if (await field.count()) await field.fill(n);
  }
  await page.waitForTimeout(500);
  // Matériau le plus garni (le plus de pièces posées).
  const material = await page.evaluate(() => {
    const groups = (window as any).vibecad.controller.laserLayout().materials;
    return groups.reduce((a: any, b: any) => (b.placed.length > a.placed.length ? b : a)).material.id;
  });
  await call(page, 'optimizeLaser', material);
  await call(page, 'openLaserEditor', material);
  await dismissToasts(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/laser-plaques.png` });
  await page.context().close();
});

test('esquisse cotée, aperçu, parcours guidé, erreur expliquée', async ({ browser }) => {
  test.setTimeout(240_000);
  const page = await darkPage(browser);
  await buildPlateViaUi(page);
  // Esquisse sur la face avec une cote en cours de saisie.
  const top = await worldToScreen(page, 45, 22, 5);
  await page.mouse.dblclick(top.x, top.y);
  await expect.poll(async () => (await session(page))?.sketch.support.kind).toBe('face');
  await page.waitForTimeout(450);
  await page.click('#sk-circle');
  await clickSketch(page, 40, 15);
  await page.keyboard.type('8');
  await page.keyboard.press('Enter');
  await page.click('#sk-dimension');
  const c = await page.evaluate(() => {
    const s = (window as any).vibecad.store.get().mode.session;
    const circle = s.sketch.entities.filter((e: any) => e.type === 'circle').pop();
    return s.sketch.entities.find((e: any) => e.id === circle.center);
  });
  await clickSketch(page, c.x, c.y);
  await clickSketch(page, 0, 0);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/esquisse-cote.png` });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Terminer l’esquisse' }).click();
  await page.waitForTimeout(300);
  // Aperçu d'une poche cotée.
  await clickTool(page, 'tool-pocket');
  await page.getByRole('button', { name: 'Cotée' }).click();
  await page.locator('#draft-distance').fill('3');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/apercu-poche.png` });
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await page.waitForTimeout(600);
  // Erreur expliquée : la face d'une esquisse n'existe plus.
  await page.evaluate(() => {
    const ctl = (window as any).vibecad.controller;
    const s = ctl.state;
    const part = s.doc.parts[0];
    const sk2 = part.features[2];
    const doc = { ...s.doc, parts: [{ ...part, features: part.features.map((f: any) => (f.id === sk2.id ? { ...f, params: { ...f.params, support: { kind: 'face', ref: { featureId: part.features[1].id, role: 'side', entityId: 'l99' } } } } : f)) }] };
    ctl.commit(doc, 'Référence perdue');
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/erreur-reference.png` });
  await page.context().close();

  // Parcours guidé, sur un projet neuf.
  const tour = await darkPage(browser);
  await menuItem(tour, /Parcours guidés/);
  await tour.waitForTimeout(300);
  await tour.getByRole('button', { name: /plaque percée/i }).first().click().catch(() => undefined);
  await tour.waitForTimeout(500);
  await tour.screenshot({ path: `${OUT}/parcours-guide.png` });
  await tour.context().close();
});
