import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { appState, openApp } from './helpers';

/** Projet de référence avec une troisième plaque en pivot sur la deuxième (deux pivots à coupler). */
function twoPivots(): string {
  const file = JSON.parse(readFileSync('tests/fixtures/reference-schema-1.vibecad', 'utf8'));
  const a = file.document.assembly;
  const j1 = a.joints[0];
  a.instances.push({ id: 'in-3', partId: a.instances[1].partId, name: 'Plaque (3)', position: { x: 160, y: 0, z: 0 } });
  a.joints.push({ ...j1, id: 'jt-2', name: 'Liaison 2', moving: { ...j1.moving, instanceId: 'in-3' }, base: { ...j1.base, instanceId: 'in-2' }, angle: 0, angleLimits: undefined });
  return JSON.stringify(file);
}

test('engrenage : deux pivots couplés comme des roues de 10 et 20 dents', async ({ page }) => {
  await openApp(page);
  const text = twoPivots();
  await page.evaluate((t) => (window as any).vibecad.controller.loadFromText(t, { savedAt: null, dirty: false }), text);
  await page.click('#tab-assembly');
  await page.getByRole('button', { name: 'Coupler deux liaisons' }).click();
  await expect(page.locator('.panel-title', { hasText: 'Engrenage 1' })).toBeVisible();
  await page.locator('#coupling-teeth1').fill('10');
  await page.locator('#coupling-teeth2').fill('20');
  await expect(page.locator('#coupling-ratio')).toContainText('0,5 tour de la menée, en sens opposé');
  // Rien n'a bougé à la création ni au changement de rapport.
  expect(await appState(page, (s) => s.doc.assembly.joints.map((j: any) => j.angle))).toEqual([30, 0]);

  // La liaison 1 tourne de 30° de plus : la liaison 2 tourne de 15° en sens opposé.
  await page.getByRole('list', { name: 'Liaisons de l’assemblage' }).getByText('Liaison 1').click();
  await page.getByLabel('Angle (rotation) exact').fill('60');
  await expect.poll(() => appState(page, (s) => s.doc.assembly.joints.map((j: any) => Math.round(j.angle * 1000) / 1000))).toEqual([60, -15]);
  await expect(page.getByRole('list', { name: 'Engrenages et crémaillères' })).toContainText('Liaison 1 → Liaison 2');
  await page.screenshot({ path: 'tests/output/e2e-engrenage.png' });
});

test('engrenage sélectionné : la touche Suppr supprime l’engrenage, pas une pièce', async ({ page }) => {
  await openApp(page);
  await page.evaluate((t) => (window as any).vibecad.controller.loadFromText(t, { savedAt: null, dirty: false }), twoPivots());
  await page.click('#tab-assembly');
  await page.getByRole('button', { name: 'Coupler deux liaisons' }).click();
  await page.getByRole('list', { name: 'Engrenages et crémaillères' }).getByText('Engrenage 1').click();
  await page.keyboard.press('Delete');
  await expect.poll(() => appState(page, (s) => [s.doc.assembly.couplings?.length ?? 0, s.doc.assembly.instances.length])).toEqual([0, 3]);
});

test('vue éclatée : les pièces s’écartent à l’affichage, le projet ne change pas', async ({ page }) => {
  await openApp(page);
  await page.evaluate((t) => (window as any).vibecad.controller.loadFromText(t, { savedAt: null, dirty: false }), twoPivots());
  await page.click('#tab-assembly');
  const before = await appState(page, (s) => JSON.stringify(s.doc));
  await page.click('#as-explode');
  await expect(page.locator('#as-explode-amount')).toBeVisible();
  await page.locator('#as-explode-amount').fill('1.2');
  await expect.poll(() => appState(page, (s) => s.explode)).toBe(1.2);
  expect(await appState(page, (s) => JSON.stringify(s.doc))).toBe(before);
  await page.evaluate(() => (window as any).vibecad.controller.setView('front'));
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'tests/output/e2e-vue-eclatee.png' });
  await page.getByRole('button', { name: 'Rassembler' }).click();
  await expect(page.locator('#as-explode-amount')).toBeHidden();
});
