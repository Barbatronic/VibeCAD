import { expect, test } from '@playwright/test';
import { buildPlateViaUi, openApp } from './helpers';

test('collisions : plaques posées l’une sur l’autre (contact), puis enfoncées (collision en rouge)', async ({ page }) => {
  await openApp(page);
  await buildPlateViaUi(page);
  await page.click('#tab-assembly');
  for (let i = 0; i < 2; i++) {
    await page.click('#as-insert');
    await page.getByRole('menu', { name: 'Pièces à insérer' }).getByRole('menuitem').first().click();
  }
  await page.click('#as-collisions');
  await expect(page.getByText('Aucune collision')).toBeVisible();

  // Seconde plaque posée sur la première (dessous contre dessus) : simple contact.
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
  await expect(page.getByText('Aucune collision')).toBeVisible();
  // Enfoncée de 2 mm : collision.
  await page.getByLabel('Décalage (fixe) exact').fill('-2');
  await expect(page.locator('.collision-list li')).toHaveCount(1);
  await expect(page.locator('.collision-list')).toContainText('mm³ en commun');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tests/output/e2e-collisions.png' });
  // Désactivée : plus rien n'est signalé.
  await page.click('#as-collisions');
  await expect(page.locator('.collision-list')).toHaveCount(0);
});
