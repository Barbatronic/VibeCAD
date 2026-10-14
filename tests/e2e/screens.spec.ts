/**
 * Captures d'écran de référence pour la revue visuelle (tests/output/screens/*.png).
 * Lancer : npx playwright test tests/e2e/screens.spec.ts --project=chromium
 */
import { expect, test } from '@playwright/test';
import { menuItem, appState, buildPlateViaUi, clickSketch, openApp, openFileMenu, session, worldToScreen } from './helpers';

const OUT = 'tests/output/screens';

test('captures des principaux écrans', async ({ page }) => {
  await openApp(page);
  await page.screenshot({ path: `${OUT}/01-accueil.png` });

  await page.click('#tool-sketch');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/02-choix-du-plan.png` });
  await page.getByRole('button', { name: 'Annuler' }).last().click();

  await buildPlateViaUi(page);
  await page.click('#tool-sketch');
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: 'Annuler' }).last().click();

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
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/03-esquisse-cote.png` });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Terminer l’esquisse' }).click();
  await page.waitForTimeout(300);

  // Aperçu d'une poche cotée.
  await page.click('#tool-pocket');
  await page.getByRole('button', { name: 'Cotée' }).click();
  await page.locator('#draft-distance').fill('3');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/04-apercu-poche.png` });
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await page.waitForTimeout(600);

  // Sélection d'une face et mesure.
  await page.click('#tool-measure');
  const edgeA = await worldToScreen(page, 30, 0, 5);
  await page.mouse.click(edgeA.x, edgeA.y);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/05-mesure.png` });
  await page.keyboard.press('Escape');

  // Dialogues et aide.
  await openFileMenu(page);
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${OUT}/06-menu-fichier.png` });
  await page.getByRole('menuitem', { name: /Exporter…/ }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/07-export-step.png` });
  await page.keyboard.press('Escape');
  await menuItem(page, /^Aide/);
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/08-aide.png` });
  await page.keyboard.press('Escape');
  await menuItem(page, /Parcours guidés/);
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/09-parcours.png` });
  await page.locator('.tutorial').getByRole('button', { name: 'Quitter le parcours guidé' }).click();

  // État d'erreur : référence de face perdue.
  await page.evaluate(() => {
    const c = (window as any).vibecad.controller;
    const s = c.state;
    const part = s.doc.parts[0];
    const sk2 = part.features[2];
    const doc = {
      ...s.doc,
      parts: [{ ...part, features: part.features.map((f: any) => (f.id === sk2.id ? { ...f, params: { ...f.params, support: { kind: 'face', ref: { featureId: part.features[1].id, role: 'side', entityId: 'l99' } } } } : f)) }],
    };
    c.commit(doc, 'Test : référence perdue');
  });
  await expect.poll(() => appState(page, (s) => s.display[s.doc.parts[0].id]?.result.failedFeatureId !== null)).toBe(true);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/10-erreur-reference.png` });
});

test('thème sombre', async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await openApp(page);
  await buildPlateViaUi(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/11-sombre.png` });
  await context.close();
});
