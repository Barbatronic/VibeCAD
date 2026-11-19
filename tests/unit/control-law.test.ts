import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { axisValues, checkPoints, cIdentifier, forwardOrder, invertLaw, lawCsv, lawHeader, lawPoint, type ForwardGrid } from '../../src/app/control-law';
import type { ControlLawSpec } from '../../src/domain/model';

/** Grille directe d'un mécanisme connu : `f` donne les positions obtenues pour des commandes. */
function forward(spec: ControlLawSpec, f: (c: number[]) => number[] | null): ForwardGrid {
  const axes = spec.inputs.map((i) => axisValues(i.min, i.max, spec.steps));
  const n = axes[1]?.length ?? 1;
  const outputs: (number[] | null)[] = new Array(axes[0]!.length * n).fill(null);
  for (const idx of forwardOrder(spec)) outputs[idx[0]! * n + (idx[1] ?? 0)] = f(idx.map((k, a) => axes[a]![k]!));
  return { axes, outputs };
}

describe('loi de pilotage : une commande', () => {
  it('inverse une loi monotone (sortie = 2 × commande + 10)', () => {
    const spec: ControlLawSpec = { inputs: [{ jointId: 'a', dof: 'angle', min: 0, max: 90 }], outputs: [{ jointId: 's', dof: 'angle' }], steps: 31 };
    const law = invertLaw(spec, forward(spec, ([c]) => [2 * c! + 10]));
    expect(law.axes[0]).toMatchObject({ min: 10, max: 190 });
    expect(law.notes).toEqual([]);
    for (let k = 0; k < 31; k++) {
      const p = lawPoint(law, k);
      expect(p.commands[0]).toBeCloseTo((p.targets[0]! - 10) / 2, 9);
    }
  });

  it('sortie qui revient en arrière : seule la plus longue portion dans un sens est gardée', () => {
    const spec: ControlLawSpec = { inputs: [{ jointId: 'a', dof: 'angle', min: -90, max: 30 }], outputs: [{ jointId: 's', dof: 'angle' }], steps: 41 };
    // cos : croît de −90° à 0°, puis décroît.
    const law = invertLaw(spec, forward(spec, ([c]) => [Math.cos((c! * Math.PI) / 180)]));
    expect(law.notes[0]).toMatch(/Seule la plage/);
    for (let k = 0; k < 41; k++) {
      const p = lawPoint(law, k);
      expect(p.commands[0]!).toBeLessThanOrEqual(1e-9);
      expect(Math.cos((p.commands[0]! * Math.PI) / 180)).toBeCloseTo(p.targets[0]!, 2);
    }
  });
});

