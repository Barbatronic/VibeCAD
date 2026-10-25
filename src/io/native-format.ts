/**
 * Format natif `.vibecad` : JSON UTF-8 ouvert, documenté (docs/format-natif.md) et versionné.
 *
 * Le fichier contient le modèle métier complet (pièces, esquisses, contraintes, paramètres,
 * dépendances, unités, noms) et les ressources géométriques des imports (STEP embarqués).
 * Aucun objet du noyau n'est sérialisé : la géométrie est reconstruite à l'ouverture.
 */
import { PART_MATERIALS } from '../domain/part-material';
import type {
  AssemblyContext,
  SketchReference,
  SubAssembly,
  MirrorPlane,
  JointCoupling,
  Assembly,
  AssemblyFastener,
  FabricationSettings,
  SimulationSettings,
  ProjectParameter,
  StudyFace,
  AssemblyInstance,
  AssemblyJoint,
  CadDocument,
  LcsRef,
  EdgeRef,
  FaceRef,
  Feature,
  LaserMaterial,
  PatternAxis,
  Part,
  Resource,
  SketchConstraint,
  SketchEntity,
  SketchParams,
  SketchSupport,
} from '../domain/model';
import { PARAMETER_NAME } from '../domain/units';
import { designation, FASTENER_TYPES, fastenerType, lengthsOf, METRIC_SIZES, sizesOf } from '../domain/fasteners';
import { ASSEMBLY_STUDY, constraintReferences, ORIGIN_POINT_ID } from '../domain/model';
import { featureDependencies } from '../features/registry';
import { closedDocument, subassemblyContains } from '../domain/subassemblies';
import { APP_NAME, APP_VERSION } from '../meta';

export const FORMAT_ID = 'vibecad';
export const SCHEMA_VERSION = 1;
export const NATIVE_EXTENSION = '.vibecad';
export const NATIVE_MIME = 'application/vnd.vibecad+json';

export interface NativeFile {
  format: typeof FORMAT_ID;
  schemaVersion: number;
  generator: { name: string; version: string };
  savedAt: string;
  document: SerializedDocument;
}

type SerializedFeature = Feature & { dependsOn: string[] };
type SerializedPart = Omit<Part, 'features'> & { features: SerializedFeature[] };
type SerializedDocument = Omit<CadDocument, 'parts'> & { parts: SerializedPart[] };

export function serializeDocument(docIn: CadDocument, savedAt = new Date().toISOString()): string {
  // Toujours enregistré « refermé » : l'assemblage principal à sa place.
  const doc = closedDocument(docIn);
  const file: NativeFile = {
    format: FORMAT_ID,
    schemaVersion: SCHEMA_VERSION,
    generator: { name: APP_NAME, version: APP_VERSION },
    savedAt,
    document: {
      id: doc.id,
      name: doc.name,
      units: doc.units,
      createdAt: doc.createdAt,
      modifiedAt: doc.modifiedAt,
      parts: doc.parts.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        visible: p.visible,
        ...(p.material ? { material: p.material } : {}),
        features: p.features.map((f) => ({ ...f, dependsOn: featureDependencies(f) })),
      })),
      resources: doc.resources,
      ...(doc.assembly ? { assembly: doc.assembly } : {}),
      ...(doc.subassemblies?.length ? { subassemblies: doc.subassemblies } : {}),
      ...(doc.fabrication ? { fabrication: doc.fabrication } : {}),
      ...(doc.parameters?.length ? { parameters: doc.parameters } : {}),
      ...(doc.simulation ? { simulation: doc.simulation } : {}),
    },
  };
  return JSON.stringify(file, null, 2);
}

export type ParseOutcome =
  | { ok: true; doc: CadDocument; warnings: string[]; migratedFrom: number | null; savedAt: string | null }
  | { ok: false; error: string; details: string[] };

/** Migration explicite d'un document brut de la version `n` vers `n + 1`. */
export type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/** Table des migrations : clé = version de départ. Aucune pour l'instant (version 1). */
export const MIGRATIONS: Record<number, Migration> = {};

export function parseNativeFile(text: string, migrations: Record<number, Migration> = MIGRATIONS, currentVersion = SCHEMA_VERSION): ParseOutcome {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "Ce fichier n’est pas un projet lisible : son contenu n’est pas du JSON valide.", details: [] };
  }
  if (!isObject(raw) || raw.format !== FORMAT_ID) {
    return { ok: false, error: `Ce fichier n’est pas un projet ${APP_NAME}.`, details: [] };
  }
  const version = raw.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, error: 'La version du format de ce fichier est inconnue.', details: [] };
  }
  if (version > currentVersion) {
    return {
      ok: false,
      error: `Ce projet a été enregistré avec une version plus récente de ${APP_NAME} (format ${version}). Mettez l’application à jour pour l’ouvrir.`,
      details: [],
    };
  }
  let file: Record<string, unknown> = raw;
  for (let v = version; v < currentVersion; v++) {
    const migrate = migrations[v];
    if (!migrate) return { ok: false, error: `Aucune migration n’est disponible depuis le format ${v}.`, details: [] };
    file = { ...migrate(file), schemaVersion: v + 1 };
  }
  const v = new Validator();
  const doc = readDocument(v, file.document, 'document');
  if (v.errors.length > 0 || !doc) {
    return {
      ok: false,
      error: "Le projet est endommagé ou incomplet : il ne peut pas être ouvert sans risque d’erreur.",
      details: v.errors.slice(0, 20),
    };
  }
  checkReferences(v, doc);
  if (v.errors.length > 0) {
    return { ok: false, error: 'Le projet contient des références incohérentes entre ses étapes.', details: v.errors.slice(0, 20) };
  }
  return {
    ok: true,
    doc,
    warnings: v.warnings,
    migratedFrom: version < currentVersion ? version : null,
    savedAt: typeof file.savedAt === 'string' ? file.savedAt : null,
  };
}

// ---------------------------------------------------------------------------
// Validation structurelle

