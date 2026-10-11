import { expect, test } from '@playwright/test';
import { addFeature, addInstance, addJoint, addPart, createDocument, findPart, makePrimitiveFeature } from '../../src/domain/document';
import type { CadDocument, EdgeRef, Id, LcsRef } from '../../src/domain/model';
import { serializeDocument } from '../../src/io/native-format';
import { appState, openApp } from './helpers';

/** Barre percée de deux trous Ø 6 à `entraxe` ; renvoie aussi les repères de ses trous. */
function bar(doc: CadDocument, name: string, entraxe: number, first: boolean) {
  let partId: Id;
  if (first) {
    partId = doc.parts[0]!.id;
    doc = { ...doc, parts: doc.parts.map((p) => (p.id === partId ? { ...p, name } : p)) };
  } else {
    const r = addPart(doc, name);
    doc = r.doc;
    partId = r.partId;
  }
  const box = makePrimitiveFeature(doc, findPart(doc, partId)!);
  doc = addFeature(doc, partId, { ...box, params: { ...box.params, width: entraxe + 10, depth: 10, height: 5 } });
  const holes: Id[] = [];
  for (const x of [5, 5 + entraxe]) {
    const hole = makePrimitiveFeature(doc, findPart(doc, partId)!, 'cylinder', 'cut');
    doc = addFeature(doc, partId, { ...hole, params: { ...hole.params, position: { x, y: 5, z: 0 }, diameter: 6, height: 5 } });
    holes.push(hole.id);
  }
  // Bord d'un trou : entre sa paroi et le dessus (role end) ou le dessous (start) de la barre.
  const edge = (k: 0 | 1, side: 'start' | 'end'): LcsRef => ({ kind: 'circle', edge: { faces: [{ featureId: holes[k]!, role: 'side', entityId: 'wall' }, { featureId: box.id, role: side }] } as EdgeRef });
  return { doc, partId, top: (k: 0 | 1) => edge(k, 'end'), bottom: (k: 0 | 1) => edge(k, 'start') };
}

function fourBarDocument(): string {
  let doc = createDocument('Quadrilatère articulé');
  const socle = bar(doc, 'Socle', 60, true);
  doc = socle.doc;
  const manivelle = bar(doc, 'Manivelle', 30, false);
  doc = manivelle.doc;
  const bielle = bar(doc, 'Bielle', 60, false);
  doc = bielle.doc;
  const balancier = bar(doc, 'Balancier', 30, false);
  doc = balancier.doc;
  const ids: Record<string, Id> = {};
  for (const [k, b, y] of [['socle', socle, 0], ['manivelle', manivelle, 30], ['bielle', bielle, 60], ['balancier', balancier, 90]] as const) {
    const r = addInstance(doc, b.partId, { x: 0, y, z: 0 });
    doc = r.doc;
    ids[k] = r.instanceId;
  }
  const rev = (moving: [Id, LcsRef], base: [Id, LcsRef], angle: number) =>
    (doc = addJoint(doc, { kind: 'revolute', moving: { instanceId: moving[0], lcs: moving[1] }, base: { instanceId: base[0], lcs: base[1] }, flip: false, angle, offset: 0 }).doc);
  rev([ids.manivelle!, manivelle.bottom(0)], [ids.socle!, socle.top(0)], 70);
  rev([ids.bielle!, bielle.bottom(0)], [ids.manivelle!, manivelle.top(1)], -70);
  rev([ids.balancier!, balancier.bottom(0)], [ids.socle!, socle.top(1)], 60);
  // Elle referme la boucle : la bielle est déjà tenue par la manivelle.
  rev([ids.bielle!, bielle.bottom(1)], [ids.balancier!, balancier.top(1)], 0);
  return serializeDocument(doc);
}

const loopGap = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const c = (window as any).vibecad.controller;
    const p = c.assemblyPlacement();
    const j4 = c.state.doc.assembly.joints[3];
    const f = p.jointFrames.get(j4.id);
    return { gap: Math.hypot(f.base.origin.x - f.moving.origin.x, f.base.origin.y - f.moving.origin.y, f.base.origin.z - f.moving.origin.z), issues: p.issues.size };
  });

test('quadrilatère articulé : la boucle se referme et suit la manivelle', async ({ page }) => {
  await openApp(page);
  const text = fourBarDocument();
  await page.evaluate((t) => (window as any).vibecad.controller.loadFromText(t, { savedAt: null, dirty: false }), text);
  await expect.poll(() => appState(page, (s) => s.doc.parts.every((p: any) => s.display[p.id]?.mesh))).toBe(true);
  await page.click('#tab-assembly');
  await expect.poll(() => loopGap(page)).toEqual({ gap: expect.closeTo(0, 3), issues: 0 });
  await expect(page.locator('.feature-issue')).toHaveCount(0);
  await page.evaluate(() => (window as any).vibecad.controller.fitAll());
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tests/output/e2e-quadrilatere.png' });

  // Manivelle tournée au curseur : le balancier suit, la boucle reste fermée.
  const rocker = () => appState(page, (s) => s.doc.assembly.joints[2].angle);
  const before = await rocker();
  await page.getByRole('list', { name: 'Liaisons de l’assemblage' }).locator('.feature-main', { hasText: 'Liaison 1 ' }).click();
  await page.locator('#joint-angle').evaluate((el: HTMLInputElement) => {
    for (const v of ['80', '100', '120']) {
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect.poll(() => appState(page, (s) => s.doc.assembly.joints[0].angle)).toBe(120);
  expect(Math.abs((await rocker()) - before)).toBeGreaterThan(10);
  expect(await loopGap(page)).toEqual({ gap: expect.closeTo(0, 3), issues: 0 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tests/output/e2e-quadrilatere-tourne.png' });
});