describe('loi de pilotage : deux commandes', () => {
  // Mécanisme connu (non linéaire, sans repli sur la plage) : positions = (c1 + 0,3 c2, 0,2 c1 + c2 + 0,002 c1²).
  const f = ([a, b]: number[]) => [a! + 0.3 * b!, 0.2 * a! + b! + 0.002 * a! * a!];
  const spec: ControlLawSpec = {
    inputs: [{ jointId: 'a', dof: 'angle', min: -40, max: 40 }, { jointId: 'b', dof: 'angle', min: -30, max: 30 }],
    outputs: [{ jointId: 's1', dof: 'angle' }, { jointId: 's2', dof: 'angle' }],
    steps: 25,
  };

  it('retrouve les commandes de chaque position voulue accessible', () => {
    const law = invertLaw(spec, forward(spec, f));
    expect(law.coverage).toBeGreaterThan(0.5);
    const pts = checkPoints(law, 80);
    expect(pts.length).toBe(80);
    for (const k of pts) {
      const p = lawPoint(law, k);
      const got = f(p.commands);
      expect(got[0]).toBeCloseTo(p.targets[0]!, 0);
      expect(got[1]).toBeCloseTo(p.targets[1]!, 0);
      expect(Math.abs(got[0]! - p.targets[0]!)).toBeLessThan(0.2);
      expect(Math.abs(got[1]! - p.targets[1]!)).toBeLessThan(0.2);
    }
  });

  it('blocages : les positions concernées sont inaccessibles et signalées', () => {
    const law = invertLaw(spec, forward(spec, (c) => (c[0]! > 20 ? null : f(c))));
    expect(law.notes.some((n) => /bloque/.test(n))).toBe(true);
    expect(law.coverage).toBeLessThan(1);
  });

  it('en-tête C : compilé et exécuté, la fonction rend les commandes de la loi (test croisé)', () => {
    const law = invertLaw(spec, forward(spec, f));
    const header = lawHeader(law, {
      scenario: 'Scénario 1',
      outputs: [{ name: 'Liaison 9', dof: 'angle' }, { name: 'Liaison 4', dof: 'angle' }],
      inputs: [{ name: 'Liaison 25', dof: 'angle' }, { name: 'Liaison 23', dof: 'angle' }],
      application: 'test',
      maxError: [0.1, 0.1],
    });
    expect(header).toContain('static inline bool scenario_1_commandes(float position1, float position2, float *commande1, float *commande2)');
    const pts = checkPoints(law, 40);
    const dir = mkdtempSync(join(tmpdir(), 'loi-'));
    writeFileSync(join(dir, 'loi.h'), header);
    const calls = pts.map((k) => {
      const p = lawPoint(law, k);
      return `  ok = scenario_1_commandes((float)(${p.targets[0]}), (float)(${p.targets[1]}), &c1, &c2); printf("%d %f %f\\n", ok, c1, c2);`;
    });
    writeFileSync(join(dir, 'main.c'), `#include <stdio.h>\n#include "loi.h"\nint main(void) {\n  float c1 = 0, c2 = 0; bool ok;\n${calls.join('\n')}\n  ok = scenario_1_commandes(1e6f, 0.0f, &c1, &c2); printf("%d\\n", ok);\n  return 0;\n}\n`);
    execFileSync('gcc', ['-std=c99', '-Wall', '-Werror', '-o', join(dir, 'loi'), join(dir, 'main.c')], { cwd: dir });
    const lines = execFileSync(join(dir, 'loi'), { encoding: 'utf8' }).trim().split('\n');
    pts.forEach((k, n) => {
      const [ok, c1, c2] = lines[n]!.split(' ').map(Number);
      const p = lawPoint(law, k);
      expect(ok).toBe(1);
      // Stockées en dixièmes de degré : ± 0,05°.
      expect(Math.abs(c1! - p.commands[0]!)).toBeLessThan(0.06);
      expect(Math.abs(c2! - p.commands[1]!)).toBeLessThan(0.06);
    });
    // Hors de la grille : refusé.
    expect(lines[pts.length]).toBe('0');
  });

  it('CSV : une ligne par point, cases vides pour les positions inaccessibles', () => {
    const law = invertLaw(spec, forward(spec, (c) => (c[0]! > 20 ? null : f(c))));
    const csv = lawCsv(law, { outputs: [{ name: 'Liaison 9', dof: 'angle' }, { name: 'Liaison 4', dof: 'angle' }], inputs: [{ name: 'Liaison 25', dof: 'angle' }, { name: 'Liaison 23', dof: 'angle' }] });
    const rows = csv.replace(/^﻿/, '').trim().split('\r\n');
    expect(rows[0]).toBe('Liaison 9 voulue (°);Liaison 4 voulue (°);Liaison 25 (°);Liaison 23 (°)');
    expect(rows).toHaveLength(25 * 25 + 1);
    expect(rows.some((r) => r.endsWith(';;'))).toBe(true);
  });
});

describe('loi de pilotage : noms', () => {
  it('identifiant C sans accents ni espaces', () => {
    expect(cIdentifier('Scénario 1')).toBe('scenario_1');
    expect(cIdentifier('1er essai')).toBe('loi_1er_essai');
    expect(cIdentifier('***')).toBe('loi');
  });
});