class Validator {
  errors: string[] = [];
  warnings: string[] = [];
  error(path: string, message: string) {
    this.errors.push(`${path} : ${message}`);
  }
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function str(v: Validator, o: Record<string, unknown>, key: string, path: string): string {
  const x = o[key];
  if (typeof x !== 'string') {
    v.error(`${path}.${key}`, 'texte attendu');
    return '';
  }
  return x;
}

function num(v: Validator, o: Record<string, unknown>, key: string, path: string, opts: { min?: number; max?: number; integer?: boolean } = {}): number {
  const x = o[key];
  if (typeof x !== 'number' || !Number.isFinite(x)) {
    v.error(`${path}.${key}`, 'nombre attendu');
    return 0;
  }
  if (opts.integer && !Number.isInteger(x)) v.error(`${path}.${key}`, 'nombre entier attendu');
  if (opts.min !== undefined && x < opts.min) v.error(`${path}.${key}`, `doit être ≥ ${opts.min}`);
  if (opts.max !== undefined && x > opts.max) v.error(`${path}.${key}`, `doit être ≤ ${opts.max}`);
  return x;
}

function bool(v: Validator, o: Record<string, unknown>, key: string, path: string, fallback?: boolean): boolean {
  const x = o[key];
  if (typeof x !== 'boolean') {
    if (fallback !== undefined && x === undefined) return fallback;
    v.error(`${path}.${key}`, 'booléen attendu');
    return false;
  }
  return x;
}

function oneOf<T extends string>(v: Validator, o: Record<string, unknown>, key: string, path: string, values: readonly T[]): T {
  const x = o[key];
  if (typeof x !== 'string' || !values.includes(x as T)) {
    v.error(`${path}.${key}`, `valeur attendue parmi ${values.join(', ')}`);
    return values[0]!;
  }
  return x as T;
}

function obj(v: Validator, x: unknown, path: string): Record<string, unknown> | null {
  if (!isObject(x)) {
    v.error(path, 'objet attendu');
    return null;
  }
  return x;
}

function arr(v: Validator, o: Record<string, unknown>, key: string, path: string): unknown[] {
  const x = o[key];
  if (!Array.isArray(x)) {
    v.error(`${path}.${key}`, 'liste attendue');
    return [];
  }
  return x;
}

/** Champs connus du document (schéma 1). */
const DOCUMENT_FIELDS = new Set(['id', 'name', 'units', 'createdAt', 'modifiedAt', 'parts', 'resources', 'assembly', 'subassemblies', 'fabrication', 'simulation', 'parameters']);

function readDocument(v: Validator, x: unknown, path: string): CadDocument | null {
  const o = obj(v, x, path);
  if (!o) return null;
  const units = o.units;
  if (units !== 'mm') v.error(`${path}.units`, 'seule l’unité « mm » est prise en charge');
  // Format gelé (schéma 1) : une version plus récente peut ajouter des champs facultatifs. Ils sont
  // ignorés ici, et seraient perdus au prochain enregistrement : on le dit.
  const unknown = Object.keys(o).filter((k) => !DOCUMENT_FIELDS.has(k));
  if (unknown.length) {
    v.warnings.push(`Ce projet vient d’une version plus récente de ${APP_NAME} : ces informations sont ignorées et seront perdues si vous l’enregistrez ici (${unknown.join(', ')}).`);
  }
  const parts = arr(v, o, 'parts', path).map((p, i) => readPart(v, p, `${path}.parts[${i}]`));
  const resourcesRaw = obj(v, o.resources ?? {}, `${path}.resources`) ?? {};
  const resources: Record<string, Resource> = {};
  for (const [id, r] of Object.entries(resourcesRaw)) {
    const res = readResource(v, r, `${path}.resources.${id}`);
    if (res) {
      if (res.id !== id) v.error(`${path}.resources.${id}.id`, 'identifiant différent de la clé');
      resources[id] = res;
    }
  }
  const doc: CadDocument = {
    id: str(v, o, 'id', path),
    name: str(v, o, 'name', path),
    units: 'mm',
    createdAt: str(v, o, 'createdAt', path),
    modifiedAt: str(v, o, 'modifiedAt', path),
    parts: parts.filter((p): p is Part => p !== null),
    resources,
  };
  if (o.fabrication !== undefined) {
    const fabrication = readFabrication(v, o.fabrication, `${path}.fabrication`, new Set(doc.parts.map((p) => p.id)));
    if (fabrication) doc.fabrication = fabrication;
  }
  if (o.parameters !== undefined) {
    const parameters: ProjectParameter[] = arr(v, o, 'parameters', path).map((raw, i) => {
      const pp = `${path}.parameters[${i}]`;
      const po = obj(v, raw, pp) ?? {};
      const name = str(v, po, 'name', pp);
      if (!PARAMETER_NAME.test(name)) v.error(`${pp}.name`, `nom de paramètre invalide : ${name}`);
      return { name, expression: str(v, po, 'expression', pp), ...(typeof po.comment === 'string' && po.comment ? { comment: po.comment } : {}) };
    });
    if (parameters.length) doc.parameters = parameters;
  }
  if (o.simulation !== undefined) {
    const simulation = readSimulation(v, o.simulation, `${path}.simulation`, new Set(doc.parts.map((p) => p.id)));
    if (simulation) doc.simulation = simulation;
  }
  // Sous-assemblages : identifiants connus d'abord (un bloc peut en insérer un autre).
  const subIds = new Set(
    (Array.isArray(o.subassemblies) ? o.subassemblies : []).flatMap((s) => (s && typeof s === 'object' && typeof (s as { id?: unknown }).id === 'string' ? [(s as { id: string }).id] : [])),
  );
  const partIdSet = new Set(doc.parts.map((p) => p.id));
  if (o.subassemblies !== undefined) {
    const subs: SubAssembly[] = [];
    arr(v, o, 'subassemblies', path).forEach((raw, i) => {
      const sp = `${path}.subassemblies[${i}]`;
      const so = obj(v, raw, sp);
      if (!so) return;
      const content = readAssembly(v, so, sp, partIdSet, subIds) ?? { instances: [], joints: [] };
      subs.push({ ...content, id: str(v, so, 'id', sp), name: str(v, so, 'name', sp) });
    });
    if (subs.length) doc.subassemblies = subs;
    // Un bloc ne peut pas se contenir lui-même (directement ou par d'autres blocs).
    for (const s of subs) {
      if (s.instances.some((i) => i.subassemblyId && subassemblyContains(doc, i.subassemblyId, s.id))) v.error(`${path}.subassemblies`, `« ${s.name} » se contient lui-même`);
    }
  }
  if (o.assembly !== undefined) {
    const assembly = readAssembly(v, o.assembly, `${path}.assembly`, partIdSet, subIds);
    if (assembly) doc.assembly = assembly;
  }
  return doc;
}

function readFabrication(v: Validator, x: unknown, path: string, partIds: ReadonlySet<string>): FabricationSettings | null {
  const o = obj(v, x, path);
  if (!o) return null;
  const pr = obj(v, o.print, `${path}.print`) ?? {};
  const la = obj(v, o.laser, `${path}.laser`) ?? {};
  const bed = obj(v, pr.bed, `${path}.print.bed`) ?? {};
  const face = (io: Record<string, unknown>, key: string, p: string) => (io[key] !== undefined ? { [key]: readFaceRef(v, io[key], `${p}.${key}`) } : {});
  return {
    print: {
      bed: { x: num(v, bed, 'x', `${path}.print.bed`, { min: 1 }), y: num(v, bed, 'y', `${path}.print.bed`, { min: 1 }), z: num(v, bed, 'z', `${path}.print.bed`, { min: 1 }) },
      spacing: num(v, pr, 'spacing', `${path}.print`, { min: 0 }),
      items: arr(v, pr, 'items', `${path}.print`)
        .map((raw, i) => {
          const ip = `${path}.print.items[${i}]`;
          const io = obj(v, raw, ip) ?? {};
          return { partId: str(v, io, 'partId', ip), copies: num(v, io, 'copies', ip, { min: 0, integer: true }), scale: num(v, io, 'scale', ip, { min: 0 }), ...face(io, 'downFace', ip) };
        })
        .filter((i) => partIds.has(i.partId)),
    },
    laser: readLaser(v, la, `${path}.laser`, partIds),
  };
}

const LOAD_DIRECTIONS = ['push', 'pull', '-z', '+z', '-x', '+x', '-y', '+y', 'custom'] as const;

function readSimulation(v: Validator, x: unknown, path: string, partIds: ReadonlySet<string>): SimulationSettings | null {
  const o = obj(v, x, path);
  if (!o) return null;
  const faces = (io: Record<string, unknown>, key: string, p: string) =>
    arr(v, io, key, p).map((f, i) => {
      const fp = `${p}.${key}[${i}]`;
      const ref: StudyFace = readFaceRef(v, f, fp);
      const fo = obj(v, f, fp);
      if (fo?.instanceId !== undefined) ref.instanceId = str(v, fo, 'instanceId', fp);
      return ref;
    });
  return {
    studies: arr(v, o, 'studies', path)
      .map((raw, i) => {
        const sp = `${path}.studies[${i}]`;
        const so = obj(v, raw, sp) ?? {};
        const lp = `${sp}.load`;
        const lo = obj(v, so.load, lp) ?? {};
        return {
          partId: str(v, so, 'partId', sp),
          materialId: str(v, so, 'materialId', sp),
          quality: oneOf(v, so, 'quality', sp, ['coarse', 'normal', 'fine'] as const),
          fixed: faces(so, 'fixed', sp),
          ...(so.keep !== undefined ? { keep: faces(so, 'keep', sp) } : {}),
          load: {
            faces: faces(lo, 'faces', lp),
            kind: oneOf(v, lo, 'kind', lp, ['mass', 'force'] as const),
            value: num(v, lo, 'value', lp, { min: 0 }),
            direction: oneOf(v, lo, 'direction', lp, LOAD_DIRECTIONS),
            ...(lo.vector !== undefined
              ? (() => {
                  const vo = obj(v, lo.vector, `${lp}.vector`) ?? {};
                  return { vector: { x: num(v, vo, 'x', `${lp}.vector`), y: num(v, vo, 'y', `${lp}.vector`), z: num(v, vo, 'z', `${lp}.vector`) } };
                })()
              : {}),
          },
        };
      })
      .filter((st) => st.partId === ASSEMBLY_STUDY || partIds.has(st.partId)),
  };
}

/** Réglages laser : matériaux (« pages ») ; un fichier antérieur à une seule plaque devient un matériau. */
function readLaser(v: Validator, la: Record<string, unknown>, path: string, partIds: ReadonlySet<string>): FabricationSettings['laser'] {
  const sheetOf = (o: Record<string, unknown>, p: string) => {
    const sheet = obj(v, o.sheet, `${p}.sheet`) ?? {};
    return { w: num(v, sheet, 'w', `${p}.sheet`, { min: 1 }), h: num(v, sheet, 'h', `${p}.sheet`, { min: 1 }) };
  };
  const materials: LaserMaterial[] = [];
  if (la.materials !== undefined) {
    arr(v, la, 'materials', path).forEach((raw, i) => {
      const mp = `${path}.materials[${i}]`;
      const mo = obj(v, raw, mp) ?? {};
      const id = str(v, mo, 'id', mp);
      if (materials.some((m) => m.id === id)) v.error(`${mp}.id`, `identifiant en double : ${id}`);
      const placements =
        mo.placements !== undefined
          ? arr(v, mo, 'placements', mp)
              .map((pr, k) => {
                const pp = `${mp}.placements[${k}]`;
                const po = obj(v, pr, pp) ?? {};
                return { partId: str(v, po, 'partId', pp), copy: num(v, po, 'copy', pp, { min: 0, integer: true }), sheet: num(v, po, 'sheet', pp, { min: 0, integer: true }), x: num(v, po, 'x', pp), y: num(v, po, 'y', pp), angle: num(v, po, 'angle', pp) };
              })
              .filter((pl) => partIds.has(pl.partId))
          : null;
      materials.push({ id, name: str(v, mo, 'name', mp), thickness: num(v, mo, 'thickness', mp, { min: 0 }), sheet: sheetOf(mo, mp), kerf: num(v, mo, 'kerf', mp, { min: 0 }), ...(placements ? { placements } : {}) });
    });
  } else {
    // Format des premières versions : une seule plaque, une seule épaisseur.
    const thickness = num(v, la, 'thickness', path, { min: 0 });
    materials.push({ id: 'mat-1', name: `Plaque ${String(thickness).replace('.', ',')} mm`, thickness, sheet: sheetOf(la, path), kerf: num(v, la, 'kerf', path, { min: 0 }) });
  }
  const materialIds = new Set(materials.map((m) => m.id));
  return {
    materials,
    spacing: num(v, la, 'spacing', path, { min: 0 }),
    ...(la.engraveNames === true ? { engraveNames: true } : {}),
    items: arr(v, la, 'items', path)
      .map((raw, i) => {
        const ip = `${path}.items[${i}]`;
        const io = obj(v, raw, ip) ?? {};
        const materialId = io.materialId !== undefined ? str(v, io, 'materialId', ip) : null;
        return {
          partId: str(v, io, 'partId', ip),
          copies: num(v, io, 'copies', ip, { min: 0, integer: true }),
          ...(io.face !== undefined ? { face: readFaceRef(v, io.face, `${ip}.face`) } : {}),
          ...(materialId && materialIds.has(materialId) ? { materialId } : {}),
        };
      })
      .filter((i) => partIds.has(i.partId)),
  };
}

function readEdgeRef(v: Validator, x: unknown, path: string): EdgeRef {
  const e = obj(v, x, path) ?? {};
  const faces = arr(v, e, 'faces', path);
  if (faces.length !== 2) v.error(`${path}.faces`, 'deux faces attendues');
  return { faces: [readFaceRef(v, faces[0], `${path}.faces[0]`), readFaceRef(v, faces[1], `${path}.faces[1]`)] };
}

function readLcs(v: Validator, x: unknown, path: string): LcsRef {
  const o = obj(v, x, path) ?? {};
  const kind = oneOf(v, o, 'kind', path, ['face', 'circle', 'edge', 'vertex', 'point'] as const);
  if (kind === 'point') return { kind, sketchId: str(v, o, 'sketchId', path), pointId: str(v, o, 'pointId', path) };
  if (kind === 'face') return { kind, face: readFaceRef(v, o.face, `${path}.face`) };
  if (kind === 'vertex') {
    const edges = arr(v, o, 'edges', path);
    if (edges.length !== 2) v.error(`${path}.edges`, 'deux arêtes attendues');
    return { kind, face: readFaceRef(v, o.face, `${path}.face`), edges: [readEdgeRef(v, edges[0], `${path}.edges[0]`), readEdgeRef(v, edges[1], `${path}.edges[1]`)] };
  }
  return { kind, edge: readEdgeRef(v, o.edge, `${path}.edge`) };
}

function readLimits(v: Validator, o: Record<string, unknown>, key: string, path: string): [number, number] | undefined {
  if (o[key] === undefined) return undefined;
  const a = Array.isArray(o[key]) ? (o[key] as unknown[]) : [];
  if (a.length !== 2 || a.some((x) => typeof x !== 'number' || !Number.isFinite(x))) {
    v.error(`${path}.${key}`, 'deux nombres attendus [min, max]');
    return undefined;
  }
  return [a[0] as number, a[1] as number];
}

function readAssembly(v: Validator, x: unknown, path: string, partIds: ReadonlySet<string>, subIds: ReadonlySet<string> = new Set()): Assembly | null {
  const o = obj(v, x, path);
  if (!o) return null;
  const instances: AssemblyInstance[] = [];
  arr(v, o, 'instances', path).forEach((raw, i) => {
    const ip = `${path}.instances[${i}]`;
    const io = obj(v, raw, ip);
    if (!io) return;
    const pos = obj(v, io.position, `${ip}.position`) ?? {};
    const subassemblyId = io.subassemblyId !== undefined ? str(v, io, 'subassemblyId', ip) : null;
    const instance: AssemblyInstance = {
      id: str(v, io, 'id', ip),
      partId: subassemblyId ? (typeof io.partId === 'string' ? io.partId : '') : str(v, io, 'partId', ip),
      ...(subassemblyId ? { subassemblyId } : {}),
      name: str(v, io, 'name', ip),
      position: { x: num(v, pos, 'x', `${ip}.position`), y: num(v, pos, 'y', `${ip}.position`), z: num(v, pos, 'z', `${ip}.position`) },
    };
    if (subassemblyId) {
      if (io.flexible === true) instance.flexible = true;
      if (io.jointValues !== undefined) {
        const jo = obj(v, io.jointValues, `${ip}.jointValues`) ?? {};
        const values: Record<string, { angle: number; offset: number }> = {};
        for (const [k, raw] of Object.entries(jo)) {
          const vo = obj(v, raw, `${ip}.jointValues.${k}`) ?? {};
          values[k] = { angle: num(v, vo, 'angle', `${ip}.jointValues.${k}`), offset: num(v, vo, 'offset', `${ip}.jointValues.${k}`) };
        }
        if (Object.keys(values).length) instance.jointValues = values;
      }
      if (!subIds.has(subassemblyId)) {
        v.warnings.push(`Assemblage : « ${instance.name} » vise un sous-assemblage absent ; il est retiré.`);
        return;
      }
      instances.push(instance);
      return;
    }
    if (!partIds.has(instance.partId)) {
      v.warnings.push(`Assemblage : « ${instance.name} » vise une pièce absente ; elle est retirée de l’assemblage.`);
      return;
    }
    instances.push(instance);
  });
  const ids = new Set(instances.map((i) => i.id));
  const joints: AssemblyJoint[] = [];
  arr(v, o, 'joints', path).forEach((raw, i) => {
    const jp = `${path}.joints[${i}]`;
    const jo = obj(v, raw, jp);
    if (!jo) return;
    const end = (key: 'moving' | 'base') => {
      const eo = obj(v, jo[key], `${jp}.${key}`) ?? {};
      const member = eo.member !== undefined ? arr(v, eo, 'member', `${jp}.${key}`).map((m, k) => str(v, { m }, 'm', `${jp}.${key}.member[${k}]`)) : null;
      return { instanceId: str(v, eo, 'instanceId', `${jp}.${key}`), ...(member?.length ? { member } : {}), lcs: readLcs(v, eo.lcs, `${jp}.${key}.lcs`) };
    };
    const joint: AssemblyJoint = {
      id: str(v, jo, 'id', jp),
      name: str(v, jo, 'name', jp),
      kind: oneOf(v, jo, 'kind', jp, ['fixed', 'revolute', 'slider', 'cylindrical', 'spherical'] as const),
      moving: end('moving'),
      base: end('base'),
      flip: jo.flip === true,
      angle: num(v, jo, 'angle', jp),
      offset: num(v, jo, 'offset', jp),
    };
    const angleLimits = readLimits(v, jo, 'angleLimits', jp);
    const offsetLimits = readLimits(v, jo, 'offsetLimits', jp);
    if (angleLimits) joint.angleLimits = angleLimits;
    if (offsetLimits) joint.offsetLimits = offsetLimits;
    for (const key of ['tilt', 'tiltDirection', 'tiltLimit'] as const) {
      if (jo[key] !== undefined) joint[key] = num(v, jo, key, jp, key === 'tiltLimit' ? { min: 0, max: 180 } : {});
    }
    if (!ids.has(joint.moving.instanceId) || !ids.has(joint.base.instanceId)) {
      v.warnings.push(`Assemblage : la liaison « ${joint.name} » vise une pièce retirée ; elle est supprimée.`);
      return;
    }
    joints.push(joint);
  });
  const assembly: Assembly = { instances, joints };
  if (o.fasteners !== undefined) {
    const fasteners: AssemblyFastener[] = [];
    arr(v, o, 'fasteners', path).forEach((raw, i) => {
      const fp = `${path}.fasteners[${i}]`;
      const fo = obj(v, raw, fp);
      if (!fo) return;
      const kind = oneOf(v, fo, 'kind', fp, FASTENER_TYPES.map((t) => t.kind));
      const size = oneOf(v, fo, 'size', fp, METRIC_SIZES);
      const at = obj(v, fo.at, `${fp}.at`) ?? {};
      const fastener: AssemblyFastener = { id: str(v, fo, 'id', fp), kind, size, at: { instanceId: str(v, at, 'instanceId', `${fp}.at`), edge: readEdgeRef(v, at.edge, `${fp}.at.edge`) } };
      if (fo.length !== undefined) fastener.length = num(v, fo, 'length', fp, { min: 0 });
      if (fo.flip === true) fastener.flip = true;
      // La norme fixe les tailles et les longueurs possibles.
      if (!sizesOf(kind).includes(size)) v.error(`${fp}.size`, `taille ${size} absente de la norme ${fastenerType(kind).standard}`);
      if (fastenerType(kind).screw && !lengthsOf(kind, size).includes(fastener.length ?? -1)) v.error(`${fp}.length`, `longueur non normalisée pour ${designation(kind, size)}`);
      if (!ids.has(fastener.at.instanceId)) {
        v.warnings.push(`Assemblage : « ${designation(kind, size, fastener.length)} » est posée sur une pièce retirée ; elle est supprimée.`);
        return;
      }
      fasteners.push(fastener);
    });
    if (fasteners.length) assembly.fasteners = fasteners;
  }
  if (o.couplings !== undefined) {
    const couplings: JointCoupling[] = [];
    const jointIds = new Set(joints.map((j) => j.id));
    arr(v, o, 'couplings', path).forEach((raw, i) => {
      const cp = `${path}.couplings[${i}]`;
      const co = obj(v, raw, cp);
      if (!co) return;
      const teeth = arr(v, co, 'teeth', cp);
      if (teeth.length !== 2) v.error(`${cp}.teeth`, 'deux nombres de dents attendus');
      const coupling: JointCoupling = {
        id: str(v, co, 'id', cp),
        name: str(v, co, 'name', cp),
        kind: oneOf(v, co, 'kind', cp, ['gear', 'rack'] as const),
        driver: str(v, co, 'driver', cp),
        driven: str(v, co, 'driven', cp),
        teeth: [num(v, { t: teeth[0] }, 't', `${cp}.teeth[0]`, { min: 1 }), num(v, { t: teeth[1] }, 't', `${cp}.teeth[1]`, { min: 1 })],
        pitchDiameter: num(v, co, 'pitchDiameter', cp, { min: 0 }),
        reversed: co.reversed === true,
        phase: num(v, co, 'phase', cp),
      };
      if (!jointIds.has(coupling.driver) || !jointIds.has(coupling.driven)) {
        v.warnings.push(`Assemblage : « ${coupling.name} » relie une liaison supprimée ; il est supprimé.`);
        return;
      }
      couplings.push(coupling);
    });
    if (couplings.length) assembly.couplings = couplings;
  }
  return assembly;
}

function readPart(v: Validator, x: unknown, path: string): Part | null {
  const o = obj(v, x, path);
  if (!o) return null;
  const color = str(v, o, 'color', path);
  if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) v.error(`${path}.color`, 'couleur #rrggbb attendue');
  const features = arr(v, o, 'features', path).map((f, i) => readFeature(v, f, `${path}.features[${i}]`));
  // Matière (facultative) : une valeur inconnue (version plus récente) est refusée clairement.
  let material: string | undefined;
  if (o.material !== undefined) {
    if (typeof o.material === 'string' && PART_MATERIALS.some((m) => m.id === o.material)) material = o.material;
    else v.error(`${path}.material`, `matière inconnue (attendu : ${PART_MATERIALS.map((m) => m.id).join(', ')})`);
  }
  return {
    id: str(v, o, 'id', path),
    name: str(v, o, 'name', path),
    color,
    visible: bool(v, o, 'visible', path, true),
    ...(material ? { material } : {}),
    features: features.filter((f): f is Feature => f !== null),
  };
}

