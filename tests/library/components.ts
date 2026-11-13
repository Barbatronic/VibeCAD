/**
 * Composants de la bibliothèque Barbatronic (dépôt VibeCAD-Components), construits par le modèle
 * métier comme le ferait l'utilisateur : esquisses, extrusions, poches, chanfreins, générateur
 * d'engrenages. `npm run library:build` les écrit en .vibecad (historique paramétrique) et en
 * .step (solide exact), avec leur fiche .json ; les vignettes .png viennent de la vue 3D.
 *
 * Un dossier = une collection (bearings/, motors/…) ; un composant = des fichiers de même nom.
 * Toutes les esquisses sont entièrement cotées (0 degré de liberté) : voir ./sketch.ts.
 */
import {
  addFeature,
  createDocument,
  findPart,
  makeChamferFeature,
  makeExtrudeFeature,
  makeFilletFeature,
  makeGearFeature,
  makeLoftFeature,
  makePatternFeature,
  makePocketFeature,
  makeSketchFeature,
  renamePart,
  setPartColor,
  setPartMaterial,
} from '../../src/domain/document';
import type { CadDocument, EdgeRef, Id, SketchParams, SketchSupport } from '../../src/domain/model';
import { textWidth } from '../../src/sketch/text';
import { circles, hexagonPoints, octagonPoints, polygon, rectangle, solved, text } from './sketch';

export interface CollectionSpec {
  /** Nom du dossier. */
  id: string;
  name: string;
  description: string;
}

export interface ComponentSpec {
  collection: string;
  /** Nom des fichiers (sans extension). */
  id: string;
  name: string;
  description: string;
  tags: string[];
  /** Cotes principales (mm), affichées dans la fiche. */
  dimensions: Record<string, number>;
  build: () => CadDocument;
}

export const COLLECTIONS: CollectionSpec[] = [
  { id: 'bearings', name: 'Roulements', description: 'Roulements à billes à gorge profonde, à joints (2RS) ou flasques métalliques (ZZ), avec ou sans collerette.' },
  { id: 'motors', name: 'Moteurs', description: 'Moteurs pas à pas NEMA 17 : flasques et paquet de tôles, centreur, arbre à méplat, taraudages de fixation, connecteur JST-PH.' },
  { id: 'pulleys', name: 'Poulies', description: 'Poulies crantées GT2 pour courroie de 6 mm, alésage 5 mm.' },
  { id: 'couplers', name: 'Accouplements', description: 'Accouplements rigides entre deux arbres, avec vis de pression.' },
  { id: 'servos', name: 'Servomoteurs', description: 'Servomoteurs de modélisme : format standard (MG996R) et micro (SG90, MG90S), boîtier en trois parties, pattes de fixation, cannelure dentée et sortie du câble. Axe de sortie à l’origine.' },
  { id: 'horns', name: 'Palonniers', description: 'Palonniers métalliques pour servomoteurs : cannelure dentée et trous taraudés. Axe de la cannelure sur Z, face de la cannelure en Z = 0.' },
];

/** Pièce unique : nom, couleur, matière. */
function single(name: string, color: string, material: string): { doc: CadDocument; partId: Id } {
  let doc = createDocument(name);
  const partId = doc.parts[0]!.id;
  doc = setPartMaterial(setPartColor(renamePart(doc, partId, name), partId, color), partId, material);
  return { doc, partId };
}

/** Ajoute une esquisse de cercles sur un support ; renvoie l'esquisse et les identifiants des cercles. */
function circleSketch(doc: CadDocument, partId: Id, support: SketchSupport, list: { x: number; y: number; r: number }[], name?: string) {
  const sk = makeSketchFeature(doc, findPart(doc, partId)!, support);
  const c = circles(sk.params, list);
  return { doc: addFeature(doc, partId, { ...sk, ...(name ? { name } : {}), params: c.sketch }), sketchId: sk.id, circles: c.ids };
}

/**
 * Roulement à billes : bague d × D × B, flasques en léger retrait, chanfreins. Par défaut un
 * roulement « 2RS » (joints) ; `designation` donne la référence complète (MF83ZZ : flasques
 * métalliques), `flange` une collerette [diamètre, épaisseur] du côté de la face de départ.
 */
function bearing(code: string, d: number, D: number, B: number, opts: { designation?: string; flange?: [number, number] } = {}): ComponentSpec {
  const ref = opts.designation ?? `${code}-2RS`;
  const fmt = (v: number) => String(v).replace('.', ',');
  const flange = opts.flange;
  return {
    collection: 'bearings',
    id: ref.toLowerCase(),
    name: `Roulement ${ref}`,
    description: flange
      ? `Roulement à billes à collerette ${ref} : alésage ${fmt(d)} mm, diamètre extérieur ${fmt(D)} mm, largeur ${fmt(B)} mm, collerette Ø ${fmt(flange[0])} × ${fmt(flange[1])} mm.`
      : `Roulement à billes ${ref} : alésage ${d} mm, diamètre extérieur ${D} mm, largeur ${B} mm.`,
    tags: ['roulement', code, `${d}x${D}x${B}`, ...(flange ? ['collerette'] : [])],
    dimensions: { d, D, B, ...(flange ? { D1: flange[0], C1: flange[1] } : {}) },
    build: () => {
      let { doc, partId } = single(`Roulement ${ref}`, '#b8c0ca', 'steel');
      const s1 = circleSketch(doc, partId, { kind: 'plane', plane: 'XY', offset: 0 }, [
        { x: 0, y: 0, r: D / 2 },
        { x: 0, y: 0, r: d / 2 },
      ]);
      doc = s1.doc;
      const ex = makeExtrudeFeature(doc, findPart(doc, partId)!, s1.sketchId, B);
      doc = addFeature(doc, partId, ex);
      const edge = (circle: string, role: 'start' | 'end'): EdgeRef => ({
        faces: [
          { featureId: ex.id, role: 'side', entityId: circle },
          { featureId: ex.id, role },
        ],
      });
      const c = Math.min(0.5, B / 12);
      // Collerette : le bord extérieur de la face de départ est pris dedans, il n'est pas chanfreiné.
      const chamfered = s1.circles.flatMap((id, k) => (flange && k === 0 ? [edge(id, 'end')] : [edge(id, 'start'), edge(id, 'end')]));
      doc = addFeature(doc, partId, makeChamferFeature(doc, findPart(doc, partId)!, chamfered, c));
      // Flasques : anneau en retrait de 0,3 mm sur chaque face.
      const w = (D - d) / 2;
      const seal = [
        { x: 0, y: 0, r: D / 2 - w * 0.18 },
        { x: 0, y: 0, r: d / 2 + w * 0.28 },
      ];
      for (const role of ['end', 'start'] as const) {
        const s = circleSketch(doc, partId, { kind: 'face', ref: { featureId: ex.id, role } }, seal);
        doc = s.doc;
        doc = addFeature(doc, partId, makePocketFeature(doc, findPart(doc, partId)!, s.sketchId, { kind: 'distance', distance: 0.3 }));
      }
      if (flange) {
        // Anneau de la collerette, qui mord de 0,2 mm sur la bague (soudure franche).
        const f = circleSketch(doc, partId, { kind: 'plane', plane: 'XY', offset: 0 }, [
          { x: 0, y: 0, r: flange[0] / 2 },
          { x: 0, y: 0, r: D / 2 - 0.2 },
        ]);
        doc = f.doc;
        doc = addFeature(doc, partId, makeExtrudeFeature(doc, findPart(doc, partId)!, f.sketchId, flange[1]));
      }
      return doc;
    },
  };
}

