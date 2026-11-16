import { beforeAll, describe, expect, it } from 'vitest';
import { addKicadBoard, componentShape } from '../../src/app/kicad-board';
import { createDocument } from '../../src/domain/document';
import { RecomputeEngine } from '../../src/features/engine';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { estimatedHeight, modelBox, parseKicadBoard } from '../../src/io/kicad-pcb';
import { getKernel } from '../helpers/kernel';

/**
 * Carte d'essai (KiCad 9) : 40 × 30 mm aux coins arrondis (rayon 2), épaisseur 1,6, un trou de
 * fixation Ø 3,2, une résistance 0805 sur le dessus tournée de 90° avec son modèle 3D, un
 * connecteur sur le dessous sans modèle.
 */
const BOARD = `(kicad_pcb (version 20241229) (generator "pcbnew")
  (general (thickness 1.6))
  (gr_line (start 102 100) (end 138 100) (layer "Edge.Cuts"))
  (gr_arc (start 138 100) (mid 139.414214 100.585786) (end 140 102) (layer "Edge.Cuts"))
  (gr_line (start 140 102) (end 140 128) (layer "Edge.Cuts"))
  (gr_arc (start 140 128) (mid 139.414214 129.414214) (end 138 130) (layer "Edge.Cuts"))
  (gr_line (start 138 130) (end 102 130) (layer "Edge.Cuts"))
  (gr_arc (start 102 130) (mid 100.585786 129.414214) (end 100 128) (layer "Edge.Cuts"))
  (gr_line (start 100 128) (end 100 102) (layer "Edge.Cuts"))
  (gr_arc (start 100 102) (mid 100.585786 100.585786) (end 102 100) (layer "Edge.Cuts"))
  (footprint "MountingHole:MountingHole_3.2mm_M3" (layer "F.Cu") (at 105 105)
    (property "Reference" "H1")
    (pad "" np_thru_hole circle (at 0 0) (size 3.2 3.2) (drill 3.2) (layers "*.Cu")))
  (footprint "Resistor_SMD:R_0805_2012Metric" (layer "F.Cu") (at 120 115 90)
    (property "Reference" "R1") (property "Value" "10k")
    (fp_rect (start -1.7 -1) (end 1.7 1) (layer "F.CrtYd"))
    (pad "1" smd roundrect (at -0.9 0) (size 1 1.3) (layers "F.Cu"))
    (pad "2" smd roundrect (at 0.9 0) (size 1 1.3) (layers "F.Cu"))
    (model "\${KICAD9_3DMODEL_DIR}/Resistor_SMD.3dshapes/R_0805_2012Metric.wrl" (offset (xyz 0 0 0)) (scale (xyz 1 1 1)) (rotate (xyz 0 0 0))))
  (footprint "Connector_JST:JST_XH_B2B-XH-A_1x02_P2.50mm_Vertical" (layer "B.Cu") (at 130 120)
    (property "Reference" "J1")
    (fp_rect (start -2.5 -2.9) (end 5 3.4) (layer "B.CrtYd"))
    (pad "1" thru_hole rect (at 0 0) (size 1.7 2) (drill 1) (layers "*.Cu"))
    (pad "2" thru_hole oval (at 2.5 0) (size 1.7 2) (drill 1) (layers "*.Cu"))))`;

