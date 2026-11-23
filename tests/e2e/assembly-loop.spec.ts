import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('quadrilatère articulé : animer le mécanisme, puis revenir à la position de départ', async ({ page }) => {
  await openApp(page);
  await page.evaluate((t) => (window as any).vibecad.controller.loadFromText(t, { savedAt: null, dirty: false }), fourBarDocument());
  await expect.poll(() => appState(page, (s) => s.doc.parts.every((p: any) => s.display[p.id]?.mesh))).toBe(true);
  await page.click('#tab-assembly');
  await expect.poll(() => loopGap(page)).toEqual({ gap: expect.closeTo(0, 3), issues: 0 });
  const angles = () => appState(page, (s) => s.doc.assembly.joints.map((j: any) => j.angle));
  const start = await angles();
  const undo = await appState(page, (s) => s.history.past.length);
  await page.getByRole('list', { name: 'Liaisons de l’assemblage' }).locator('.feature-main', { hasText: 'Liaison 1 ' }).click();
  await page.getByRole('button', { name: 'Animer le mécanisme' }).click();
  // La manivelle tourne toute seule ; le balancier suit et la boucle reste fermée.
  const seen = new Set<number>();
  for (let k = 0; k < 8; k++) {
    await page.waitForTimeout(150);
    const a = await angles();
    seen.add(Math.round(a[0]));
    expect(await loopGap(page)).toEqual({ gap: expect.closeTo(0, 2), issues: 0 });
  }
  expect(seen.size).toBeGreaterThan(4);
  expect((await angles())[2]).not.toBeCloseTo(start[2], 1);
  // Arrêter : retour exact à la position de départ, sans action dans l'historique.
  await page.getByRole('button', { name: 'Arrêter' }).click();
  await expect.poll(angles).toEqual(start);
  expect(await appState(page, (s) => s.history.past.length)).toBe(undo);
});

test('scénario de mouvement : la manivelle pilote, le balancier est relevé comme par un capteur', async ({ page }) => {
  await openApp(page);
  await page.evaluate((t) => (window as any).vibecad.controller.loadFromText(t, { savedAt: null, dirty: false }), fourBarDocument());
  await expect.poll(() => appState(page, (s) => s.doc.parts.every((p: any) => s.display[p.id]?.mesh))).toBe(true);
  await page.getByRole('tab', { name: 'Simulation' }).click();
  await page.click('#sim-scenarios');
  await page.getByRole('button', { name: 'Nouveau scénario' }).first().click();
  const roles = page.getByRole('list', { name: 'Rôle des liaisons dans le scénario' });
  await roles.getByRole('group', { name: 'Rôle de Liaison 1' }).getByRole('button', { name: 'Pilote' }).click();
  await roles.getByRole('group', { name: 'Rôle de Liaison 3' }).getByRole('button', { name: 'Relevé' }).click();
  const sensor = (id: string) => page.locator(`#sensor-${id}-angle`);
  const j3 = await appState(page, (s) => s.doc.assembly.joints[2].id);
  const before = await sensor(j3).textContent();
  // La manivelle tourne : le balancier suit, son relevé change ; la boucle reste fermée.
  await page.getByLabel('Liaison 1 : réglage exact').fill('100');
  await expect(sensor(j3)).not.toHaveText(before!);
  const reading = Number((await sensor(j3).textContent())!.replace(/[^\d,.-]/g, '').replace(',', '.'));
  expect(Number.isFinite(reading)).toBe(true);
  // Survol d'une liaison de la liste : elle est montrée sur l'assemblage (repères, deux pièces surlignées).
  const j2 = await appState(page, (s) => s.doc.assembly.joints[1].id);
  await roles.locator('li', { hasText: 'Liaison 2' }).hover();
  await expect.poll(() => appState(page, (s) => s.hoverJoint)).toEqual({ id: j2, parts: true });
  await expect.poll(() => page.evaluate(() => (window as any).vibecad.controller.viewport.input.markers.map((m: any) => m.label ?? null))).toContain('Liaison 2');
  await page.screenshot({ path: 'tests/output/e2e-scenario-survol.png' });
  const outlined = () => page.evaluate(() => (window as any).vibecad.controller.viewport.input.selection.length);
  expect(await outlined()).toBeGreaterThan(0);
  // Au pilotage (curseur de la pilotante) : les repères seulement, pas de pièces surlignées.
  const j1 = await appState(page, (s) => s.doc.assembly.joints[0].id);
  await page.locator('.scenario-driver').first().hover();
  await expect.poll(() => appState(page, (s) => s.hoverJoint)).toEqual({ id: j1, parts: false });
  await expect.poll(() => page.evaluate(() => (window as any).vibecad.controller.viewport.input.markers.map((m: any) => m.label ?? null))).toContain('Liaison 1');
  expect(await outlined()).toBe(0);
  await page.screenshot({ path: 'tests/output/e2e-scenario-pilotage.png' });
  await page.mouse.move(5, 5);
  await expect.poll(() => appState(page, (s) => s.hoverJoint)).toBe(null);
  // Rien de survolé : aucune liaison montrée d'office.
  await expect.poll(() => page.evaluate(() => (window as any).vibecad.controller.viewport.input.markers.length)).toBe(0);
  const scenario = await appState(page, (s) => s.doc.simulation.scenarios[0]);
  expect(scenario.drivers).toMatchObject([{ dof: 'angle', value: 100 }]);
  expect(scenario.sensors).toHaveLength(1);
  await page.screenshot({ path: 'tests/output/e2e-scenario.png' });
});