/** Esquisse dessinée par `draw` sur un support ; l'étape est nommée. */
function sketchOn(doc: CadDocument, partId: Id, support: SketchSupport, name: string, draw: (params: SketchParams) => SketchParams) {
  const sk = makeSketchFeature(doc, findPart(doc, partId)!, support);
  return { doc: addFeature(doc, partId, { ...sk, name, params: solved(draw(sk.params)) }), sketchId: sk.id };
}

/** Étape ajoutée sous un nom parlant (l'historique se lit comme une notice). */
function named<T extends { name: string }>(feature: T, name: string): T {
  return { ...feature, name };
}

const XY = (offset = 0): SketchSupport => ({ kind: 'plane', plane: 'XY', offset });
const XZ = (offset = 0): SketchSupport => ({ kind: 'plane', plane: 'XZ', offset });
const YZ = (offset = 0): SketchSupport => ({ kind: 'plane', plane: 'YZ', offset });

/** Octogone décalé vers l'intérieur de `d` sur chaque côté. */
const insetOctagon = (half: number, chamfer: number, d: number) => octagonPoints(half - d, chamfer - d * (2 - Math.SQRT2));

/**
 * Moteur pas à pas NEMA 17 (type 17HS) : corps octogonal 42,3 mm, flasques aluminium avant et
 * arrière séparés du paquet de tôles par une fine rainure, centreur Ø 22 × 2, arbre Ø 5 avec
 * méplat de 0,5 mm sur 15 mm, 4 taraudages M3 à 31 mm, 4 vis d'assemblage à six pans creux à
 * l'arrière, connecteur JST-PH 6 broches sur le côté. Face arrière en Z = 0, arbre vers +Z.
 */
function nema17(length: number): ComponentSpec {
  const A = 42.3;
  const half = A / 2;
  const corner = 4;
  const cap = length <= 34 ? 7.5 : 8.5;
  return {
    collection: 'motors',
    id: `nema17-${length}`,
    name: `Moteur NEMA 17 × ${length} mm`,
    description: `Moteur pas à pas NEMA 17, corps de ${length} mm, arbre Ø 5 × 24 mm avec méplat, centreur Ø 22 mm, 4 taraudages M3 à 31 mm d'entraxe, connecteur JST-PH 6 broches.`,
    tags: ['moteur', 'pas à pas', 'NEMA 17', '17HS'],
    dimensions: { A, L: length, arbre: 5, centreur: 22, entraxe: 31 },
    build: () => {
      let { doc, partId } = single(`Moteur NEMA 17 × ${length}`, '#3a3f47', 'steel');
      const part = () => findPart(doc, partId)!;
      // Corps : octogone (carré 42,3 aux coins abattus), arêtes avant et arrière arrondies.
      const body = sketchOn(doc, partId, XY(), 'Esquisse du corps', (p) => polygon(p, octagonPoints(half, corner)).sketch);
      doc = body.doc;
      const sides = findPart(doc, partId)!.features.find((f) => f.id === body.sketchId)!;
      const lineIds = (sides.type === 'sketch' ? sides.params.entities : []).filter((e) => e.type === 'line').map((e) => e.id);
      const ex = named(makeExtrudeFeature(doc, part(), body.sketchId, length), 'Corps');
      doc = addFeature(doc, partId, ex);
      const rim = (role: 'start' | 'end'): EdgeRef[] => lineIds.map((l) => ({ faces: [{ featureId: ex.id, role: 'side', entityId: l }, { featureId: ex.id, role }] }));
      doc = addFeature(doc, partId, named(makeFilletFeature(doc, part(), rim('start'), 1), 'Arrondi arrière'));
      doc = addFeature(doc, partId, named(makeFilletFeature(doc, part(), rim('end'), 0.6), 'Arrondi avant'));
      // Rainures entre les flasques et le paquet de tôles (1 mm de haut, 0,5 mm de profondeur).
      for (const [z, label] of [
        [cap + 1, 'arrière'],
        [length - cap, 'avant'],
      ] as const) {
        const g = sketchOn(doc, partId, XY(z), `Esquisse rainure ${label}`, (p) => polygon(rectangle(p, A + 6, A + 6).sketch, insetOctagon(half, corner, 0.5)).sketch);
        doc = g.doc;
        doc = addFeature(doc, partId, named(makePocketFeature(doc, part(), g.sketchId, { kind: 'distance', distance: 1 }), `Rainure ${label}`));
      }
      // Centreur Ø 22 × 2 puis arbre Ø 5 : 24 mm depuis la face avant, pointe chanfreinée.
      const pilot = circleSketch(doc, partId, { kind: 'face', ref: { featureId: ex.id, role: 'end' } }, [{ x: 0, y: 0, r: 11 }], 'Esquisse du centreur');
      doc = pilot.doc;
      const exPilot = named(makeExtrudeFeature(doc, part(), pilot.sketchId, 2), 'Centreur');
      doc = addFeature(doc, partId, exPilot);
      const shaft = circleSketch(doc, partId, { kind: 'face', ref: { featureId: exPilot.id, role: 'end' } }, [{ x: 0, y: 0, r: 2.5 }], 'Esquisse de l’arbre');
      doc = shaft.doc;
      const exShaft = named(makeExtrudeFeature(doc, part(), shaft.sketchId, 22), 'Arbre');
      doc = addFeature(doc, partId, exShaft);
      const tip: EdgeRef = { faces: [{ featureId: exShaft.id, role: 'side', entityId: shaft.circles[0]! }, { featureId: exShaft.id, role: 'end' }] };
      doc = addFeature(doc, partId, named(makeChamferFeature(doc, part(), [tip], 0.5), 'Chanfrein de l’arbre'));
      // Méplat : 0,5 mm sur les 15 derniers millimètres (4,5 mm sur plat).
      const top = length + 24;
      const flat = sketchOn(doc, partId, YZ(2), 'Esquisse du méplat', (p) => rectangle(p, 8, 16, 0, top - 7.5).sketch);
      doc = flat.doc;
      doc = addFeature(doc, partId, named(makePocketFeature(doc, part(), flat.sketchId, { kind: 'distance', distance: 2 }, 'reversed'), 'Méplat'));
      // Taraudages M3 de fixation (Ø 2,5 de perçage, 4,5 mm de profondeur).
      const m3 = [-15.5, 15.5].flatMap((x) => [-15.5, 15.5].map((y) => ({ x, y, r: 1.25 })));
      const taps = circleSketch(doc, partId, { kind: 'face', ref: { featureId: ex.id, role: 'end' } }, m3, 'Esquisse des taraudages');
      doc = taps.doc;
      doc = addFeature(doc, partId, named(makePocketFeature(doc, part(), taps.sketchId, { kind: 'distance', distance: 4.5 }), 'Taraudages M3'));
      // Vis d'assemblage à l'arrière : tête Ø 5,5 entourée d'un jeu, six pans creux de 2,5.
      const heads = sketchOn(doc, partId, XY(), 'Esquisse des têtes de vis', (p) => {
        let q = p;
        for (const x of [-15.5, 15.5]) for (const y of [-15.5, 15.5]) q = circles(q, [{ x, y, r: 3.1 }, { x, y, r: 2.75 }]).sketch;
        return q;
      });
      doc = heads.doc;
      doc = addFeature(doc, partId, named(makePocketFeature(doc, part(), heads.sketchId, { kind: 'distance', distance: 0.6 }, 'reversed'), 'Têtes de vis'));
      const sockets = sketchOn(doc, partId, XY(), 'Esquisse des six pans', (p) => {
        let q = p;
        for (const x of [-15.5, 15.5]) for (const y of [-15.5, 15.5]) q = polygon(q, hexagonPoints(2.5, x, y)).sketch;
        return q;
      });
      doc = sockets.doc;
      doc = addFeature(doc, partId, named(makePocketFeature(doc, part(), sockets.sketchId, { kind: 'distance', distance: 1.8 }, 'reversed'), 'Six pans creux'));
      // Connecteur JST-PH 6 broches : logement dans le flasque arrière (face −Y), boîtier en retrait de 0,4 mm, ouverture.
      const zc = cap / 2 + 0.5;
      const win = sketchOn(doc, partId, XZ(half), 'Esquisse du logement du connecteur', (p) => rectangle(p, 16.5, 5.6, 0, zc).sketch);
      doc = win.doc;
      doc = addFeature(doc, partId, named(makePocketFeature(doc, part(), win.sketchId, { kind: 'distance', distance: 5 }), 'Logement du connecteur'));
      const housing = sketchOn(doc, partId, XZ(half - 5), 'Esquisse du connecteur', (p) => rectangle(p, 15.5, 4.8, 0, zc).sketch);
      doc = housing.doc;
      doc = addFeature(doc, partId, named(makeExtrudeFeature(doc, part(), housing.sketchId, 4.6), 'Connecteur'));
      const mouth = sketchOn(doc, partId, XZ(half - 0.4), 'Esquisse de l’ouverture du connecteur', (p) => rectangle(p, 13, 2.6, 0, zc).sketch);
      doc = mouth.doc;
      doc = addFeature(doc, partId, named(makePocketFeature(doc, part(), mouth.sketchId, { kind: 'distance', distance: 3.5 }), 'Ouverture du connecteur'));
      return doc;
    },
  };
}