const DIRECTIONS = ['default', 'reversed', 'symmetric', 'twoSides'] as const;

/** Étape, avec ses équations éventuelles (champs liés à des paramètres du projet). */
function readFeature(v: Validator, x: unknown, path: string): Feature | null {
  const feature = readFeatureBody(v, x, path);
  const o = isObject(x) ? x : null;
  if (!feature || !o || o.expressions === undefined) return feature;
  const raw = obj(v, o.expressions, `${path}.expressions`) ?? {};
  const expressions: Record<string, string> = {};
  for (const [k, e] of Object.entries(raw)) {
    if (typeof e === 'string' && e.trim()) expressions[k] = e;
    else v.error(`${path}.expressions.${k}`, 'équation attendue (texte)');
  }
  return Object.keys(expressions).length ? { ...feature, expressions } : feature;
}

function readFeatureBody(v: Validator, x: unknown, path: string): Feature | null {
  const o = obj(v, x, path);
  if (!o) return null;
  const id = str(v, o, 'id', path);
  const name = str(v, o, 'name', path);
  const type = oneOf(v, o, 'type', path, ['sketch', 'extrude', 'pocket', 'revolve', 'imported-solid', 'fillet', 'chamfer', 'pattern', 'mirror', 'primitive', 'shell', 'loft', 'sweep', 'split', 'draft', 'thicken', 'gear', 'move', 'hole', 'plane', 'axis', 'sheet', 'flange', 'fold', 'image'] as const);
  const p = obj(v, o.params, `${path}.params`);
  if (!p) return null;
  const pp = `${path}.params`;
  switch (type) {
    case 'sketch':
      return { id, name, type, visible: bool(v, o, 'visible', path, true), params: readSketchParams(v, p, pp) };
    case 'extrude':
      return {
        id,
        name,
        type,
        params: {
          sketchId: str(v, p, 'sketchId', pp),
          distance: num(v, p, 'distance', pp),
          direction: oneOf(v, p, 'direction', pp, DIRECTIONS),
          ...(p.upTo !== undefined ? { upTo: readFaceRef(v, p.upTo, `${pp}.upTo`) } : {}),
          ...(p.distance2 !== undefined ? { distance2: num(v, p, 'distance2', pp) } : {}),
        },
      };
    case 'revolve': {
      const a = obj(v, p.axis, `${pp}.axis`) ?? {};
      const kind = oneOf(v, a, 'kind', `${pp}.axis`, ['sketch-x', 'sketch-y', 'line'] as const);
      const axis = kind === 'line' ? { kind, lineId: str(v, a, 'lineId', `${pp}.axis`) } : { kind };
      return {
        id,
        name,
        type,
        params: {
          sketchId: str(v, p, 'sketchId', pp),
          axis,
          angle: num(v, p, 'angle', pp, { min: 0, max: 360 }),
          reversed: p.reversed === true,
          // Fichiers antérieurs : une révolution ajoutait toujours de la matière.
          operation: p.operation === undefined ? 'add' : oneOf(v, p, 'operation', pp, ['add', 'cut', 'common'] as const),
        },
      };
    }
    case 'sweep':
      return {
        id,
        name,
        type,
        params: { profileId: str(v, p, 'profileId', pp), pathId: str(v, p, 'pathId', pp), operation: oneOf(v, p, 'operation', pp, ['add', 'cut', 'common'] as const) },
      };
    case 'loft':
      return {
        id,
        name,
        type,
        params: {
          sketchIds: arr(v, p, 'sketchIds', pp).map((x, i) => {
            if (typeof x !== 'string') v.error(`${pp}.sketchIds[${i}]`, 'texte attendu');
            return String(x);
          }),
          ruled: p.ruled === true,
          operation: oneOf(v, p, 'operation', pp, ['add', 'cut', 'common'] as const),
        },
      };
    case 'shell':
      return {
        id,
        name,
        type,
        params: {
          open: arr(v, p, 'open', pp).map((f, i) => readFaceRef(v, f, `${pp}.open[${i}]`)),
          thickness: num(v, p, 'thickness', pp, { min: 0 }),
          outward: p.outward === true,
        },
      };
    case 'primitive': {
      const pos = obj(v, p.position, `${pp}.position`) ?? {};
      return {
        id,
        name,
        type,
        params: {
          shape: oneOf(v, p, 'shape', pp, ['box', 'cylinder', 'sphere', 'torus'] as const),
          position: { x: num(v, pos, 'x', `${pp}.position`), y: num(v, pos, 'y', `${pp}.position`), z: num(v, pos, 'z', `${pp}.position`) },
          width: num(v, p, 'width', pp, { min: 0 }),
          depth: num(v, p, 'depth', pp, { min: 0 }),
          height: num(v, p, 'height', pp, { min: 0 }),
          diameter: num(v, p, 'diameter', pp, { min: 0 }),
          thickness: num(v, p, 'thickness', pp, { min: 0 }),
          operation: oneOf(v, p, 'operation', pp, ['add', 'cut', 'common'] as const),
        },
      };
    }
    case 'axis': {
      const pos = obj(v, p.position, `${pp}.position`) ?? {};
      const kind = oneOf(v, p, 'kind', pp, ['line', 'edge'] as const);
      const edge = p.edge !== undefined ? readPatternAxis(v, { kind: 'edge', edge: p.edge }, `${pp}`) : null;
      return {
        id,
        name,
        type,
        params: {
          kind,
          position: { x: num(v, pos, 'x', `${pp}.position`), y: num(v, pos, 'y', `${pp}.position`), z: num(v, pos, 'z', `${pp}.position`) },
          direction: oneOf(v, p, 'direction', pp, ['X', 'Y', 'Z'] as const),
          ...(edge && edge.kind === 'edge' ? { edge: edge.edge } : {}),
        },
      };
    }
    case 'plane':
      return {
        id,
        name,
        type,
        params: { base: readPlaneRef(v, p.base, `${pp}.base`), offset: num(v, p, 'offset', pp), angle: num(v, p, 'angle', pp), hinge: readPatternAxis(v, p.hinge, `${pp}.hinge`) },
      };
    case 'hole':
      return {
        id,
        name,
        type,
        params: {
          sketchId: str(v, p, 'sketchId', pp),
          kind: oneOf(v, p, 'kind', pp, ['clearance', 'counterbore', 'countersink', 'tapped'] as const),
          size: oneOf(v, p, 'size', pp, [...METRIC_SIZES, 'custom'] as const),
          fit: oneOf(v, p, 'fit', pp, ['none', 'fine', 'medium', 'coarse', 'custom'] as const),
          through: bool(v, p, 'through', pp, true),
          depth: num(v, p, 'depth', pp),
          reversed: bool(v, p, 'reversed', pp, false),
          headDiameter: num(v, p, 'headDiameter', pp),
          headDepth: num(v, p, 'headDepth', pp),
          ...(p.diameter !== undefined ? { diameter: num(v, p, 'diameter', pp, { min: 0 }) } : {}),
          ...(p.clearance !== undefined ? { clearance: num(v, p, 'clearance', pp) } : {}),
          ...(p.thread !== undefined ? { thread: oneOf(v, p, 'thread', pp, ['tap', 'plastic'] as const) } : {}),
        },
      };
    case 'move': {
      const vec = (key: string) => {
        const o = obj(v, p[key], `${pp}.${key}`) ?? {};
        return { x: num(v, o, 'x', `${pp}.${key}`), y: num(v, o, 'y', `${pp}.${key}`), z: num(v, o, 'z', `${pp}.${key}`) };
      };
      return {
        id,
        name,
        type,
        params: { translation: vec('translation'), axis: oneOf(v, p, 'axis', pp, ['X', 'Y', 'Z'] as const), angle: num(v, p, 'angle', pp), center: vec('center'), copy: bool(v, p, 'copy', pp, false) },
      };
    }
    case 'gear': {
      const pos = obj(v, p.position, `${pp}.position`) ?? {};
      return {
        id,
        name,
        type,
        params: {
          kind: oneOf(v, p, 'kind', pp, ['spur', 'rack', 'pulley'] as const),
          module: num(v, p, 'module', pp, { min: 0 }),
          pressureAngle: num(v, p, 'pressureAngle', pp, { min: 0, max: 45 }),
          teeth: num(v, p, 'teeth', pp, { min: 1, integer: true }),
          belt: oneOf(v, p, 'belt', pp, ['GT2-2', 'GT2-3', 'GT2-5', 'T2.5', 'T5', 'T10'] as const),
          thickness: num(v, p, 'thickness', pp, { min: 0 }),
          bore: num(v, p, 'bore', pp, { min: 0 }),
          rackHeight: num(v, p, 'rackHeight', pp, { min: 0 }),
          flanges: bool(v, p, 'flanges', pp, false),
          position: { x: num(v, pos, 'x', `${pp}.position`), y: num(v, pos, 'y', `${pp}.position`), z: num(v, pos, 'z', `${pp}.position`) },
          operation: oneOf(v, p, 'operation', pp, ['add', 'cut', 'common'] as const),
        },
      };
    }
    case 'thicken':
      return { id, name, type, params: { distance: num(v, p, 'distance', pp), corners: oneOf(v, p, 'corners', pp, ['round', 'sharp'] as const) } };
    case 'draft': {
      return {
        id,
        name,
        type,
        params: {
          faces: arr(v, p, 'faces', pp).map((f, i) => readFaceRef(v, f, `${pp}.faces[${i}]`)),
          angle: num(v, p, 'angle', pp, { min: 0, max: 90 }),
          neutral: readPlaneRef(v, p.neutral, `${pp}.neutral`),
          reversed: p.reversed === true,
        },
      };
    }
    case 'split': {
      return {
        id,
        name,
        type,
        params: {
          plane: readPlaneRef(v, p.plane, `${pp}.plane`),
          offset: num(v, p, 'offset', pp),
          keep: oneOf(v, p, 'keep', pp, ['below', 'above', 'both'] as const),
          gap: num(v, p, 'gap', pp, { min: 0 }),
        },
      };
    }
    case 'mirror': {
      const src = obj(v, p.source, `${pp}.source`) ?? {};
      const srcKind = oneOf(v, src, 'kind', `${pp}.source`, ['part', 'feature'] as const);
      return {
        id,
        name,
        type,
        params: {
          source: srcKind === 'part' ? { kind: 'part' } : { kind: 'feature', featureId: str(v, src, 'featureId', `${pp}.source`) },
          plane: readPlaneRef(v, p.plane, `${pp}.plane`),
        },
      };
    }
    case 'pattern': {
      const second = p.second !== undefined ? obj(v, p.second, `${pp}.second`) : null;
      return {
        id,
        name,
        type,
        params: {
          sourceId: str(v, p, 'sourceId', pp),
          kind: oneOf(v, p, 'kind', pp, ['linear', 'circular'] as const),
          axis: readPatternAxis(v, p.axis, `${pp}.axis`),
          count: num(v, p, 'count', pp, { integer: true, min: 1 }),
          spacing: num(v, p, 'spacing', pp, { min: 0 }),
          angle: num(v, p, 'angle', pp, { min: 0, max: 360 }),
          reversed: p.reversed === true,
          ...(second
            ? {
                second: {
                  axis: readPatternAxis(v, second.axis, `${pp}.second.axis`),
                  count: num(v, second, 'count', `${pp}.second`, { integer: true, min: 1 }),
                  spacing: num(v, second, 'spacing', `${pp}.second`, { min: 0 }),
                  reversed: second.reversed === true,
                },
              }
            : {}),
        },
      };
    }
    case 'pocket': {
      const e = obj(v, p.extent, `${pp}.extent`);
      const kind = e ? oneOf(v, e, 'kind', `${pp}.extent`, ['distance', 'throughAll'] as const) : 'throughAll';
      const extent = kind === 'distance' && e ? { kind, distance: num(v, e, 'distance', `${pp}.extent`) } : ({ kind: 'throughAll' } as const);
      const e2 = p.extent2 !== undefined ? obj(v, p.extent2, `${pp}.extent2`) : null;
      const kind2 = e2 ? oneOf(v, e2, 'kind', `${pp}.extent2`, ['distance', 'throughAll'] as const) : null;
      const extent2 = !e2 ? null : kind2 === 'distance' ? { kind: kind2, distance: num(v, e2, 'distance', `${pp}.extent2`) } : ({ kind: 'throughAll' } as const);
      return {
        id,
        name,
        type,
        params: { sketchId: str(v, p, 'sketchId', pp), extent, direction: oneOf(v, p, 'direction', pp, DIRECTIONS), ...(extent2 ? { extent2 } : {}) },
      };
    }
    case 'imported-solid':
      return {
        id,
        name,
        type,
        params: { resourceId: str(v, p, 'resourceId', pp), solidIndex: num(v, p, 'solidIndex', pp, { min: 0, integer: true }) },
      };
    case 'image': {
      const px = obj(v, p.pixels, `${pp}.pixels`) ?? {};
      const c = obj(v, p.center, `${pp}.center`) ?? {};
      const persp = p.perspective !== undefined ? obj(v, p.perspective, `${pp}.perspective`) : null;
      const corners = persp ? arr(v, persp, 'corners', `${pp}.perspective`).map((q, i) => {
        const qo = obj(v, q, `${pp}.perspective.corners[${i}]`) ?? {};
        return { x: num(v, qo, 'x', `${pp}.perspective.corners[${i}]`), y: num(v, qo, 'y', `${pp}.perspective.corners[${i}]`) };
      }) : [];
      if (persp && corners.length !== 4) v.error(`${pp}.perspective.corners`, '4 coins attendus');
      return {
        id,
        name,
        type,
        visible: bool(v, o, 'visible', path, true),
        params: {
          resourceId: str(v, p, 'resourceId', pp),
          pixels: { w: num(v, px, 'w', `${pp}.pixels`, { min: 1 }), h: num(v, px, 'h', `${pp}.pixels`, { min: 1 }) },
          support: readSupport(v, p.support, `${pp}.support`),
          center: { x: num(v, c, 'x', `${pp}.center`), y: num(v, c, 'y', `${pp}.center`) },
          width: num(v, p, 'width', pp, { min: 0 }),
          rotation: num(v, p, 'rotation', pp),
          mirror: p.mirror === true,
          opacity: num(v, p, 'opacity', pp, { min: 0, max: 1 }),
          ...(persp && corners.length === 4 ? { perspective: { corners: corners as [typeof corners[0], typeof corners[0], typeof corners[0], typeof corners[0]], aspect: num(v, persp, 'aspect', `${pp}.perspective`, { min: 0 }) } } : {}),
        },
      };
    }
    case 'sheet':
      return {
        id,
        name,
        type,
        params: {
          sketchId: str(v, p, 'sketchId', pp),
          thickness: num(v, p, 'thickness', pp, { min: 0 }),
          materialId: str(v, p, 'materialId', pp),
          radius: num(v, p, 'radius', pp, { min: 0 }),
          reversed: p.reversed === true,
        },
      };
    case 'flange':
      return {
        id,
        name,
        type,
        params: {
          edges: readEdges(v, p, pp),
          length: num(v, p, 'length', pp, { min: 0 }),
          angle: num(v, p, 'angle', pp, { min: 0, max: 180 }),
          direction: oneOf(v, p, 'direction', pp, ['up', 'down'] as const),
          ...(p.radius !== undefined ? { radius: num(v, p, 'radius', pp, { min: 0 }) } : {}),
        },
      };
    case 'fold':
      return {
        id,
        name,
        type,
        params: {
          sketchId: str(v, p, 'sketchId', pp),
          ...(p.lineId !== undefined ? { lineId: str(v, p, 'lineId', pp) } : {}),
          angle: num(v, p, 'angle', pp, { min: 0, max: 180 }),
          direction: oneOf(v, p, 'direction', pp, ['up', 'down'] as const),
          side: oneOf(v, p, 'side', pp, ['left', 'right'] as const),
          ...(p.radius !== undefined ? { radius: num(v, p, 'radius', pp, { min: 0 }) } : {}),
        },
      };
    case 'fillet':
      return { id, name, type, params: { edges: readEdges(v, p, pp), radius: num(v, p, 'radius', pp, { min: 0 }) } };
    case 'chamfer':
      return { id, name, type, params: { edges: readEdges(v, p, pp), distance: num(v, p, 'distance', pp, { min: 0 }) } };
  }
}

