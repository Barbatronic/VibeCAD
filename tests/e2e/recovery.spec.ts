import { expect, test } from '@playwright/test';
import {
  appState,
  buildPlateViaUi,
  clickSketch,
  expectVolume,
  finishSketch,
  moveSketch,
  openApp,
  PLATE_VOLUME,
  session,
  worldToScreen,
} from './helpers';

test('récupération du travail non enregistré après fermeture de la page', async ({ page }) => {
  await openApp(page);
  await page.click('#tool-sketch');
  await page.getByRole('button', { name: /Plan XY/ }).click();
  await expect.poll(async () => (await session(page))?.tool).toBe('rectangle');
  await page.waitForTimeout(450);
  await clickSketch(page, 0, 0);
  await moveSketch(page, 10, 10);
  await page.keyboard.type('25');
  await page.keyboard.press('Tab');
  await page.keyboard.type('15');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await session(page))?.sketch.entities.length).toBe(12);
  await finishSketch(page);
  await page.click('#tool-extrude');
  await page.locator('#draft-distance').fill('4');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, 25 * 15 * 4);
  // La sauvegarde automatique a lieu environ une seconde après la modification.
  await expect(page.getByText(/sauvegarde auto/)).toBeVisible();

  await page.reload();
  const dialog = page.getByRole('dialog', { name: 'Récupérer votre travail ?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Récupérer' }).click();
  await page.waitForFunction(() => (window as any).vibecad?.store?.get().kernel.status === 'ready');
  await expectVolume(page, 25 * 15 * 4);
  await expect(page.getByText('Modifications non enregistrées')).toBeVisible();
});

test('une référence de face perdue se répare en choisissant un nouveau support', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);
  // Simule la disparition de la face support de « Esquisse 2 » (référence vers un élément supprimé).
  await page.evaluate(() => {
    const c = (window as any).vibecad.controller;
    const part = c.state.doc.parts[0];
    const [, extrude, sketch2] = part.features;
    const support = { kind: 'face', ref: { featureId: extrude.id, role: 'side', entityId: 'l99' } };
    const features = part.features.map((f: any) => (f.id === sketch2.id ? { ...f, params: { ...f.params, support } } : f));
    c.commit({ ...c.state.doc, parts: [{ ...part, features }] }, 'Référence perdue (test)');
  });
  const issue = page.locator('.feature-issue.error');
  await expect(issue).toContainText('n’existe plus');
  await expect(page.getByText(/n’est plus à jour : corrigez l’étape « Esquisse 2 »/)).toBeVisible();

  await issue.getByRole('button', { name: 'Choisir un nouveau support' }).click();
  await expect.poll(() => appState(page, (s) => s.mode.kind)).toBe('pick-support');
  // La pièce affichée n'est pas à jour : on répare en reposant l'esquisse sur le plan XY.
  await page.getByRole('button', { name: /Plan XY/ }).click();
  await expect.poll(async () => (await session(page))?.sketch.support).toEqual({ kind: 'plane', plane: 'XY', offset: 0 });
  // Le dessin et ses cotes sont conservés.
  expect((await session(page))?.sketch.constraints.length).toBe(3);
  await finishSketch(page);
  // Sur le plan XY, la poche « traversante » (vers le bas) ne retire rien : on inverse son sens.
  const history = page.getByRole('list', { name: /Étapes de construction/ });
  await expect(page.locator('.feature-issue.warning')).toContainText('ne retire aucune matière');
  await history.locator('.feature-main', { hasText: 'Poche 1' }).dblclick();
  await page.getByRole('button', { name: 'Symétrique' }).click();
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, PLATE_VOLUME);
  await expect(page.locator('.feature-issue')).toHaveCount(0);
  const top = await worldToScreen(page, 45, 22, 5);
  expect(top.x).toBeGreaterThan(0);
});

test('changer le support d’une esquisse valide depuis l’historique : nouvelle face, dessin conservé ; Échap ne change rien', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);
  const history = page.getByRole('list', { name: /Étapes de construction/ });
  const supportOf = () => appState(page, (s) => s.doc.parts[0].features[2].params.support);
  const before = await supportOf();
  expect(before).toMatchObject({ kind: 'face', ref: { role: 'end' } });
  // Annuler le choix du support : rien ne change.
  await history.getByRole('button', { name: 'Changer le support de « Esquisse 2 »' }).click();
  await expect.poll(() => appState(page, (s) => s.mode.kind)).toBe('pick-support');
  await page.keyboard.press('Escape');
  await expect.poll(() => appState(page, (s) => s.mode.kind)).toBe('model');
  expect(await supportOf()).toEqual(before);
  // Nouvelle face : la face avant de la plaque (y = 0), cliquée dans la vue.
  await history.getByRole('button', { name: 'Changer le support de « Esquisse 2 »' }).click();
  await expect.poll(() => appState(page, (s) => s.mode.kind)).toBe('pick-support');
  const front = await worldToScreen(page, 30, 0, 2.5);
  await page.mouse.click(front.x, front.y);
  await expect.poll(async () => (await session(page))?.sketch.support?.kind).toBe('face');
  expect((await session(page))?.sketch.support.ref).not.toEqual(before.ref);
  // Le dessin et ses cotes sont conservés.
  expect((await session(page))?.sketch.constraints.length).toBe(3);
  await finishSketch(page);
  const after = await supportOf();
  expect(after.kind).toBe('face');
  expect(after.ref).not.toEqual(before.ref);
  // Une seule action à annuler : l'ancien support revient.
  await page.keyboard.press('Control+z');
  await expect.poll(supportOf).toEqual(before);
});