/** Poulie GT2 (générateur d'engrenages), alésage 5 mm, flasques. */
function gt2(teeth: number): ComponentSpec {
  return {
    collection: 'pulleys',
    id: `gt2-${teeth}t-5mm`,
    name: `Poulie GT2 ${teeth} dents`,
    description: `Poulie crantée GT2 ${teeth} dents pour courroie de 6 mm, alésage 5 mm, avec flasques.`,
    tags: ['poulie', 'GT2', 'courroie'],
    dimensions: { dents: teeth, alésage: 5, largeur: 7 },
    build: () => {
      let { doc, partId } = single(`Poulie GT2 ${teeth} dents`, '#d9a441', 'aluminium');
      const gear = makeGearFeature(doc, findPart(doc, partId)!, 'pulley');
      doc = addFeature(doc, partId, { ...gear, params: { ...gear.params, belt: 'GT2-2', teeth, thickness: 7, bore: 5, flanges: true } });
      return doc;
    },
  };
}

/** Accouplement rigide d1 / d2 : cylindre Ø D × L, deux alésages, deux vis de pression M3. */
function coupler(d1: number, d2: number): ComponentSpec {
  const D = 19;
  const L = 25;
  return {
    collection: 'couplers',
    id: `rigid-${d1}x${d2}`,
    name: `Accouplement rigide ${d1} / ${d2} mm`,
    description: `Accouplement rigide Ø ${D} × ${L} mm entre un arbre de ${d1} mm et un arbre de ${d2} mm, deux vis de pression M3.`,
    tags: ['accouplement', 'arbre', `${d1}x${d2}`],
    dimensions: { D, L, d1, d2 },
    build: () => {
      let { doc, partId } = single(`Accouplement ${d1} / ${d2}`, '#9aa7b4', 'aluminium');
      const body = circleSketch(doc, partId, { kind: 'plane', plane: 'XY', offset: 0 }, [{ x: 0, y: 0, r: D / 2 }]);
      doc = body.doc;
      const ex = makeExtrudeFeature(doc, findPart(doc, partId)!, body.sketchId, L);
      doc = addFeature(doc, partId, ex);
      for (const [role, d] of [['start', d1], ['end', d2]] as const) {
        const s = circleSketch(doc, partId, { kind: 'face', ref: { featureId: ex.id, role } }, [{ x: 0, y: 0, r: d / 2 }]);
        doc = s.doc;
        doc = addFeature(doc, partId, makePocketFeature(doc, findPart(doc, partId)!, s.sketchId, { kind: 'distance', distance: L / 2 + 0.5 }));
      }
      // Vis de pression : un trou M3 radial au milieu de chaque alésage.
      const screws = circleSketch(doc, partId, { kind: 'plane', plane: 'XZ', offset: 0 }, [
        { x: 0, y: L / 4, r: 1.25 },
        { x: 0, y: (3 * L) / 4, r: 1.25 },
      ]);
      doc = screws.doc;
      doc = addFeature(doc, partId, makePocketFeature(doc, findPart(doc, partId)!, screws.sketchId, { kind: 'throughAll' }, 'symmetric'));
      return doc;
    },
  };
}

interface ServoSize {
  /** Boîtier : longueur (X), largeur (Y), hauteur (Z, sans la sortie). */
  body: [number, number, number];
  /** Rayon des arêtes verticales du boîtier. */
  round: number;
  /** Joints du boîtier : hauteur du fond et du haut du boîtier central (rainures de 0,4 mm). */
  seams: [number, number];
  /** Pattes : longueur totale, épaisseur, hauteur du dessous des pattes. */
  tabs: { length: number; thickness: number; z: number };
  /** Trous des pattes : diamètre, entraxe en longueur et en largeur (0 : un trou par patte), largeur de la fente vers le bout. */
  holes: { d: number; spanX: number; spanY: number; slot: number };
  /** Nervure sur chaque patte, au milieu : épaisseur, saillie le long de la patte, hauteur au-dessus de la patte. */
  rib: [number, number, number];
  /**
   * Sortie : distance de l'axe au bout du boîtier, tour (Ø, hauteur), dôme du pignon voisin
   * (Ø, distance à l'axe ; 0 : aucun), cannelure (Ø, hauteur, dents), vis du palonnier (Ø de perçage).
   */
  output: { fromEnd: number; tower: [number, number]; dome: [number, number]; spline: [number, number, number]; screw: number };
  /** Vis du fond : diamètre, retrait depuis les bords. */
  bottomScrews: { d: number; inset: number };
  /**
   * Sortie du câble (sous l'axe de sortie, au bout le plus proche) : passe-fil logé dans une encoche du boîtier
   * (largeur, hauteur, saillie), nappe (largeur, épaisseur, longueur).
   */
  cable: { boot: [number, number, number]; ribbon: [number, number, number] };
}