/** Plan désigné : plan d'origine, face plane ou plan de construction. */
function readPlaneRef(v: Validator, x: unknown, path: string): MirrorPlane {
  const pl = obj(v, x, path) ?? {};
  const kind = oneOf(v, pl, 'kind', path, ['plane', 'face', 'datum'] as const);
  if (kind === 'plane') return { kind, plane: oneOf(v, pl, 'plane', path, ['XY', 'XZ', 'YZ'] as const) };
  if (kind === 'datum') return { kind, featureId: str(v, pl, 'featureId', path) };
  return { kind: 'face', ref: readFaceRef(v, pl.ref, `${path}.ref`) };
}

function readPatternAxis(v: Validator, x: unknown, path: string): PatternAxis {
  const a = obj(v, x, path) ?? {};
  const kind = oneOf(v, a, 'kind', path, ['axis', 'edge', 'datum'] as const);
  if (kind === 'datum') return { kind, featureId: str(v, a, 'featureId', path) };
  if (kind === 'axis') return { kind, axis: oneOf(v, a, 'axis', path, ['X', 'Y', 'Z'] as const) };
  const e = obj(v, a.edge, `${path}.edge`) ?? {};
  const faces = arr(v, e, 'faces', `${path}.edge`);
  if (faces.length !== 2) v.error(`${path}.edge.faces`, 'deux faces attendues');
  return { kind, edge: { faces: [readFaceRef(v, faces[0], `${path}.edge.faces[0]`), readFaceRef(v, faces[1], `${path}.edge.faces[1]`)] } };
}

