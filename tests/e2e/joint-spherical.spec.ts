import { expect, test } from '@playwright/test';
import { appState, buildPlateViaUi, openApp } from './helpers';

test('rotule : choisie par son icône, expliquée, la pièce penche autour du point d’accroche', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);
  await page.click('#tab-assembly');
  for (let i = 0; i < 2; i++) {
    await page.click('#as-insert');
    await page.getByRole('menu', { name: 'Pièces à insérer' }).getByRole('menuitem').first().click();
  }
  // Liaison créée par le modèle (le choix des repères à la souris est couvert par assembly.spec).
  await page.evaluate(async () => {
    const c = (window as any).vibecad.controller;
    const documentUrl = '/src/domain/document.ts';
    const d = await import(/* @vite-ignore */ documentUrl);
    const s = c.state;
    const [a, b] = s.doc.assembly.instances;
    const ex = s.doc.parts[0].features[1].id;
    const r = d.addJoint(s.doc, {
      kind: 'fixed',
      moving: { instanceId: b.id, lcs: { kind: 'face', face: { featureId: ex, role: 'start' } } },
      base: { instanceId: a.id, lcs: { kind: 'face', face: { featureId: ex, role: 'end' } } },
      flip: false,
      angle: 0,
      offset: 0,
    });
    c.commit(r.doc, 'Créer une liaison', { assemblySelection: { kind: 'joint', id: r.jointId } });
  });
  const kinds = page.getByRole('group', { name: 'Type de liaison' });
  await expect(kinds.getByRole('button')).toHaveCount(5);
  await kinds.getByRole('button', { name: 'Rotule' }).click();
  await expect(kinds.getByRole('button', { name: 'Rotule' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.joint-explanation')).toContainText('tous les sens');
  await page.getByLabel('Pencher (inclinaison) exact').fill('30');
  await page.getByLabel('Direction de l’inclinaison exact').fill('90');
  await expect.poll(() => appState(page, (s) => s.doc.assembly.joints[0])).toMatchObject({ kind: 'spherical', tilt: 30, tiltDirection: 90 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tests/output/e2e-rotule.png' });

  // Outil Main : attraper la plaque et la tirer, elle penche autrement.
  await page.getByLabel('Pencher (inclinaison) exact').fill('0');
  await expect.poll(() => appState(page, (s) => s.doc.assembly.joints[0].tilt)).toBe(0);
  await page.click('#as-hand');
  const grab = await page.evaluate(() => {
    const c = (window as any).vibecad.controller;
    const inst = c.state.doc.assembly.instances[1];
    const part = c.viewport.parts.get(inst.id);
    const v = c.viewport.rig.camera.position.clone().set(50, 25, 0).applyMatrix4(part.group.matrix).project(c.viewport.rig.camera);
    return { x: ((v.x + 1) / 2) * c.viewport.width, y: ((1 - v.y) / 2) * c.viewport.height };
  });
  const box = (await page.locator('.vp-canvas').boundingBox())!;
  await page.mouse.move(box.x + grab.x, box.y + grab.y);
  await page.mouse.down();
  await page.mouse.move(box.x + grab.x, box.y + grab.y - 40, { steps: 6 });
  await page.mouse.move(box.x + grab.x - 20, box.y + grab.y - 70, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => appState(page, (s) => s.doc.assembly.joints[0].tilt)).toBeGreaterThan(5);
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/output/e2e-rotule-main.png' });
  // Un seul geste à annuler.
  await page.keyboard.press('Control+z');
  await expect.poll(() => appState(page, (s) => s.doc.assembly.joints[0].tilt)).toBe(0);
});