/**
 * Servomoteur : boîtier en trois parties (fond, boîtier central avec ses pattes, couvercle),
 * arêtes arrondies, vis du fond, pattes percées et fendues avec leur nervure, tour de sortie et cannelure dentée avec
 * la vis du palonnier, passe-fil dans son encoche et nappe à trois fils. L'axe de sortie est sur l'axe Z (X = Y = 0),
 * le dessous du boîtier en Z = 0.
 */
function servo(id: string, code: string, size: ServoSize, color: string, realMass: number, extra: string): ComponentSpec {
  const [L, W, H] = size.body;
  const o = size.output;
  const height = H + o.tower[1] + o.spline[1];
  // Le boîtier s'étend de X = fromEnd − L à X = fromEnd : l'axe de sortie est à l'origine.
  const cx = o.fromEnd - L / 2;
  const fmt = (v: number) => String(Math.round(v * 10) / 10).replace('.', ',');
  return {
    collection: 'servos',
    id,
    name: `Servomoteur ${code}`,
    description: `Servomoteur ${code} : boîtier ${fmt(L)} × ${fmt(W)} × ${fmt(H)} mm, hauteur ${fmt(height)} mm avec la cannelure (${o.spline[2]} dents), pattes de ${fmt(size.tabs.length)} mm percées Ø ${fmt(size.holes.d)} (entraxe ${fmt(size.holes.spanX)} mm). ${extra} Masse réelle ≈ ${fmt(realMass)} g (moteur et engrenages).`,
    tags: ['servomoteur', 'servo', code, 'modélisme'],
    dimensions: { L, W, H, pattes: size.tabs.length, entraxe: size.holes.spanX, dents: o.spline[2] },
    build: () => {
      let { doc, partId } = single(`Servomoteur ${code}`, color, 'abs');
      const part = () => findPart(doc, partId)!;
      // Boîtier, arêtes verticales arrondies.
      let rect: [string, string, string, string] = ['', '', '', ''];
      const body = sketchOn(doc, partId, XY(), 'Esquisse du boîtier', (p) => {
        const r = rectangle(p, L, W, cx, 0);
        rect = r.lines;
        return r.sketch;
      });
      doc = body.doc;
      const exBody = named(makeExtrudeFeature(doc, part(), body.sketchId, H), 'Boîtier');
      doc = addFeature(doc, partId, exBody);
      const verticals: EdgeRef[] = rect.map((l, i) => ({
        faces: [
          { featureId: exBody.id, role: 'side', entityId: l },
          { featureId: exBody.id, role: 'side', entityId: rect[(i + 1) % 4]! },
        ],
      }));
      doc = addFeature(doc, partId, named(makeFilletFeature(doc, part(), verticals, size.round), 'Arrondis du boîtier'));
      // Pattes : une plaque sur toute la longueur, à la hauteur de fixation, arêtes du bout arrondies.
      const tabs = sketchOn(doc, partId, XY(size.tabs.z), 'Esquisse des pattes', (p) => rectangle(p, size.tabs.length, W, cx, 0).sketch);
      doc = tabs.doc;
      const exTabs = named(makeExtrudeFeature(doc, part(), tabs.sketchId, size.tabs.thickness), 'Pattes');
      doc = addFeature(doc, partId, exTabs);
      // Trous et fentes des pattes (la fente débouche au bout de la patte).
      const hx = size.holes.spanX / 2;
      const ys = size.holes.spanY ? [-size.holes.spanY / 2, size.holes.spanY / 2] : [0];
      const holes = circleSketch(doc, partId, XY(size.tabs.z), [-hx, hx].flatMap((x) => ys.map((y) => ({ x: cx + x, y, r: size.holes.d / 2 }))), 'Esquisse des trous de fixation');
      doc = holes.doc;
      doc = addFeature(doc, partId, named(makePocketFeature(doc, part(), holes.sketchId, { kind: 'throughAll' }, 'reversed'), 'Trous de fixation'));
      const slotFrom = size.holes.spanY ? hx : hx + size.holes.d / 4;
      const slotLen = size.tabs.length / 2 - slotFrom + 1;
      const slots = sketchOn(doc, partId, XY(size.tabs.z), 'Esquisse des fentes', (p) => {
        let q = p;
        for (const sx of [-1, 1]) q = rectangle(q, slotLen, size.holes.slot, cx + sx * (slotFrom + slotLen / 2), 0).sketch;
        return q;
      });
      doc = slots.doc;
      doc = addFeature(doc, partId, named(makePocketFeature(doc, part(), slots.sketchId, { kind: 'throughAll' }, 'reversed'), 'Fentes des pattes'));
      // Joints entre le fond, le boîtier central et le couvercle : rainures de 0,6 mm de haut, 0,4 mm de profondeur.
      for (const [z, label] of [
        [size.seams[0] + 0.6, 'du fond'],
        [size.seams[1] + 0.6, 'du couvercle'],
      ] as const) {
        const g = sketchOn(doc, partId, XY(z), `Esquisse du joint ${label}`, (p) => rectangle(rectangle(p, size.tabs.length + 6, W + 6, cx, 0).sketch, L - 0.8, W - 0.8, cx, 0).sketch);
        doc = g.doc;
        doc = addFeature(doc, partId, named(makePocketFeature(doc, part(), g.sketchId, { kind: 'distance', distance: 0.6 }), `Joint ${label}`));
      }
      // Nervure triangulaire sur chaque patte, contre le boîtier, entre le boîtier et le trou (mord de 0,3 mm dans le boîtier et la patte).
      const [rt, rl, rh] = size.rib;
      const zt = size.tabs.z + size.tabs.thickness;
      const ribs = sketchOn(doc, partId, XZ(-rt / 2), 'Esquisse des nervures', (p) => {
        let q = p;
        for (const sx of [-1, 1]) {
          const x0 = cx + sx * (L / 2 - 0.3);
          const x1 = cx + sx * (L / 2 + rl);
          q = polygon(q, [
            { x: x0, y: zt - 0.3 },
            { x: x1, y: zt - 0.3 },
            { x: x1, y: zt },
            { x: x0, y: zt + rh },
          ]).sketch;
        }
        return q;
      });
      doc = ribs.doc;
      doc = addFeature(doc, partId, named(makeExtrudeFeature(doc, part(), ribs.sketchId, rt), 'Nervures des pattes'));
      // Vis du fond, aux quatre coins.
      const bs = size.bottomScrews;
      const screws = circleSketch(
        doc,
        partId,
        XY(),
        [-1, 1].flatMap((sx) => [-1, 1].map((sy) => ({ x: cx + sx * (L / 2 - bs.inset), y: sy * (W / 2 - bs.inset), r: bs.d / 2 }))),
        'Esquisse des vis du fond',
      );
      doc = screws.doc;
      doc = addFeature(doc, partId, named(makePocketFeature(doc, part(), screws.sketchId, { kind: 'distance', distance: 3 }, 'reversed'), 'Vis du fond'));
      // Tour de sortie (et dôme du pignon voisin), cannelure, vis du palonnier.
      const tower = circleSketch(doc, partId, XY(H), [{ x: 0, y: 0, r: o.tower[0] / 2 }], 'Esquisse de la tour de sortie');
      doc = tower.doc;
      doc = addFeature(doc, partId, named(makeExtrudeFeature(doc, part(), tower.sketchId, o.tower[1]), 'Tour de sortie'));
      if (o.dome[0]) {
        const dome = circleSketch(doc, partId, XY(H), [{ x: -o.dome[1], y: 0, r: o.dome[0] / 2 }], 'Esquisse du dôme');
        doc = dome.doc;
        doc = addFeature(doc, partId, named(makeExtrudeFeature(doc, part(), dome.sketchId, o.tower[1]), 'Dôme du pignon'));
      }
      const top = H + o.tower[1];
      const spline = circleSketch(doc, partId, XY(top), [{ x: 0, y: 0, r: o.spline[0] / 2 }], 'Esquisse de la cannelure');
      doc = spline.doc;
      const exSpline = named(makeExtrudeFeature(doc, part(), spline.sketchId, o.spline[1]), 'Cannelure');
      doc = addFeature(doc, partId, exSpline);
      // Une rainure entre deux dents, répétée tout autour.
      const r = o.spline[0] / 2;
      const gap = (Math.PI * o.spline[0]) / o.spline[2] / 2;
      const groove = sketchOn(doc, partId, XY(top + o.spline[1]), 'Esquisse d’une rainure de cannelure', (p) => rectangle(p, gap, 0.8, 0, r).sketch);
      doc = groove.doc;
      const pkGroove = named(makePocketFeature(doc, part(), groove.sketchId, { kind: 'distance', distance: o.spline[1] - 0.3 }), 'Rainure de cannelure');
      doc = addFeature(doc, partId, pkGroove);
      const pattern = named(makePatternFeature(doc, part(), pkGroove.id, 'circular'), 'Dents de la cannelure');
      doc = addFeature(doc, partId, { ...pattern, params: { ...pattern.params, axis: { kind: 'axis', axis: 'Z' }, count: o.spline[2], angle: 360 } });
      const screw = circleSketch(doc, partId, XY(top + o.spline[1]), [{ x: 0, y: 0, r: o.screw / 2 }], 'Esquisse du taraudage');
      doc = screw.doc;
      doc = addFeature(doc, partId, named(makePocketFeature(doc, part(), screw.sketchId, { kind: 'distance', distance: o.spline[1] + 1 }), 'Taraudage du palonnier'));
      // Sortie du câble, au bas du bout le plus proche de l'axe de sortie (X = fromEnd) : encoche
      // de 1 mm dans le boîtier, passe-fil logé dedans (0,4 mm de jeu autour), nappe à trois fils.
      const end = o.fromEnd;
      const [bw, bh, bp] = size.cable.boot;
      const [ww, wt, wl] = size.cable.ribbon;
      const zb = Math.max(size.seams[0] + 0.6 + bh / 2 + 0.5, bh / 2 + 1);
      const notch = sketchOn(doc, partId, YZ(end), 'Esquisse de l’encoche du câble', (p) => rectangle(p, bw + 0.8, bh + 0.8, 0, zb).sketch);
      doc = notch.doc;
      doc = addFeature(doc, partId, named(makePocketFeature(doc, part(), notch.sketchId, { kind: 'distance', distance: 1 }), 'Encoche du câble'));
      const boot = sketchOn(doc, partId, YZ(end - 1.2), 'Esquisse du passe-fil', (p) => rectangle(p, bw, bh, 0, zb).sketch);
      doc = boot.doc;
      doc = addFeature(doc, partId, named(makeExtrudeFeature(doc, part(), boot.sketchId, bp + 1.2), 'Passe-fil'));
      const ribbon = sketchOn(doc, partId, YZ(end + bp), 'Esquisse de la nappe', (p) => {
        let q = p;
        for (let k = -1; k <= 1; k++) q = circles(q, [{ x: (k * ww) / 3, y: zb, r: wt / 2 }]).sketch;
        return q;
      });
      doc = ribbon.doc;
      doc = addFeature(doc, partId, named(makeExtrudeFeature(doc, part(), ribbon.sketchId, wl), 'Fils'));
      return doc;
    },
  };
}