function readFaceRef(v: Validator, x: unknown, path: string): FaceRef {
  const r = obj(v, x, path) ?? {};
  const ref: FaceRef = {
    featureId: str(v, r, 'featureId', path),
    role: oneOf(v, r, 'role', path, ['start', 'end', 'side', 'imported', 'blend'] as const),
  };
  if (r.entityId !== undefined) ref.entityId = str(v, r, 'entityId', path);
  if (r.index !== undefined) ref.index = num(v, r, 'index', path, { integer: true, min: 0 });
  return ref;
}

function readEdges(v: Validator, p: Record<string, unknown>, path: string): EdgeRef[] {
  return arr(v, p, 'edges', path).map((e, i) => {
    const ep = `${path}.edges[${i}]`;
    const o = obj(v, e, ep) ?? {};
    const faces = arr(v, o, 'faces', ep);
    if (faces.length !== 2) v.error(`${ep}.faces`, 'deux faces attendues');
    return { faces: [readFaceRef(v, faces[0], `${ep}.faces[0]`), readFaceRef(v, faces[1], `${ep}.faces[1]`)] };
  });
}

/** Contexte d'assemblage d'une référence vers une autre pièce (facultatif). */
function readContext(v: Validator, o: Record<string, unknown>, path: string): { context?: AssemblyContext } {
  if (o.context === undefined) return {};
  const c = obj(v, o.context, `${path}.context`);
  if (!c) return {};
  const cp = `${path}.context`;
  const matrix = arr(v, c, 'matrix', cp);
  if (matrix.length !== 16 || !matrix.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    v.error(`${cp}.matrix`, 'matrice 4 × 4 attendue (16 nombres)');
    return {};
  }
  return { context: { instanceId: str(v, c, 'instanceId', cp), otherInstanceId: str(v, c, 'otherInstanceId', cp), matrix: matrix as number[], ...(c.frozen === true ? { frozen: true } : {}) } };
}