describe('import d’une carte KiCad', () => {
  let kernel: GeometryKernel;
  beforeAll(async () => {
    kernel = await getKernel();
  });

  it('lit le contour, l’épaisseur, le trou de fixation et les composants', () => {
    const b = parseKicadBoard(BOARD, 'Essai');
    expect(b.thickness).toBe(1.6);
    expect(b.outline).toHaveLength(8);
    // Coin bas gauche du contour à l'origine, Y vers le haut : le trou (105, 105) est à 5 mm du bord haut.
    expect(b.holes).toEqual([{ center: { x: 5, y: 25 }, diameter: 3.2, ref: 'H1' }]);
    expect(b.components.map((c) => [c.ref, c.side, c.rotation, c.through])).toEqual([
      ['R1', 'top', 90, false],
      ['J1', 'bottom', 0, true],
    ]);
    expect(b.components[0]!.at).toEqual({ x: 20, y: 15 });
    // Emprise : Y vers le haut dans le repère de l'empreinte.
    expect(b.components[0]!.box).toEqual({ min: { x: -1.7, y: -1 }, max: { x: 1.7, y: 1 } });
    expect(b.components[0]!.models[0]!.file).toBe('R_0805_2012Metric.wrl');
  });

  it('place le modèle 3D comme KiCad (angles comptés à l’opposé) et estime une hauteur sans modèle', () => {
    const model = { path: '', file: 'x.step', offset: { x: 1, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, rotate: { x: -90, y: 0, z: 0 } };
    // Boîte de 2 × 4 × 1 : après −90° (écrit) autour de X, sa profondeur Y devient sa hauteur.
    const b = modelBox(model, { min: { x: 0, y: 0, z: 0 }, max: { x: 2, y: 4, z: 1 } });
    expect(b.min.x).toBeCloseTo(1, 9);
    expect(b.max.x).toBeCloseTo(3, 9);
    expect(b.max.z - b.min.z).toBeCloseTo(4, 9);
    expect(b.max.y - b.min.y).toBeCloseTo(1, 9);
    expect(estimatedHeight('Capacitor_SMD:CP_Elec_5x5.4', false)).toBe(5.4);
    expect(estimatedHeight('Connector_JST:JST_XH_B2B-XH-A_1x02_P2.50mm_Vertical', true)).toBe(7);
    expect(estimatedHeight('Inconnu:Bidule', true)).toBe(8);
  });

  it('hauteur réelle tirée du modèle, retournée pour un composant du dessous', () => {
    const b = parseKicadBoard(BOARD, 'Essai');
    const boxes = new Map([['r_0805_2012metric.wrl', { min: { x: -1, y: -0.62, z: 0 }, max: { x: 1, y: 0.62, z: 0.55 } }]]);
    const r1 = componentShape(b.components[0]!, boxes);
    expect(r1.fromModel).toBe(true);
    expect(r1.box.max.z).toBeCloseTo(0.55, 9);
    const j1 = componentShape(b.components[1]!, boxes);
    expect(j1.fromModel).toBe(false);
    expect(j1.box.max.z).toBe(7);
    // Côté dessous : l'emprise est celle du courtyard, telle qu'elle est posée (Y vers le haut).
    expect(j1.box.min.y).toBeCloseTo(-3.4, 9);
  });

  it('construit un ensemble calculable : carte percée et composants posés de chaque côté', () => {
    const board = parseKicadBoard(BOARD, 'Essai');
    const r = addKicadBoard(createDocument('Projet'), board, new Map([['r_0805_2012metric.wrl', { min: { x: -1, y: -0.62, z: 0 }, max: { x: 1, y: 0.62, z: 0.55 } }]]));
    expect(r.components).toBe(2);
    expect(r.fromModel).toBe(1);
    expect(r.estimated).toEqual(['J1']);
    const evs = new RecomputeEngine(kernel, { get: () => undefined }).evaluateDocument(r.doc);
    expect(evs.filter((e) => e.failedFeatureId)).toEqual([]);
    const boardPart = r.doc.parts.find((p) => p.name === 'Essai')!;
    const volume = evs.find((e) => e.partId === boardPart.id)!.analysis!.volume;
    // Rectangle 40 × 30 aux coins arrondis de rayon 2, moins le trou Ø 3,2, sur 1,6 mm.
    expect(volume).toBeCloseTo((40 * 30 - (4 - Math.PI) * 4 - Math.PI * 1.6 * 1.6) * 1.6, 1);
    const sub = r.doc.subassemblies!.find((s) => s.id === r.ensembleId)!;
    expect(sub.name).toBe('Essai');
    expect(sub.instances.map((i) => [i.name, i.position.z, i.rotation?.z ?? 0])).toEqual([
      ['Essai', 0, 0],
      ['R1', 1.6, 90],
      ['J1', 0, 0],
    ]);
    // Le connecteur du dessous pend sous la carte.
    const j1 = r.doc.parts.find((p) => p.name.startsWith('JST_XH'))!;
    expect(evs.find((e) => e.partId === j1.id)!.analysis!.bbox!.max.z).toBeCloseTo(0, 6);
    expect(evs.find((e) => e.partId === j1.id)!.analysis!.bbox!.min.z).toBeCloseTo(-7, 6);
  });

  it('refuse un fichier qui n’est pas une carte, ou une carte sans contour', () => {
    expect(() => parseKicadBoard('(kicad_sch (version 20231120))', 'x')).toThrow(/pas une carte/);
    expect(() => parseKicadBoard('(kicad_pcb (version 20241229))', 'x')).toThrow(/contour/);
  });
});