/** Rectangle donné par ses bornes (X de x0 à x1, Y de y0 à y1). */
const box = (p: SketchParams, x0: number, x1: number, y0: number, y1: number) => rectangle(p, x1 - x0, y1 - y0, (x0 + x1) / 2, (y0 + y1) / 2);

/**
 * Servomoteur TowerPro MG996R, d'après son modèle 3D de référence. Repère de montage : axe de
 * sortie sur Z (X = Y = 0), dessous des pattes en Z = 0 (le servo se pose par là), câble vers +X.
 *  - fond (Z −28 à −21) chanfreiné de 2 mm, puis dépouille jusqu'au boîtier central (Z −1) ;
 *  - boîtier central 40 × 20 (Z −1 à 7,5), pattes de 54 × 19 × 2,4 avec trous Ø 4 (entraxe
 *    49 × 10) ouverts vers le bout et nervure inclinée ;
 *  - couvercle, tour Ø 20, bloc de l'étiquette, bagues Ø 13,2 et Ø 10,8, cannelure 25 dents Ø 6
 *    taraudée M3 (sommet en Z 15,5) ;
 *  - quatre vis à tête bombée cruciforme sous le fond, passe-fil et trois fils Ø 1,4.
 */
function mg996r(): ComponentSpec {
  return {
    collection: 'servos',
    id: 'mg996r',
    name: 'Servomoteur MG996R',
    description:
      'Servomoteur TowerPro MG996R : boîtier 40,7 × 20,5 × 40 mm, pattes de 54 mm percées Ø 4 (entraxe 49 × 10 mm), cannelure 25 dents Ø 6 taraudée M3. Repère de montage : axe de sortie sur Z, dessous des pattes en Z = 0. Pignons métal, couple ≈ 1 N·m sous 6 V. Masse réelle ≈ 55 g (moteur et engrenages).',
    tags: ['servomoteur', 'servo', 'MG996R', 'TowerPro', 'modélisme'],
    dimensions: { L: 40.7, W: 20.5, H: 40, pattes: 54, entraxe: 49, dents: 25 },
    build: () => {
      let { doc, partId } = single('Servomoteur MG996R', '#4a4d52', 'abs');
      const part = () => findPart(doc, partId)!;
      const add = <T extends Parameters<typeof addFeature>[2]>(f: T, name: string): T => {
        const g = named(f, name);
        doc = addFeature(doc, partId, g);
        return g;
      };
      const draw = (support: SketchSupport, name: string, fn: (p: SketchParams) => SketchParams) => {
        const r = sketchOn(doc, partId, support, name, fn);
        doc = r.doc;
        return r.sketchId;
      };
      const sides = (featureId: Id, lines: string[], role: 'start' | 'end'): EdgeRef[] => lines.map((l) => ({ faces: [{ featureId, role: 'side', entityId: l }, { featureId, role }] }));
      const verticals = (featureId: Id, lines: string[]): EdgeRef[] =>
        lines.map((l, i) => ({ faces: [{ featureId, role: 'side', entityId: l }, { featureId, role: 'side', entityId: lines[(i + 1) % lines.length]! }] }));

      // Fond : 40,7 × 20,5, arêtes du dessous chanfreinées de 2 mm.
      let bottomLines: string[] = [];
      const skBottom = draw(XY(-28), 'Esquisse du fond', (p) => {
        const r = box(p, -30.35, 10.35, -10.25, 10.25);
        bottomLines = r.lines;
        return r.sketch;
      });
      const exBottom = add(makeExtrudeFeature(doc, part(), skBottom, 7), 'Fond');
      add(makeChamferFeature(doc, part(), sides(exBottom.id, bottomLines, 'start'), 2), 'Chanfrein du fond');
      // Dépouille : du fond (40,7 × 20,5) au boîtier central (40 × 19,8), Z −21 à −1.
      const draftLow = draw(XY(-21), 'Esquisse du pied de dépouille', (p) => box(p, -30.35, 10.35, -10.25, 10.25).sketch);
      const draftHigh = draw(XY(-1), 'Esquisse du haut de dépouille', (p) => box(p, -30, 10, -9.9, 9.9).sketch);
      const loft = makeLoftFeature(doc, part(), [draftLow, draftHigh]);
      add({ ...loft, params: { ...loft.params, ruled: true } }, 'Dépouille');
      // Boîtier central 40 × 20, jusqu'au couvercle.
      const skMiddle = draw(XY(-1), 'Esquisse du boîtier central', (p) => box(p, -30, 10, -10, 10).sketch);
      add(makeExtrudeFeature(doc, part(), skMiddle, 8.5), 'Boîtier central');

      // Pattes : 54 × 19 × 2,4, coins arrondis R 0,5.
      let tabLines: string[] = [];
      const skTabs = draw(XY(0), 'Esquisse des pattes', (p) => {
        const r = box(p, -37, 17, -9.5, 9.5);
        tabLines = r.lines;
        return r.sketch;
      });
      const exTabs = add(makeExtrudeFeature(doc, part(), skTabs, 2.4), 'Pattes');
      add(makeFilletFeature(doc, part(), verticals(exTabs.id, tabLines), 0.5), 'Coins des pattes');
      // Trous Ø 4 (entraxe 49 × 10), ouverts vers le bout par une fente de 2,4 aux bords arrondis.
      const holeXs = [-34.5, 14.5];
      const skHoles = draw(XY(0), 'Esquisse des trous de fixation', (p) => circles(p, holeXs.flatMap((x) => [-5, 5].map((y) => ({ x, y, r: 2 })))).sketch);
      add(makePocketFeature(doc, part(), skHoles, { kind: 'throughAll' }, 'reversed'), 'Trous de fixation');
      const slotLines: string[][] = [];
      const skSlots = draw(XY(0), 'Esquisse des fentes', (p) => {
        let q = p;
        for (const [x0, x1] of [
          [-38, -34.5],
          [14.5, 18],
        ] as const)
          for (const y of [-5, 5]) {
            const r = box(q, x0, x1, y - 1.2, y + 1.2);
            slotLines.push(r.lines);
            q = r.sketch;
          }
        return q;
      });
      const pkSlots = add(makePocketFeature(doc, part(), skSlots, { kind: 'throughAll' }, 'reversed'), 'Fentes des pattes');
      // Arêtes de l'entrée des fentes : les flancs de la fente (bas, haut) contre le bout de la patte (gauche : ligne 3, droite : ligne 1).
      const mouths: EdgeRef[] = slotLines.flatMap((lines, k) =>
        [lines[0]!, lines[2]!].map((l) => ({ faces: [{ featureId: pkSlots.id, role: 'side' as const, entityId: l }, { featureId: exTabs.id, role: 'side' as const, entityId: tabLines[k < 2 ? 3 : 1]! }] })),
      );
      add(makeFilletFeature(doc, part(), mouths, 0.5), 'Entrées des fentes');
      // Nervure sur chaque patte : 1 mm de large, de 3,6 mm de haut contre le boîtier à rien au bout.
      const skRibs = draw(XZ(-0.5), 'Esquisse des nervures', (p) => {
        let q = p;
        for (const sx of [-1, 1]) {
          const wall = sx > 0 ? 10 : -30;
          const tip = sx > 0 ? 17 : -37;
          const x0 = wall - sx * 0.3;
          q = polygon(q, [
            { x: x0, y: 2 },
            { x: tip, y: 2 },
            { x: tip, y: 2.4 },
            { x: x0, y: 3.6 + (0.3 * 1.2) / 7 },
          ]).sketch;
        }
        return q;
      });
      add(makeExtrudeFeature(doc, part(), skRibs, 1), 'Nervures des pattes');

      // Couvercle (inscrit à 0,5 mm du bord), tour Ø 20 du réducteur.
      const skCover = draw(XY(7.5), 'Esquisse du couvercle', (p) => box(p, -29.5, 9.5, -9.5, 9.5).sketch);
      add(makeExtrudeFeature(doc, part(), skCover, 0.5), 'Couvercle');
      const skTower = draw(XY(7.5), 'Esquisse de la tour', (p) => circles(p, [{ x: 0, y: 0, r: 10 }]).sketch);
      add(makeExtrudeFeature(doc, part(), skTower, 2.5), 'Tour du réducteur');
      // Bloc de l'étiquette : 18 de large, arrondi Ø 12 à l'arrière, partie haute jusqu'à Z 11.
      const skBlock = draw(XY(8), 'Esquisse du bloc', (p) => box(p, -24, -2, -9, 9).sketch);
      add(makeExtrudeFeature(doc, part(), skBlock, 2), 'Bloc');
      const skNose = draw(XY(8), 'Esquisse de l’arrondi du bloc', (p) => circles(p, [{ x: -20.5, y: 0, r: 6 }]).sketch);
      add(makeExtrudeFeature(doc, part(), skNose, 2), 'Arrondi du bloc');
      const skRaised = draw(XY(10), 'Esquisse du dessus du bloc', (p) => box(p, -24, -11, -9, 9).sketch);
      add(makeExtrudeFeature(doc, part(), skRaised, 1), 'Dessus du bloc');
      const skBoss = draw(XY(10), 'Esquisse du bossage', (p) => circles(p, [{ x: -10.6, y: 0, r: 2 }]).sketch);
      add(makeExtrudeFeature(doc, part(), skBoss, 0.8), 'Bossage du pignon');
      // Étiquette : logement de 0,2 mm, cadre et inscriptions en relief de 0,15 mm (lisibles depuis +X).
      const skLabel = draw(XY(11), 'Esquisse du logement de l’étiquette', (p) => box(p, -23, -12, -8, 8).sketch);
      add(makePocketFeature(doc, part(), skLabel, { kind: 'distance', distance: 0.2 }), 'Logement de l’étiquette');
      const skPrint = draw(XY(10.8), 'Esquisse de l’étiquette', (p) => {
        let q = box(box(p, -22.4, -13.8, -7.1, 7.1).sketch, -22.1, -14.1, -6.8, 6.8).sketch;
        // Chaque ligne fait 12,6 mm de large, centrée sur Y = 0.
        for (const [line, base] of [
          ['MG996R', -20.1],
          ['DIGI HI TORQUE', -21.55],
        ] as const) {
          const h = 12.6 / textWidth(line, 1);
          q = text(q, base, 6.3, line, h, -90);
        }
        return q;
      });
      add(makeExtrudeFeature(doc, part(), skPrint, 0.15), 'Étiquette');

      // Bagues Ø 13,2 et Ø 10,8, cannelure Ø 6 de 25 dents en V (fond Ø 5,4), taraudage M3.
      const skRing = draw(XY(10), 'Esquisse de la bague', (p) => circles(p, [{ x: 0, y: 0, r: 6.6 }]).sketch);
      add(makeExtrudeFeature(doc, part(), skRing, 1.5), 'Bague');
      const skCollar = draw(XY(11.5), 'Esquisse du collet', (p) => circles(p, [{ x: 0, y: 0, r: 5.4 }]).sketch);
      add(makeExtrudeFeature(doc, part(), skCollar, 0.5), 'Collet');
      const skSpline = draw(XY(12), 'Esquisse de la cannelure', (p) => circles(p, [{ x: 0, y: 0, r: 3 }]).sketch);
      add(makeExtrudeFeature(doc, part(), skSpline, 3.5), 'Cannelure');
      const flank = 0.21 / 0.29;
      const skGroove = draw(XY(15.5), 'Esquisse d’un creux de cannelure', (p) =>
        polygon(p, [
          { x: 2.7, y: 0 },
          { x: 3.3, y: 0.6 * flank },
          { x: 3.3, y: -0.6 * flank },
        ]).sketch,
      );
      const pkGroove = add(makePocketFeature(doc, part(), skGroove, { kind: 'distance', distance: 3.5 }), 'Creux de cannelure');
      const pattern = makePatternFeature(doc, part(), pkGroove.id, 'circular');
      add({ ...pattern, params: { ...pattern.params, axis: { kind: 'axis', axis: 'Z' }, count: 25, angle: 360 } }, 'Dents de la cannelure');
      const skTap = draw(XY(15.5), 'Esquisse du taraudage', (p) => circles(p, [{ x: 0, y: 0, r: 1.25 }]).sketch);
      add(makePocketFeature(doc, part(), skTap, { kind: 'distance', distance: 8 }), 'Taraudage M3');

      // Vis du fond : lamages Ø 4 × 1, têtes bombées Ø 3,2 (0,26 sous le fond), empreintes cruciformes.
      const screws = [-28.35, 8.35].flatMap((x) => [-8.25, 8.25].map((y) => ({ x, y })));
      const skBores = draw(XY(-28), 'Esquisse des lamages', (p) => circles(p, screws.map((c) => ({ ...c, r: 2 }))).sketch);
      add(makePocketFeature(doc, part(), skBores, { kind: 'distance', distance: 1 }, 'reversed'), 'Lamages');
      const heads = circleSketch(doc, partId, XY(-26.9), screws.map((c) => ({ ...c, r: 1.6 })), 'Esquisse des têtes de vis');
      doc = heads.doc;
      const exHeads = add(makeExtrudeFeature(doc, part(), heads.sketchId, 1.36, 'reversed'), 'Têtes de vis');
      add(makeFilletFeature(doc, part(), sides(exHeads.id, heads.circles, 'start'), 0.5), 'Bombé des têtes');
      for (const [w, h, label] of [
        [1.6, 0.35, 'longues'],
        [0.35, 1.6, 'courtes'],
      ] as const) {
        const sk = draw(XY(-28.26), `Esquisse des empreintes (branches ${label})`, (p) => {
          let q = p;
          for (const c of screws) q = rectangle(q, w, h, c.x, c.y).sketch;
          return q;
        });
        add(makePocketFeature(doc, part(), sk, { kind: 'distance', distance: 0.6 }, 'reversed'), `Empreintes (branches ${label})`);
      }

      // Passe-fil : collerette 7,4 × 4,6 × 0,8 puis corps effilé jusqu'à X 16 ; trois fils Ø 1,4.
      const zc = -22;
      const skFlange = draw(YZ(10.2), 'Esquisse de la collerette du passe-fil', (p) => rectangle(p, 7.4, 4.6, 0, zc).sketch);
      add(makeExtrudeFeature(doc, part(), skFlange, 0.8), 'Collerette du passe-fil');
      const bootProfile = (half: number, flat: number, h: number, cut: number) => [
        { x: -flat, y: zc - h },
        { x: flat, y: zc - h },
        { x: half, y: zc - h + cut },
        { x: half, y: zc + h - cut },
        { x: flat, y: zc + h },
        { x: -flat, y: zc + h },
        { x: -half, y: zc + h - cut },
        { x: -half, y: zc - h + cut },
      ];
      const bootRoot = draw(YZ(11), 'Esquisse du pied du passe-fil', (p) => polygon(p, bootProfile(3.61, 1.42, 1.9, 1.1)).sketch);
      const bootTip = draw(YZ(16), 'Esquisse du bout du passe-fil', (p) => polygon(p, bootProfile(2.81, 1.1, 1.5, 0.85)).sketch);
      add(makeLoftFeature(doc, part(), [bootRoot, bootTip]), 'Passe-fil');
      const skWires = draw(YZ(15.5), 'Esquisse des fils', (p) => circles(p, [-1.42, 0, 1.42].map((y) => ({ x: y, y: zc, r: 0.7 }))).sketch);
      add(makeExtrudeFeature(doc, part(), skWires, 7.1), 'Fils');
      return doc;
    },
  };
}