function readSupport(v: Validator, x: unknown, path: string): SketchSupport {
  const o = obj(v, x, path);
  if (!o) return { kind: 'plane', plane: 'XY', offset: 0 };
  const kind = oneOf(v, o, 'kind', path, ['plane', 'face', 'datum'] as const);
  if (kind === 'datum') return { kind, featureId: str(v, o, 'featureId', path) };
  if (kind === 'plane') {
    return { kind, plane: oneOf(v, o, 'plane', path, ['XY', 'XZ', 'YZ'] as const), offset: typeof o.offset === 'number' ? o.offset : 0 };
  }
  const r = obj(v, o.ref, `${path}.ref`);
  if (!r) return { kind: 'plane', plane: 'XY', offset: 0 };
  return { kind, ref: readFaceRef(v, r, `${path}.ref`), ...(o.partId !== undefined ? { partId: str(v, o, 'partId', path), ...readContext(v, o, path) } : {}) };
}

function readSketchParams(v: Validator, p: Record<string, unknown>, path: string): SketchParams {
  const support = readSupport(v, p.support, `${path}.support`);
  const entities: SketchEntity[] = [];
  arr(v, p, 'entities', path).forEach((e, i) => {
    const ep = `${path}.entities[${i}]`;
    const o = obj(v, e, ep);
    if (!o) return;
    const type = oneOf(v, o, 'type', ep, ['point', 'line', 'circle', 'arc', 'ellipse', 'spline'] as const);
    const id = str(v, o, 'id', ep);
    if (type === 'point') {
      entities.push({ id, type, x: num(v, o, 'x', ep), y: num(v, o, 'y', ep) });
      return;
    }
    const flags: { construction?: boolean; reference?: SketchReference } = {};
    if (o.construction === true) flags.construction = true;
    if (o.reference !== undefined) {
      const r = obj(v, o.reference, `${ep}.reference`);
      const faces = r ? arr(v, obj(v, r.edge, `${ep}.reference.edge`) ?? {}, 'faces', `${ep}.reference.edge`) : [];
      if (faces.length !== 2) v.error(`${ep}.reference.edge.faces`, 'deux faces attendues');
      else
        flags.reference = {
          edge: { faces: [readFaceRef(v, faces[0], `${ep}.reference.edge.faces[0]`), readFaceRef(v, faces[1], `${ep}.reference.edge.faces[1]`)] },
          ...(r?.partId !== undefined ? { partId: str(v, r, 'partId', `${ep}.reference`), ...readContext(v, r, `${ep}.reference`) } : {}),
        };
    }
    if (type === 'line') entities.push({ id, type, a: str(v, o, 'a', ep), b: str(v, o, 'b', ep), ...flags });
    else if (type === 'arc') entities.push({ id, type, center: str(v, o, 'center', ep), start: str(v, o, 'start', ep), end: str(v, o, 'end', ep), ...flags });
    else if (type === 'ellipse') entities.push({ id, type, center: str(v, o, 'center', ep), major: str(v, o, 'major', ep), minorRadius: num(v, o, 'minorRadius', ep, { min: 0 }), ...flags });
    else if (type === 'spline') {
      const pts = arr(v, o, 'points', ep).map((x, k) => (typeof x === 'string' ? x : (v.error(`${ep}.points[${k}]`, 'identifiant de point attendu'), '')));
      if (pts.length < 2) v.error(`${ep}.points`, 'au moins deux points');
      entities.push({ id, type, points: pts, closed: o.closed === true, ...flags });
    }
    else entities.push({ id, type, center: str(v, o, 'center', ep), radius: num(v, o, 'radius', ep, { min: 0 }), ...flags });
  });
  const constraints: SketchConstraint[] = [];
  arr(v, p, 'constraints', path).forEach((c, i) => {
    const cp = `${path}.constraints[${i}]`;
    const o = obj(v, c, cp);
    if (!o) return;
    const id = str(v, o, 'id', cp);
    const type = oneOf(v, o, 'type', cp, [
      'coincident',
      'horizontal',
      'vertical',
      'length',
      'distance',
      'distanceX',
      'distanceY',
      'diameter',
      'radius',
      'parallel',
      'perpendicular',
      'collinear',
      'equal',
      'tangent',
      'pointOn',
      'midpoint',
      'angle',
      'pointLineDistance',
    ] as const);
    const offset = {
      ...(typeof o.expression === 'string' && o.expression.trim() ? { expression: o.expression } : {}),
      ...(typeof o.offset === 'number' && Number.isFinite(o.offset) ? { offset: o.offset } : {}),
      ...(typeof o.labelAngle === 'number' && Number.isFinite(o.labelAngle) ? { labelAngle: o.labelAngle } : {}),
    };
    switch (type) {
      case 'coincident':
        constraints.push({ id, type, a: str(v, o, 'a', cp), b: str(v, o, 'b', cp) });
        break;
      case 'horizontal':
      case 'vertical':
        constraints.push({ id, type, line: str(v, o, 'line', cp) });
        break;
      case 'length':
        constraints.push({ id, type, line: str(v, o, 'line', cp), value: num(v, o, 'value', cp, { min: 0 }), ...offset });
        break;
      case 'distance':
      case 'distanceX':
      case 'distanceY':
        constraints.push({ id, type, a: str(v, o, 'a', cp), b: str(v, o, 'b', cp), value: num(v, o, 'value', cp, { min: 0 }), ...offset });
        break;
      case 'diameter':
      case 'radius':
        constraints.push({ id, type, circle: str(v, o, 'circle', cp), value: num(v, o, 'value', cp, { min: 0 }), ...offset });
        break;
      case 'parallel':
      case 'perpendicular':
      case 'collinear':
      case 'equal':
        constraints.push({ id, type, a: str(v, o, 'a', cp), b: str(v, o, 'b', cp) });
        break;
      case 'tangent':
        constraints.push({ id, type, a: str(v, o, 'a', cp), b: str(v, o, 'b', cp), ...(o.internal === true ? { internal: true } : {}) });
        break;
      case 'pointOn':
        constraints.push({ id, type, point: str(v, o, 'point', cp), curve: str(v, o, 'curve', cp) });
        break;
      case 'midpoint':
        constraints.push({ id, type, point: str(v, o, 'point', cp), line: str(v, o, 'line', cp) });
        break;
      case 'angle':
        constraints.push({
          id,
          type,
          a: str(v, o, 'a', cp),
          b: str(v, o, 'b', cp),
          value: num(v, o, 'value', cp, { min: 0, max: 180 }),
          ...(o.supplementary === true ? { supplementary: true } : {}),
          ...offset,
        });
        break;
      case 'pointLineDistance':
        constraints.push({ id, type, point: str(v, o, 'point', cp), line: str(v, o, 'line', cp), value: num(v, o, 'value', cp, { min: 0 }), ...offset });
        break;
    }
  });
  return { support, entities, constraints };
}

