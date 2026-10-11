import { expect, test, type Page } from '@playwright/test';
import { expectVolume, openApp, worldToScreen } from './helpers';

/** Centre de la face plane de normale donnée (pièce active). */
async function faceCenter(page: Page, normal: [number, number, number]) {
  return page.evaluate((n) => {
    const s = (window as any).vibecad.controller.state;
    const mesh = s.display[s.activePartId].mesh;
    const face = mesh.faces.find((f: any) => f.plane && f.plane.normal.x * n[0] + f.plane.normal.y * n[1] + f.plane.normal.z * n[2] > 0.99);
    let x = 0, y = 0, z = 0;
    for (let k = face.start; k < face.start + face.count; k++) {
      const v = mesh.indices[k];
      x += mesh.positions[3 * v];
      y += mesh.positions[3 * v + 1];
      z += mesh.positions[3 * v + 2];
    }
    return { x: x / face.count, y: y / face.count, z: z / face.count };
  }, normal);
}

/** Clique le centre d'une face, une fois la vue immobile (le changement d'onglet recadre en douceur). */
async function clickFace(page: Page, normal: [number, number, number]) {
  await expect.poll(() => page.evaluate(() => (window as any).vibecad.controller.viewport.rig.animating)).toBe(false);
  const c = await faceCenter(page, normal);
  const p = await worldToScreen(page, c.x, c.y, c.z);
  await page.mouse.click(p.x, p.y);
}

const study = (page: Page) => page.evaluate(() => (window as any).vibecad.controller.state.doc.simulation?.studies[0]);

test('simulation : une poutre en console fléchit sous une masse, avec un verdict', async ({ page }) => {
  await openApp(page);
  // Poutre 100 × 10 × 10 mm.
  await page.click('#tool-primitive');
  await page.locator('#draft-width').fill('100');
  await page.locator('#draft-depth').fill('10');
  await page.locator('#draft-height').fill('10');
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, 10000);

  await page.getByRole('tab', { name: 'Simulation' }).click();
  await expect(page.getByRole('radio', { name: 'Pièce 1' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.right-panel').getByRole('button', { name: 'Calculer', exact: true })).toBeDisabled();

  // Faces fixées : le bout +X ; charge : le dessus.
  await page.click('#sim-pick-fixed');
  await clickFace(page, [1, 0, 0]);
  await expect.poll(async () => (await study(page))?.fixed.length).toBe(1);
  await page.click('#sim-pick-load');
  await clickFace(page, [0, 0, 1]);
  await expect.poll(async () => (await study(page))?.load.faces.length).toBe(1);
  // Un second clic retire la face, un troisième la remet.
  await clickFace(page, [0, 0, 1]);
  await expect.poll(async () => (await study(page))?.load.faces.length).toBe(0);
  await clickFace(page, [0, 0, 1]);
  await expect.poll(async () => (await study(page))?.load.faces.length).toBe(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.vp-tag-marker').filter({ hasText: '1 kg' })).toBeVisible();

  await page.locator('.right-panel').getByRole('button', { name: 'Calculer', exact: true }).click();
  await expect(page.locator('.sim-verdict')).toContainText('La pièce tient', { timeout: 60_000 });
  // Charge répartie sur une console : flèche W·L³ / (8·E·I) ≈ 0,49 mm pour 1 kg de PLA.
  const flèche = Number((await page.locator('#sim-max-displacement').textContent())!.replace(',', '.').replace(/[^\d.]/g, ''));
  expect(flèche).toBeGreaterThan(0.3);
  expect(flèche).toBeLessThan(0.8);
  await expect.poll(() => page.evaluate(() => !!(window as any).vibecad.controller.viewport.resultObject)).toBe(true);
  await page.screenshot({ path: 'tests/output/e2e-simulation.png' });

  // Déformée animée : la pièce va et vient (le bout libre ne reste pas au même endroit).
  const tipZ = () =>
    page.evaluate(() => {
      const o = (window as any).vibecad.controller.viewport.resultObject;
      const a = o.geometry.getAttribute('position').array as Float32Array;
      let min = Infinity;
      for (let k = 2; k < a.length; k += 3) min = Math.min(min, a[k]!);
      return min;
    });
  const samples: number[] = [];
  for (let k = 0; k < 6; k++) {
    samples.push(await tipZ());
    await page.waitForTimeout(170);
  }
  expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.5);
  await page.locator('#sim-animate').uncheck();
  await expect.poll(() => page.evaluate(() => !!(window as any).vibecad.controller.viewport.resultAnimation)).toBe(false);
  const still = await tipZ();
  await page.waitForTimeout(300);
  expect(await tipZ()).toBe(still);

  // Couleurs du déplacement ; puis une charge 100 fois plus lourde casse la pièce.
  await page.getByRole('button', { name: 'Déplacement', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Déplacement', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Masse posée (kg)').fill('100');
  await expect(page.getByText('Les réglages ou la pièce ont changé')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as any).vibecad.controller.viewport.resultObject)).toBe(false);
  await page.locator('.right-panel').getByRole('button', { name: 'Calculer', exact: true }).click();
  await expect(page.locator('.sim-verdict')).toContainText('Risque de casser', { timeout: 60_000 });
  // 100 kg sur une poutre de PLA de 10 mm : elle plie de plusieurs centimètres, au-delà du calcul.
  await expect(page.getByText('La pièce se déforme beaucoup')).toBeVisible();

  // Les réglages sont enregistrés dans le projet (annulables).
  expect((await study(page)).load.value).toBe(100);
  // Acrylique (découpe laser) : même raideur que le PLA, un peu plus résistant.
  await page.locator('#sim-material').selectOption({ label: 'Acrylique (PMMA)' });
  await expect.poll(async () => (await study(page)).materialId).toBe('acrylic');
  // TPU (impression souple).
  await page.locator('#sim-material').selectOption({ label: 'TPU imprimé (souple)' });
  await expect.poll(async () => (await study(page)).materialId).toBe('tpu');
});

test('simulation : onglet réservé au niveau Intermédiaire', async ({ page }) => {
  await openApp(page, 'http://localhost:5174/?niveau=debutant');
  await expect(page.getByRole('tab', { name: 'Fabrication' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Simulation' })).toHaveCount(0);
});