/** Micro-servo (SG90, MG90S) : tour Ø 11,8 et dôme du pignon voisin, cannelure 21 dents Ø 4,8, vis M2. */
const MICRO_SERVO: ServoSize = {
  body: [22.5, 12.2, 22.7],
  round: 0.6,
  seams: [4, 18.4],
  tabs: { length: 32.2, thickness: 2.5, z: 15.9 },
  holes: { d: 2.2, spanX: 27.6, spanY: 0, slot: 1 },
  rib: [1.2, 1.1, 2.4],
  output: { fromEnd: 6.1, tower: [11.8, 4], dome: [5.6, 6.2], spline: [4.8, 3.2, 21], screw: 1.6 },
  bottomScrews: { d: 1.6, inset: 1.6 },
  cable: { boot: [5, 2.6, 1.5], ribbon: [3, 0.9, 12] },
};

/**
 * Palonnier disque en aluminium pour cannelure 25 dents (MG996R) : disque Ø 20 × 2, moyeu Ø 9,
 * hauteur totale 4,5, cannelure Ø 5,5 chanfreinée à 0,5 × 45°, trou de la vis M3 au centre,
 * 4 taraudages M3 à 14 mm d'entraxe. Axe sur Z, face de la cannelure (dessous du moyeu) en Z = 0.
 */