function readResource(v: Validator, x: unknown, path: string): Resource | null {
  const o = obj(v, x, path);
  if (!o) return null;
  const data = str(v, o, 'data', path);
  return {
    id: str(v, o, 'id', path),
    kind: oneOf(v, o, 'kind', path, ['step', 'stl', 'image'] as const),
    ...(o.mime !== undefined ? { mime: str(v, o, 'mime', path) } : {}),
    fileName: str(v, o, 'fileName', path),
    encoding: oneOf(v, o, 'encoding', path, ['utf8', 'base64'] as const),
    data,
    byteLength: num(v, o, 'byteLength', path, { min: 0, integer: true }),
    sha256: str(v, o, 'sha256', path),
    importedAt: str(v, o, 'importedAt', path),
  };
}

// ---------------------------------------------------------------------------
// Cohérence des références

function checkReferences(v: Validator, doc: CadDocument): void {
  const ids = new Set<string>();
  const unique = (id: string, path: string) => {
    if (ids.has(id)) v.error(path, `identifiant en double « ${id} »`);
    ids.add(id);
  };
  unique(doc.id, 'document.id');
  doc.parts.forEach((part, pi) => {
    unique(part.id, `document.parts[${pi}].id`);
    const seen = new Map<string, Feature>();
    part.features.forEach((f, fi) => {
      const path = `document.parts[${pi}].features[${fi}]`;
      unique(f.id, `${path}.id`);
      for (const dep of featureDependencies(f)) {
        const target = seen.get(dep);
        if (!target) {
          // Référence vers une étape absente ou placée après : récupérable (erreur affichée à l'étape).
          v.warnings.push(`${f.name} : l’étape référencée « ${dep} » est introuvable avant elle.`);
        } else if ((f.type === 'extrude' || f.type === 'pocket' || f.type === 'hole') && dep === f.params.sketchId && target.type !== 'sketch') {
          v.error(`${path}.params.sketchId`, 'doit désigner une esquisse');
        }
      }
      if (f.type === 'imported-solid' && !doc.resources[f.params.resourceId]) {
        v.warnings.push(`${f.name} : les données du fichier importé sont absentes.`);
      }
      if (f.type === 'image' && !doc.resources[f.params.resourceId]) {
        v.warnings.push(`${f.name} : les données de l’image sont absentes.`);
      }
      if (f.type === 'sketch') checkSketch(v, f.params, f.name, path);
      seen.set(f.id, f);
    });
  });
}