test('loi de pilotage : calculée sur le quadrilatère, en-tête C compilé, la commande trouvée donne la position voulue', async ({ page }) => {
  await openApp(page);
  await page.evaluate((t) => (window as any).vibecad.controller.loadFromText(t, { savedAt: null, dirty: false }), fourBarDocument());
  await expect.poll(() => appState(page, (s) => s.doc.parts.every((p: any) => s.display[p.id]?.mesh))).toBe(true);
  await page.getByRole('tab', { name: 'Simulation' }).click();
  await page.click('#sim-scenarios');
  await page.getByRole('button', { name: 'Nouveau scénario' }).first().click();
  const roles = page.getByRole('list', { name: 'Rôle des liaisons dans le scénario' });
  await roles.getByRole('group', { name: 'Rôle de Liaison 1' }).getByRole('button', { name: 'Pilote' }).click();
  await roles.getByRole('group', { name: 'Rôle de Liaison 3' }).getByRole('button', { name: 'Relevé' }).click();
  // Manivelle balayée de 40° à 140° : le balancier suit.
  await page.getByLabel('Liaison 1 : début du balayage').fill('40');
  await page.getByLabel('Liaison 1 : fin du balayage').fill('140');
  await page.getByRole('button', { name: 'Calculer la loi' }).click();
  const law = page.getByRole('group', { name: 'Loi de pilotage' });
  await expect(law).toContainText('Écart vérifié', { timeout: 30000 });
  await page.screenshot({ path: 'tests/output/e2e-loi-pilotage.png' });
  const [download] = await Promise.all([page.waitForEvent('download'), law.getByRole('button', { name: 'En-tête C (.h)' }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.h$/);
  const dir = mkdtempSync(join(tmpdir(), 'loi-e2e-'));
  await download.saveAs(join(dir, 'loi.h'));
  const header = readFileSync(join(dir, 'loi.h'), 'utf8');
  const fn = /static inline bool (\w+)_commandes\(float position1, float \*commande1\)/.exec(header)![1]!;
  // Position voulue du balancier : au milieu de la plage couverte.
  const range = await page.evaluate(() => (window as any).vibecad.controller.state.controlLaw.law.axes[0]);
  const target = (range.min + range.max) / 2;
  writeFileSync(join(dir, 'main.c'), `#include <stdio.h>\n#include "loi.h"\nint main(void) { float c = 0; bool ok = ${fn}_commandes((float)(${target}), &c); printf("%d %f\\n", ok, c); return 0; }\n`);
  execFileSync('gcc', ['-std=c99', '-Wall', '-Werror', '-o', join(dir, 'loi'), join(dir, 'main.c')]);
  const [ok, command] = execFileSync(join(dir, 'loi'), { encoding: 'utf8' }).trim().split(' ').map(Number);
  expect(ok).toBe(1);
  // La commande trouvée, appliquée à la manivelle : le balancier arrive à la position voulue.
  await page.getByLabel('Liaison 1 : réglage exact').fill(String(command).replace('.', ','));
  const j3 = await appState(page, (s) => s.doc.assembly.joints[2].id);
  await expect.poll(async () => Math.abs(Number((await page.locator(`#sensor-${j3}-angle`).textContent())!.replace(/[^\d,.-]/g, '').replace(',', '.')) - target)).toBeLessThan(0.2);
});

test('timeline du scénario : clés de la manivelle, poses calculées d’avance, lecture', async ({ page }) => {
  await openApp(page);
  await page.evaluate((t) => (window as any).vibecad.controller.loadFromText(t, { savedAt: null, dirty: false }), fourBarDocument());
  await expect.poll(() => appState(page, (s) => s.doc.parts.every((p: any) => s.display[p.id]?.mesh))).toBe(true);
  await page.getByRole('tab', { name: 'Simulation' }).click();
  await page.click('#sim-scenarios');
  await page.getByRole('button', { name: 'Nouveau scénario' }).first().click();
  const roles = page.getByRole('list', { name: 'Rôle des liaisons dans le scénario' });
  await roles.getByRole('group', { name: 'Rôle de Liaison 1' }).getByRole('button', { name: 'Pilote' }).click();
  await roles.getByRole('group', { name: 'Rôle de Liaison 3' }).getByRole('button', { name: 'Relevé' }).click();
  const timeline = page.getByRole('region', { name: 'Timeline' });
  await expect(timeline).toBeVisible();
  // Clé à 0 s (réglage actuel), puis à 2 s : le curseur y est amené sur la règle, le réglage exact pose la clé.
  await page.click('#tl-key-all');
  const ruler = await timeline.locator('.tl-ruler').boundingBox();
  await page.mouse.click(ruler!.x + ruler!.width / 2, ruler!.y + ruler!.height / 2);
  await expect.poll(() => appState(page, (s) => s.scenarioTime)).toBeCloseTo(2, 1);
  await page.evaluate(() => (window as any).vibecad.controller.setScenarioTime(2));
  await page.getByLabel('Liaison 1 : réglage exact').fill('160');
  const keys = () => appState(page, (s) => s.doc.simulation.scenarios[0].timeline.keys.map((k: any) => [k.t, k.value]));
  await expect.poll(keys).toEqual([[0, 70], [2, 160]]);
  await expect(timeline.getByRole('button', { name: /^Clé de Liaison 1/ })).toHaveCount(2);
  // Poses calculées d'avance : une image par instant, relevé du balancier en courbe.
  await expect.poll(() => appState(page, (s) => s.timelineBake && s.timelineBake.status), { timeout: 20_000 }).toBe('done');
  const bake = await appState(page, (s) => ({ n: s.timelineBake.frames.length, total: s.timelineBake.total, blocked: s.timelineBake.frames.filter((f: any) => f.blocked).length }));
  expect(bake.n).toBe(bake.total);
  expect(bake.blocked).toBe(0);
  await expect(timeline.locator('.tl-sensor .tl-curve polyline')).toHaveCount(1);
  // Instant montré : la manivelle est entre ses deux clés, le balancier suit.
  const j1 = await appState(page, (s) => s.doc.assembly.joints[0].id);
  const crankAt = (t: number) =>
    page.evaluate(
      ({ t, j1 }) => {
        const c = (window as any).vibecad.controller;
        c.setScenarioTime(t);
        return c.scenarioState().settled.joints.find((j: any) => j.id === j1).angle;
      },
      { t, j1 },
    );
  expect(await crankAt(0)).toBeCloseTo(70, 3);
  expect(await crankAt(1)).toBeCloseTo(115, 3);
  expect(await crankAt(3)).toBeCloseTo(160, 3);
  await expect(page.getByLabel('Liaison 1 : réglage exact')).toHaveValue('160');
  await page.screenshot({ path: 'tests/output/e2e-scenario-timeline.png' });
  // Lecture en boucle : le temps avance, repart du début, Espace met en pause.
  await page.click('#tl-loop');
  await expect.poll(() => appState(page, (s) => s.doc.simulation.scenarios[0].timeline.loop)).toBe(true);
  await page.evaluate(() => (window as any).vibecad.controller.setScenarioTime(3.6));
  await page.click('#tl-play');
  await expect.poll(() => appState(page, (s) => s.scenarioPlaying)).toBe(true);
  await expect.poll(() => appState(page, (s) => s.scenarioTime), { timeout: 3000 }).toBeLessThan(1);
  await page.keyboard.press('Space');
  await expect.poll(() => appState(page, (s) => s.scenarioPlaying)).toBe(false);
  // Clé choisie : supprimée au clavier ; l'annulation la rend.
  await timeline.getByRole('button', { name: /^Clé de Liaison 1 à 2 s/ }).click();
  await expect(timeline.getByRole('group', { name: 'Clé choisie' })).toBeVisible();
  await page.keyboard.press('Delete');
  await expect.poll(keys).toEqual([[0, 70]]);
  await page.keyboard.press('Control+z');
  await expect.poll(keys).toEqual([[0, 70], [2, 160]]);
});