function discHorn(): ComponentSpec {
  const D = 20;
  const disc = 2;
  const hub = 9;
  const H = 4.5;
  const bore = 5.5;
  const spline = 3.5;
  const teeth = 25;
  const pitch = 14;
  return {
    collection: 'horns',
    id: 'disc-25t-20',
    name: 'Palonnier disque Ø 20 mm 25T',
    description: `Palonnier disque en aluminium pour servomoteur à cannelure ${teeth} dents (MG996R, MG995, DS3218) : disque Ø ${D} × ${disc} mm, moyeu Ø ${hub} mm, hauteur ${String(H).replace('.', ',')} mm, cannelure Ø ${String(bore).replace('.', ',')} mm, 4 taraudages M3 à ${pitch} mm d'entraxe, vis M3 au centre. Repère : axe sur Z, face de la cannelure en Z = 0.`,
    tags: ['palonnier', 'servo', 'servomoteur', '25T', 'MG996R', 'disque', 'M3'],
    dimensions: { D, e: disc, moyeu: hub, H, cannelure: bore, entraxe: pitch, dents: teeth },
    build: () => {
      let { doc, partId } = single('Palonnier disque Ø 20 25T', '#c3c9d1', 'aluminium');
      const part = () => findPart(doc, partId)!;
      const add = <T extends Parameters<typeof addFeature>[2]>(f: T, name: string): T => {
        const g = named(f, name);
        doc = addFeature(doc, partId, g);
        return g;
      };
      const draw = (support: SketchSupport, name: string, fn: (p: SketchParams) => SketchParams) => {
        const r = sketchOn(doc, partId, support, name, fn);
        doc = r.doc;
        return r.sketchId;
      };

      // Moyeu Ø 9, puis disque Ø 20 × 2 au-dessus.
      const skHub = circleSketch(doc, partId, XY(0), [{ x: 0, y: 0, r: hub / 2 }], 'Esquisse du moyeu');
      doc = skHub.doc;
      const exHub = add(makeExtrudeFeature(doc, part(), skHub.sketchId, H - disc), 'Moyeu');
      const skDisc = circleSketch(doc, partId, XY(H - disc), [{ x: 0, y: 0, r: D / 2 }], 'Esquisse du disque');
      doc = skDisc.doc;
      const exDisc = add(makeExtrudeFeature(doc, part(), skDisc.sketchId, disc), 'Disque');
      add(
        makeChamferFeature(doc, part(), [{ faces: [{ featureId: exDisc.id, role: 'side', entityId: skDisc.circles[0]! }, { featureId: exDisc.id, role: 'end' }] }], 0.3),
        'Chanfrein du disque',
      );

      // Cannelure : alésage Ø 5,5 sur 3,5 mm, chanfrein d'entrée 0,5 × 45°, 25 creux en V.
      const skBore = circleSketch(doc, partId, XY(0), [{ x: 0, y: 0, r: bore / 2 }], 'Esquisse de la cannelure');
      doc = skBore.doc;
      const pkBore = add(makePocketFeature(doc, part(), skBore.sketchId, { kind: 'distance', distance: spline }, 'reversed'), 'Cannelure');
      add(
        makeChamferFeature(doc, part(), [{ faces: [{ featureId: pkBore.id, role: 'side', entityId: skBore.circles[0]! }, { featureId: exHub.id, role: 'start' }] }], 0.5),
        'Chanfrein de la cannelure',
      );
      const skGroove = draw(XY(0), 'Esquisse d’un creux de cannelure', (p) =>
        polygon(p, [
          { x: bore / 2 + 0.3, y: 0 },
          { x: bore / 2 - 0.15, y: 0.45 },
          { x: bore / 2 - 0.15, y: -0.45 },
        ]).sketch,
      );
      const pkGroove = add(makePocketFeature(doc, part(), skGroove, { kind: 'distance', distance: spline }, 'reversed'), 'Creux de cannelure');
      const pattern = makePatternFeature(doc, part(), pkGroove.id, 'circular');
      add({ ...pattern, params: { ...pattern.params, axis: { kind: 'axis', axis: 'Z' }, count: teeth, angle: 360 } }, 'Dents de la cannelure');

      // Passage de la vis M3 au centre, 4 taraudages M3 (perçage Ø 2,5) dans le disque.
      const skScrew = draw(XY(H), 'Esquisse du passage de vis', (p) => circles(p, [{ x: 0, y: 0, r: 1.6 }]).sketch);
      add(makePocketFeature(doc, part(), skScrew, { kind: 'distance', distance: H - spline + 0.5 }), 'Passage de vis');
      const skTaps = draw(XY(H), 'Esquisse des taraudages', (p) =>
        circles(
          p,
          [0, 1, 2, 3].map((k) => ({ x: (pitch / 2) * Math.cos((k * Math.PI) / 2), y: (pitch / 2) * Math.sin((k * Math.PI) / 2), r: 1.25 })),
        ).sketch,
      );
      add(makePocketFeature(doc, part(), skTaps, { kind: 'throughAll' }), 'Taraudages M3');
      return doc;
    },
  };
}

export const COMPONENTS: ComponentSpec[] = [
  bearing('625', 5, 16, 5),
  bearing('608', 8, 22, 7),
  bearing('6800', 10, 19, 5),
  bearing('6001', 12, 28, 8),
  bearing('MF83', 3, 8, 3, { designation: 'MF83ZZ', flange: [9.2, 0.6] }),
  nema17(34),
  nema17(40),
  nema17(48),
  gt2(16),
  gt2(20),
  gt2(36),
  coupler(5, 5),
  coupler(5, 8),
  mg996r(),
  servo('sg90', 'SG90', MICRO_SERVO, '#3d7fd6', 9, 'Micro-servo, pignons plastique, couple ≈ 0,18 N·m sous 4,8 V.'),
  servo('mg90s', 'MG90S', MICRO_SERVO, '#737b87', 13.4, 'Micro-servo, pignons métal, couple ≈ 0,22 N·m sous 4,8 V.'),
  discHorn(),
];