function checkSketch(v: Validator, sketch: SketchParams, name: string, path: string): void {
  const entityIds = new Set<string>();
  const points = new Set<string>([ORIGIN_POINT_ID]);
  sketch.entities.forEach((e, i) => {
    if (entityIds.has(e.id) || e.id === ORIGIN_POINT_ID) v.error(`${path}.params.entities[${i}].id`, `identifiant en double « ${e.id} »`);
    entityIds.add(e.id);
    if (e.type === 'point') points.add(e.id);
  });
  for (const e of sketch.entities) {
    if (e.type === 'line' && (!points.has(e.a) || !points.has(e.b))) v.error(`${path}.params`, `le segment « ${e.id} » vise un point absent`);
    if (e.type === 'circle' && !points.has(e.center)) v.error(`${path}.params`, `le cercle « ${e.id} » vise un centre absent`);
    if (e.type === 'arc' && (!points.has(e.center) || !points.has(e.start) || !points.has(e.end))) v.error(`${path}.params`, `l’arc « ${e.id} » vise un point absent`);
    if (e.type === 'ellipse' && (!points.has(e.center) || !points.has(e.major))) v.error(`${path}.params`, `l’ellipse « ${e.id} » vise un point absent`);
    if (e.type === 'spline' && e.points.some((id) => !points.has(id))) v.error(`${path}.params`, `la spline « ${e.id} » vise un point absent`);
  }
  const constraintIds = new Set<string>();
  for (const c of sketch.constraints) {
    if (constraintIds.has(c.id)) v.error(`${path}.params`, `contrainte en double « ${c.id} »`);
    constraintIds.add(c.id);
    const refs = constraintReferences(c);
    if (refs.some((r) => r !== ORIGIN_POINT_ID && !entityIds.has(r))) {
      v.warnings.push(`${name} : une contrainte vise un élément absent ; elle sera ignorée.`);
    }
  }
}
