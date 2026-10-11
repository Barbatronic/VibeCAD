import { beforeAll, describe, expect, it } from 'vitest';
import { addFeature, addPart, findPart, makePrimitiveFeature } from '../../src/domain/document';
import type { CadDocument, Id } from '../../src/domain/model';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { documentForWorker } from '../../src/geometry/protocol';
import { translation4 } from '../../src/math/mat4';
import { GeometryService } from '../../src/workers/geometry-service';
import { getKernel } from '../helpers/kernel';
import { buildPlateDocument } from '../helpers/plate';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

/** Plaque percée et goupille (cylindre Ø 6 × 10), deux exemplaires de la goupille. */
function project(): { doc: CadDocument; plateId: Id; pinId: Id } {
  const { doc: base, ids } = buildPlateDocument();
  const r = addPart(base, 'Goupille');
  let doc = { ...r.doc, name: 'Montage' };
  const pin = makePrimitiveFeature(doc, findPart(doc, r.partId)!, 'cylinder');
  doc = addFeature(doc, r.partId, { ...pin, params: { ...pin.params, diameter: 6, height: 10 } });
  return { doc, plateId: ids.partId, pinId: r.partId };
}

const count = (text: string, re: RegExp) => (text.match(re) ?? []).length;

describe('export STEP d’un assemblage', () => {
  it('arborescence : un assemblage, une définition par pièce, une instance placée par insertion', () => {
    const { doc, plateId, pinId } = project();
    const service = new GeometryService(kernel);
    const placements = [
      { partId: plateId, name: 'Plaque', matrix: translation4({ x: 0, y: 0, z: 0 }) },
      { partId: pinId, name: 'Goupille (1)', matrix: translation4({ x: 15, y: 15, z: 5 }) },
      { partId: pinId, name: 'Goupille (2)', matrix: translation4({ x: 45, y: 15, z: 5 }) },
    ];
    const { text } = service.exportStep(documentForWorker(doc), [], placements);
    // Trois instances sous le nœud d'assemblage, deux solides seulement (la goupille est partagée).
    expect(count(text, /NEXT_ASSEMBLY_USAGE_OCCURRENCE\(/g)).toBe(3);
    expect(count(text, /MANIFOLD_SOLID_BREP\(/g)).toBe(2);
    expect(text).toMatch(/PRODUCT\('Montage'/);
    expect(text).toMatch(/PRODUCT\('Goupille'/);
    expect(text).toMatch(/'Goupille \(2\)'/);
    // Relu : trois solides à leur place.
    const read = kernel.readStep(new TextEncoder().encode(text));
    expect(read.solids.length).toBe(3);
    const boxes = read.solids.map((s) => kernel.analyze(s).bbox!).sort((a, b) => a.min.x - b.min.x || a.max.x - b.max.x);
    const pins = boxes.filter((b) => b.max.z - b.min.z > 9);
    expect(pins.map((b) => Math.round(b.min.x))).toEqual([12, 42]);
    expect(pins.every((b) => Math.abs(b.min.z - 5) < 1e-6)).toBe(true);
    read.solids.forEach((s) => kernel.dispose(s));
  });
});
