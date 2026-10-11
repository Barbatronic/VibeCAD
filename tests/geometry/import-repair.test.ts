import { beforeAll, describe, expect, it } from 'vitest';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { getKernel } from '../helpers/kernel';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

/** STEP d'une boîte 20 × 10 × 5 exportée par VibeCAD. */
function boxStep(): string {
  const box = kernel.makePrimitive({ featureId: 'b', shape: 'box', position: { x: 0, y: 0, z: 0 }, width: 20, depth: 10, height: 5, diameter: 1, thickness: 1 });
  try {
    return kernel.exportStep([{ name: 'boite', color: '#888888', shape: box }]);
  } finally {
    kernel.dispose(box);
  }
}

const read = (text: string) => kernel.readStep(new TextEncoder().encode(text));

describe('import : formes réparées', () => {
  it('STEP surfacique (coque fermée sans solide déclaré) : reconstitué en volume', () => {
    const surface = boxStep()
      .replace(/MANIFOLD_SOLID_BREP\('([^']*)',(#\d+)\)/, "SHELL_BASED_SURFACE_MODEL('$1',($2))")
      .replace(/ADVANCED_BREP_SHAPE_REPRESENTATION/g, 'MANIFOLD_SURFACE_SHAPE_REPRESENTATION');
    const r = read(surface);
    expect(r.solids.length).toBe(1);
    const a = kernel.analyze(r.solids[0]!);
    expect(a.valid).toBe(true);
    expect(a.volume).toBeCloseTo(1000, 6);
    r.solids.forEach((s) => kernel.dispose(s));
  });

  it('STEP à sommet décalé (défaut de précision) : le lecteur le répare, volume conservé', () => {
    const step = boxStep();
    const vp = /VERTEX_POINT\('[^']*',#(\d+)\)/.exec(step)!;
    const m = new RegExp(`#${vp[1]} = CARTESIAN_POINT\\('[^']*',\\(([^)]*)\\)\\)`).exec(step)!;
    const [x, y, z] = m[1]!.split(',').map(Number);
    const r = read(step.replace(m[0], m[0].replace(m[1]!, `${x! + 0.05},${y},${z}`)));
    const a = kernel.analyze(r.solids[0]!);
    expect(a.valid).toBe(true);
    expect(a.volume).toBeCloseTo(1000, 3);
    r.solids.forEach((s) => kernel.dispose(s));
  });
});
