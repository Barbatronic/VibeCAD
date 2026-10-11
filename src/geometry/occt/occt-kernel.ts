/**
 * Adaptateur Open CASCADE (WebAssembly) de l'interface `GeometryKernel`.
 *
 * Références persistantes : chaque face construite reçoit des étiquettes sémantiques
 * (`start`, `end`, `side` + élément d'esquisse, `imported` + rang). Elles sont propagées à
 * travers les opérations booléennes grâce à l'historique OCCT (`Modified`, `IsDeleted`), y
 * compris après la simplification des faces coplanaires (`SimplifyResult`).
 */
import type {
  BRepAlgoAPI_BooleanOperation,
  NCollection_List_TopoDS_Shape,
  OpenCascadeInstance,
  TopoDS_Edge,
  TopoDS_Face,
  TopoDS_Shape,
  TopoDS_Wire,
} from 'replicad-opencascadejs';
import type { EdgeRef, FaceRef, Id } from '../../domain/model';
import { frameToWorld, type Frame3D } from '../../math/frame';
import { add3, dot3, length3, scale3, sub3, type Vec3 } from '../../math/vec';
import type { ProfileLoop, ProfileRegion } from '../../sketch/profiles';
import {
  KernelError,
  type EdgeCurve,
  type BlendRequest,
  type BlendResult,
  type CurveKind,
  type DistanceResult,
  type EdgeMeshInfo,
  type CopyTag,
  type FaceMeshInfo,
  type FacePlaneLookup,
  type FaceTag,
  type GeometryKernel,
  type KernelShape,
  type MeshData,
  type MeshOptions,
  type LoftRequest,
  type SweepRequest,
  type PrimitiveRequest,
  type PrismRequest,
  type RevolveRequest,
  type ShapeAnalysis,
  type ShellRequest,
  type ShellResult,
  type StepExportItem,
  type StepReadResult,
  type SurfaceKind,
} from '../kernel';
import { Scope, withScope } from './scope';

const HASH_UPPER = 2147483647;
const PLANE_TOL = 1e-6;

interface TaggedFace {
  face: TopoDS_Face;
  hash: number;
  tags: FaceTag[];
}

class OcctShape implements KernelShape {
  readonly __kernelShape = true as const;
  disposed = false;
  constructor(
    readonly shape: TopoDS_Shape,
    readonly faces: TaggedFace[],
  ) {}
}

function asOcct(shape: KernelShape): OcctShape {
  if (!(shape instanceof OcctShape)) throw new KernelError('Forme inconnue du noyau Open CASCADE.');
  if (shape.disposed) throw new KernelError('Forme déjà libérée.');
  return shape;
}

export function sameFaceTag(a: FaceTag, b: FaceTag): boolean {
  return (
    a.featureId === b.featureId &&
    a.role === b.role &&
    (a.entityId ?? null) === (b.entityId ?? null) &&
    (a.index ?? null) === (b.index ?? null)
  );
}

/** Étiquette d'une face copiée (voir `CopyTag`). */
function copyTag(t: FaceTag, retag: CopyTag): FaceTag {
  if ('index' in retag) return { featureId: retag.featureId, role: t.role, ...(t.entityId !== undefined ? { entityId: t.entityId } : {}), index: retag.index };
  return { featureId: retag.featureId, role: t.role, entityId: `${t.featureId}/${t.entityId ?? ''}`, ...(t.index !== undefined ? { index: t.index } : {}) };
}

function addTags(target: FaceTag[], tags: readonly FaceTag[]): void {
  for (const t of tags) if (!target.some((x) => sameFaceTag(x, t))) target.push({ ...t });
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const v = m ? parseInt(m[1]!, 16) : 0x8899aa;
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

interface WasmExceptionApi {
  getExceptionMessage?: (ex: unknown) => [string, string];
  decrementExceptionRefcount?: (ex: unknown) => void;
}

function isWasmException(err: unknown): boolean {
  const ctor = (globalThis as { WebAssembly?: { Exception?: new (...args: never[]) => unknown } }).WebAssembly?.Exception;
  return !!ctor && err instanceof ctor;
}

export class OcctKernel implements GeometryKernel {
  private fileCounter = 0;
  /**
   * Vérificateur de validité réutilisé : un BRepCheck_Analyzer neuf par analyse ne rend pas toute
   * sa mémoire à la destruction dans cette build ; une instance réinitialisée reste stable.
   */
  private checker: { analyzer: { Init(s: TopoDS_Shape, geom?: boolean): void; IsValid(): boolean }; idle: TopoDS_Shape } | null = null;

  constructor(private readonly oc: OpenCascadeInstance) {}

  private isValid(shape: TopoDS_Shape): boolean {
    if (!this.checker) {
      const box = new this.oc.BRepPrimAPI_MakeBox(1, 1, 1);
      const idle = box.Shape();
      box.delete();
      this.checker = { analyzer: new this.oc.BRepCheck_Analyzer(idle, false, false, false), idle };
    }
    const { analyzer, idle } = this.checker;
    try {
      analyzer.Init(shape, true);
      return analyzer.IsValid();
    } finally {
      // Libère les références vers la forme analysée.
      analyzer.Init(idle, false);
    }
  }

  // -------------------------------------------------------------------------
  // Outils internes

  private guard<T>(label: string, fn: () => T): T {
    try {
      return fn();
    } catch (err) {
      throw this.toKernelError(label, err);
    }
  }

  private toKernelError(label: string, err: unknown): KernelError {
    if (err instanceof KernelError) return err;
    let detail = err instanceof Error ? err.message : String(err);
    if (isWasmException(err)) {
      const api = this.oc as unknown as WasmExceptionApi;
      try {
        const [type, message] = api.getExceptionMessage?.(err) ?? ['Exception', ''];
        detail = `${type}${message ? ` : ${message}` : ''}`;
      } catch {
        detail = 'Exception Open CASCADE';
      }
      try {
        api.decrementExceptionRefcount?.(err);
      } catch {
        // ignoré
      }
    }
    return new KernelError(`Échec du calcul géométrique (${label}).`, detail);
  }

  private pnt(scope: Scope, v: Vec3) {
    return scope.track(new this.oc.gp_Pnt(v.x, v.y, v.z));
  }

  private dir(scope: Scope, v: Vec3) {
    return scope.track(new this.oc.gp_Dir(v.x, v.y, v.z));
  }

  private vec(scope: Scope, v: Vec3) {
    return scope.track(new this.oc.gp_Vec(v.x, v.y, v.z));
  }

  private hash(shape: TopoDS_Shape): number {
    return this.oc.ReplicadShapeHasher.HashCode(shape, HASH_UPPER);
  }

  private explore(shape: TopoDS_Shape, kind: 'face' | 'edge' | 'solid'): TopoDS_Shape[] {
    const types = this.oc.TopAbs_ShapeEnum;
    const type = kind === 'face' ? types.TopAbs_FACE : kind === 'edge' ? types.TopAbs_EDGE : types.TopAbs_SOLID;
    const ex = new this.oc.TopExp_Explorer(shape, type, types.TopAbs_SHAPE);
    const out: TopoDS_Shape[] = [];
    try {
      for (; ex.More(); ex.Next()) out.push(ex.Current());
    } finally {
      ex.delete();
    }
    return out;
  }

  private taggedFaces(shape: TopoDS_Shape): TaggedFace[] {
    return this.explore(shape, 'face').map((s) => {
      const face = this.oc.TopoDS.Face(s);
      s.delete();
      return { face, hash: this.hash(face), tags: [] };
    });
  }

  /** Arêtes uniques dans l'ordre de première rencontre (même ordre que l'extracteur de maillage). */
  private uniqueEdges(shape: TopoDS_Shape): TopoDS_Edge[] {
    const buckets = new Map<number, TopoDS_Edge[]>();
    const out: TopoDS_Edge[] = [];
    for (const s of this.explore(shape, 'edge')) {
      const h = this.hash(s);
      const bucket = buckets.get(h) ?? [];
      if (bucket.some((e) => e.IsSame(s))) {
        s.delete();
        continue;
      }
      const edge = this.oc.TopoDS.Edge(s);
      s.delete();
      bucket.push(edge);
      buckets.set(h, bucket);
      out.push(edge);
    }
    return out;
  }

  private indexOfFace(faces: TaggedFace[], shape: TopoDS_Shape): number {
    const h = this.hash(shape);
    for (let i = 0; i < faces.length; i++) {
      const f = faces[i]!;
      if (f.hash === h && f.face.IsSame(shape)) return i;
    }
    return -1;
  }

  private listToArray(list: NCollection_List_TopoDS_Shape): TopoDS_Shape[] {
    const out: TopoDS_Shape[] = [];
    const copy = new this.oc.NCollection_List_TopoDS_Shape(list);
    try {
      while (!copy.IsEmpty()) {
        out.push(copy.First());
        copy.RemoveFirst();
      }
    } finally {
      copy.delete();
    }
    return out;
  }

  private buildWire(scope: Scope, loop: ProfileLoop, frame: Frame3D, level: number, allowOpen = false) {
    const oc = this.oc;
    const mw = scope.track(new oc.BRepBuilderAPI_MakeWire());
    const edges: { edge: TopoDS_Edge; entityId: string }[] = [];
    for (const seg of loop.segments) {
      let edge: TopoDS_Edge;
      if (seg.kind === 'line') {
        const me = scope.track(
          new oc.BRepBuilderAPI_MakeEdge(
            this.pnt(scope, frameToWorld(frame, seg.start, level)),
            this.pnt(scope, frameToWorld(frame, seg.end, level)),
          ),
        );
        if (!me.IsDone()) throw new KernelError('Un segment du contour est dégénéré.');
        edge = scope.track(me.Edge());
      } else if (seg.kind === 'arc') {
        // Arc : portion du cercle (axe selon le sens de parcours) entre les deux extrémités.
        const axis = seg.clockwise ? scale3(frame.normal, -1) : frame.normal;
        const ax2 = scope.track(
          new oc.gp_Ax2(this.pnt(scope, frameToWorld(frame, seg.center, level)), this.dir(scope, axis), this.dir(scope, frame.xAxis)),
        );
        const circ = scope.track(new oc.gp_Circ(ax2, seg.radius));
        const me = scope.track(
          new oc.BRepBuilderAPI_MakeEdge(circ, this.pnt(scope, frameToWorld(frame, seg.start, level)), this.pnt(scope, frameToWorld(frame, seg.end, level))),
        );
        if (!me.IsDone()) throw new KernelError('Un arc du contour est dégénéré.');
        edge = scope.track(me.Edge());
      } else {
        const axis = seg.clockwise ? scale3(frame.normal, -1) : frame.normal;
        const ax2 = scope.track(
          new oc.gp_Ax2(this.pnt(scope, frameToWorld(frame, seg.center, level)), this.dir(scope, axis), this.dir(scope, frame.xAxis)),
        );
        const circ = scope.track(new oc.gp_Circ(ax2, seg.radius));
        const me = scope.track(new oc.BRepBuilderAPI_MakeEdge(circ));
        if (!me.IsDone()) throw new KernelError('Un cercle du contour est dégénéré.');
        edge = scope.track(me.Edge());
      }
      mw.Add(edge);
      if (!mw.IsDone()) throw new KernelError('Le contour ne forme pas une boucle continue.');
      edges.push({ edge: scope.track(mw.Edge()), entityId: seg.entityId });
    }
    const wire: TopoDS_Wire = scope.track(mw.Wire());
    if (!wire.Closed() && !allowOpen) {
      // Les cercles sont fermés par construction ; un polygone doit l'être aussi.
      const closed = loop.segments.length === 1 && loop.segments[0]!.kind === 'circle';
      if (!closed) throw new KernelError("Le contour n’est pas fermé.");
    }
    return { wire, edges };
  }

  private buildFace(scope: Scope, region: ProfileRegion, frame: Frame3D, level: number) {
    const oc = this.oc;
    const origin = add3(frame.origin, scale3(frame.normal, level));
    const ax3 = scope.track(new oc.gp_Ax3(this.pnt(scope, origin), this.dir(scope, frame.normal), this.dir(scope, frame.xAxis)));
    const pln = scope.track(new oc.gp_Pln(ax3));
    const outer = this.buildWire(scope, region.outer, frame, level);
    const mf = scope.track(new oc.BRepBuilderAPI_MakeFace(pln, outer.wire, true));
    const edges = [...outer.edges];
    for (const hole of region.holes) {
      const h = this.buildWire(scope, hole, frame, level);
      mf.Add(h.wire);
      edges.push(...h.edges);
    }
    if (!mf.IsDone()) throw new KernelError('La face du profil ne peut pas être construite.');
    return { face: scope.track(mf.Face()), edges };
  }

  // -------------------------------------------------------------------------
  // Opérations

  makePrism(request: PrismRequest): KernelShape {
    if (!(request.to > request.from)) throw new KernelError("La longueur d’extrusion doit être positive.");
    if (request.regions.length === 0) throw new KernelError('Aucun profil à extruder.');
    const parts: OcctShape[] = [];
    try {
      for (const region of request.regions) {
        parts.push(this.guard('extrusion', () => withScope((scope) => this.prismOfRegion(scope, request, region))));
      }
      let result = parts[0]!;
      for (let i = 1; i < parts.length; i++) {
        const next = this.fuse(result, parts[i]!) as OcctShape;
        if (i > 1) this.dispose(result);
        result = next;
      }
      if (parts.length > 1) for (const p of parts) this.dispose(p);
      return result;
    } catch (err) {
      for (const p of parts) if (!p.disposed) this.dispose(p);
      throw err;
    }
  }

  makePrimitive(request: PrimitiveRequest): KernelShape {
    const oc = this.oc;
    const r = request;
    const positive = r.shape === 'box' ? [r.width, r.depth, r.height] : r.shape === 'cylinder' ? [r.diameter, r.height] : r.shape === 'sphere' ? [r.diameter] : [r.diameter, r.thickness];
    if (positive.some((v) => !(v > 0))) throw new KernelError('Les dimensions de la forme doivent être positives.');
    if (r.shape === 'torus' && r.thickness >= r.diameter) throw new KernelError('L’épaisseur de l’anneau doit être plus petite que son diamètre.');
    return this.guard('forme', () =>
      withScope((scope) => {
        // Construction à l'origine (constructeurs sans ambiguïté), puis déplacement.
        const maker =
          r.shape === 'box'
            ? scope.track(new oc.BRepPrimAPI_MakeBox(r.width, r.depth, r.height))
            : r.shape === 'cylinder'
              ? scope.track(new oc.BRepPrimAPI_MakeCylinder(r.diameter / 2, r.height))
              : r.shape === 'sphere'
                ? scope.track(new oc.BRepPrimAPI_MakeSphere(r.diameter / 2))
                : scope.track(new oc.BRepPrimAPI_MakeTorus(r.diameter / 2, r.thickness / 2));
        const trsf = scope.track(new oc.gp_Trsf());
        trsf.SetTranslation(this.vec(scope, r.position));
        const moved = scope.track(new oc.BRepBuilderAPI_Transform(maker.Shape(), trsf, true, false));
        const shape = moved.Shape();
        const faces = this.taggedFaces(shape);
        for (const f of faces) {
          const info = this.surfaceInfo(scope, f.face);
          let tag: FaceTag;
          if (info.plane && Math.abs(info.plane.normal.z) > 0.99) tag = { featureId: r.featureId, role: info.plane.normal.z < 0 ? 'start' : 'end' };
          else if (info.plane) {
            const n = info.plane.normal;
            tag = { featureId: r.featureId, role: 'side', entityId: Math.abs(n.x) > Math.abs(n.y) ? (n.x < 0 ? 'x-' : 'x+') : n.y < 0 ? 'y-' : 'y+' };
          } else tag = { featureId: r.featureId, role: 'side', entityId: r.shape === 'cylinder' ? 'wall' : 'surface' };
          addTags(f.tags, [tag]);
        }
        return new OcctShape(shape, faces);
      }),
    );
  }

  makeSweep(request: SweepRequest): KernelShape {
    const oc = this.oc;
    if (request.path.segments.length === 0) throw new KernelError('Le chemin du balayage est vide.');
    return this.guard('balayage', () =>
      withScope((scope) => {
        const spine = this.buildWire(scope, { segments: request.path.segments, signedArea: 0 }, request.path.frame, 0, true).wire;
        const { face, edges } = this.buildFace(scope, request.profile.region, request.profile.frame, 0);
        const pipe = scope.track(new oc.BRepOffsetAPI_MakePipe(spine, face));
        pipe.Build(scope.track(new oc.Message_ProgressRange()));
        if (!pipe.IsDone()) throw new KernelError('Le balayage n’a pas pu être construit : le profil est peut-être trop grand pour les virages du chemin.');
        const shape = pipe.Shape();
        const faces = this.taggedFaces(shape);
        const tagShape = (sh: TopoDS_Shape, tag: FaceTag) => {
          for (const f of this.explore(sh, 'face')) {
            const i = this.indexOfFace(faces, f);
            if (i >= 0) addTags(faces[i]!.tags, [tag]);
            f.delete();
          }
        };
        tagShape(scope.track(pipe.FirstShape()), { featureId: request.featureId, role: 'start' });
        tagShape(scope.track(pipe.LastShape()), { featureId: request.featureId, role: 'end' });
        // Faces latérales : engendrées par les arêtes du profil (élément d'esquisse du profil).
        for (const { edge, entityId } of edges) {
          for (const g of this.listToArray(scope.track(pipe.Generated(edge)))) {
            scope.track(g);
            tagShape(g, { featureId: request.featureId, role: 'side', entityId });
          }
        }
        faces.forEach((f, k) => {
          if (f.tags.length === 0) addTags(f.tags, [{ featureId: request.featureId, role: 'side', index: k }]);
        });
        return new OcctShape(shape, faces);
      }),
    );
  }

  makeLoft(request: LoftRequest): KernelShape {
    if (request.sections.length < 2) throw new KernelError('Un lissage demande au moins deux contours.');
    const oc = this.oc;
    return this.guard('lissage', () =>
      withScope((scope) => {
        const ts = scope.track(new oc.BRepOffsetAPI_ThruSections(true, request.ruled, 1e-6));
        let firstEdges: { edge: TopoDS_Edge; entityId: string }[] = [];
        request.sections.forEach((section, i) => {
          const { wire, edges } = this.buildWire(scope, section.loop, section.frame, 0);
          if (i === 0) firstEdges = edges;
          ts.AddWire(wire);
        });
        ts.Build(scope.track(new oc.Message_ProgressRange()));
        if (!ts.IsDone()) throw new KernelError('Le lissage n’a pas pu être construit avec ces contours.');
        const shape = ts.Shape();
        const faces = this.taggedFaces(shape);
        const tagShape = (s: TopoDS_Shape, tag: FaceTag) => {
          for (const f of this.explore(s, 'face')) {
            const i = this.indexOfFace(faces, f);
            if (i >= 0) addTags(faces[i]!.tags, [tag]);
            f.delete();
          }
        };
        tagShape(scope.track(ts.FirstShape()), { featureId: request.featureId, role: 'start' });
        tagShape(scope.track(ts.LastShape()), { featureId: request.featureId, role: 'end' });
        for (const { edge, entityId } of firstEdges) {
          const g = scope.track(ts.GeneratedFace(edge));
          if (!g.IsNull()) tagShape(g, { featureId: request.featureId, role: 'side', entityId });
        }
        faces.forEach((f, k) => {
          if (f.tags.length === 0) addTags(f.tags, [{ featureId: request.featureId, role: 'side', index: k }]);
        });
        return new OcctShape(shape, faces);
      }),
    );
  }

  makeRevolution(request: RevolveRequest): KernelShape {
    if (!(Math.abs(request.angle) > 1e-9)) throw new KernelError('L’angle de révolution doit être positif.');
    if (request.regions.length === 0) throw new KernelError('Aucun profil à faire tourner.');
    const parts: OcctShape[] = [];
    try {
      for (const region of request.regions) {
        parts.push(this.guard('révolution', () => withScope((scope) => this.revolveRegion(scope, request, region))));
      }
      let result = parts[0]!;
      for (let i = 1; i < parts.length; i++) {
        const next = this.fuse(result, parts[i]!) as OcctShape;
        if (i > 1) this.dispose(result);
        result = next;
      }
      if (parts.length > 1) for (const p of parts) this.dispose(p);
      return result;
    } catch (err) {
      for (const p of parts) if (!p.disposed) this.dispose(p);
      throw err;
    }
  }

  private revolveRegion(scope: Scope, request: RevolveRequest, region: ProfileRegion): OcctShape {
    const oc = this.oc;
    const { face, edges } = this.buildFace(scope, region, request.frame, 0);
    const origin = frameToWorld(request.frame, request.axisOrigin, 0);
    const tip = frameToWorld(request.frame, { x: request.axisOrigin.x + request.axisDirection.x, y: request.axisOrigin.y + request.axisDirection.y }, 0);
    const ax1 = scope.track(new oc.gp_Ax1(this.pnt(scope, origin), this.dir(scope, sub3(tip, origin))));
    const full = Math.abs(request.angle) >= Math.PI * 2 - 1e-9;
    const revol = scope.track(full ? new oc.BRepPrimAPI_MakeRevol(face, ax1, true) : new oc.BRepPrimAPI_MakeRevol(face, ax1, request.angle, true));
    if (!revol.IsDone()) throw new KernelError('La révolution n’a pas pu être construite.');
    const solid = revol.Shape();
    const faces = this.taggedFaces(solid);
    const tagFace = (s: TopoDS_Shape, tag: FaceTag) => {
      const i = this.indexOfFace(faces, s);
      if (i >= 0) addTags(faces[i]!.tags, [tag]);
    };
    if (!full) {
      tagFace(scope.track(revol.FirstShape()), { featureId: request.featureId, role: 'start' });
      tagFace(scope.track(revol.LastShape()), { featureId: request.featureId, role: 'end' });
    }
    for (const { edge, entityId } of edges) {
      for (const g of this.listToArray(scope.track(revol.Generated(edge)))) {
        scope.track(g);
        tagFace(g, { featureId: request.featureId, role: 'side', entityId });
      }
    }
    return new OcctShape(solid, faces);
  }

  private prismOfRegion(scope: Scope, request: PrismRequest, region: ProfileRegion): OcctShape {
    const oc = this.oc;
    const { face, edges } = this.buildFace(scope, region, request.frame, request.from);
    const v = scale3(request.frame.normal, request.to - request.from);
    const prism = scope.track(new oc.BRepPrimAPI_MakePrism(face, this.vec(scope, v), false, true));
    if (!prism.IsDone()) throw new KernelError("L’extrusion n’a pas pu être construite.");
    const solid = prism.Shape();
    const faces = this.taggedFaces(solid);
    const tagFace = (s: TopoDS_Shape, tag: FaceTag) => {
      const i = this.indexOfFace(faces, s);
      if (i >= 0) addTags(faces[i]!.tags, [tag]);
    };
    tagFace(scope.track(prism.FirstShape()), { featureId: request.featureId, role: 'start' });
    tagFace(scope.track(prism.LastShape()), { featureId: request.featureId, role: 'end' });
    for (const { edge, entityId } of edges) {
      const generated = this.listToArray(scope.track(prism.Generated(edge)));
      for (const g of generated) {
        scope.track(g);
        tagFace(g, { featureId: request.featureId, role: 'side', entityId });
      }
    }
    return new OcctShape(solid, faces);
  }

  fuse(base: KernelShape, tool: KernelShape): KernelShape {
    return this.boolean('fuse', base, tool);
  }

  common(a: KernelShape, b: KernelShape): KernelShape {
    return this.boolean('common', a, b);
  }

  cut(base: KernelShape, tool: KernelShape): KernelShape {
    return this.boolean('cut', base, tool);
  }

  private boolean(kind: 'fuse' | 'cut' | 'common', baseIn: KernelShape, toolIn: KernelShape): KernelShape {
    const a = asOcct(baseIn);
    const b = asOcct(toolIn);
    const oc = this.oc;
    return this.guard(kind === 'fuse' ? 'ajout de matière' : kind === 'cut' ? 'enlèvement de matière' : 'partie commune', () =>
      withScope((scope) => {
        // Constructeur vide + arguments + Build() : le constructeur « raccourci » (S1, S2, progression)
        // de cette build WASM ne libère pas toute sa mémoire (fuite mesurée, voir docs/performance.md).
        const op = scope.track(kind === 'fuse' ? new oc.BRepAlgoAPI_Fuse() : kind === 'cut' ? new oc.BRepAlgoAPI_Cut() : new oc.BRepAlgoAPI_Common());
        const args = scope.track(new oc.NCollection_List_TopoDS_Shape());
        args.Append(a.shape);
        const tools = scope.track(new oc.NCollection_List_TopoDS_Shape());
        tools.Append(b.shape);
        op.SetArguments(args);
        op.SetTools(tools);
        // Les solides d'entrée peuvent être réutilisés (cache, aperçus) : ils ne doivent pas être modifiés.
        op.SetNonDestructive(true);
        op.Build(scope.track(new oc.Message_ProgressRange()));
        try {
          return this.booleanResult(scope, op, [a, b]);
        } finally {
          // Le destructeur de cette build ne libère pas toutes les données internes : Clear() le fait
          // (sans cet appel, la mémoire WASM croît à chaque opération, voir docs/performance.md).
          op.Clear();
        }
      }),
    );
  }

  private booleanResult(scope: Scope, op: BRepAlgoAPI_BooleanOperation, inputs: OcctShape[]): OcctShape {
    if (op.HasErrors() || !op.IsDone()) throw new KernelError("L’opération booléenne a échoué.");
    // Fusionne les faces coplanaires adjacentes ; l'historique reste disponible.
    op.SimplifyResult(true, true, 1e-9);
    const result = op.Shape();
    const faces = this.taggedFaces(result);
    for (const input of inputs) {
      for (const tf of input.faces) {
        if (tf.tags.length === 0 || op.IsDeleted(tf.face)) continue;
        const modified = this.listToArray(scope.track(op.Modified(tf.face)));
        if (modified.length === 0) {
          const i = this.indexOfFace(faces, tf.face);
          if (i >= 0) addTags(faces[i]!.tags, tf.tags);
        } else {
          for (const m of modified) {
            scope.track(m);
            const i = this.indexOfFace(faces, m);
            if (i >= 0) addTags(faces[i]!.tags, tf.tags);
          }
        }
      }
    }
    return new OcctShape(result, faces);
  }

  readStep(data: Uint8Array): StepReadResult {
    const oc = this.oc;
    return this.guard('lecture STEP', () =>
      withScope((scope) => {
        const fileName = `/import-${++this.fileCounter}.step`;
        oc.FS.writeFile(fileName, data);
        try {
          oc.Interface_Static.SetCVal('xstep.cascade.unit', 'MM');
          const reader = scope.track(new oc.STEPControl_Reader());
          const status = reader.ReadFile(fileName);
          if (status !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
            throw new KernelError("Ce fichier n’est pas un fichier STEP lisible.");
          }
          reader.TransferRoots(scope.track(new oc.Message_ProgressRange()));
          const shape = scope.track(reader.OneShape());
          const solids = this.explore(shape, 'solid').map((s) => new OcctShape(s, this.taggedFaces(s)));
          if (solids.length === 0) {
            throw new KernelError('Le fichier STEP ne contient aucun solide fermé (seulement des surfaces ou des courbes).');
          }
          return { solids, productNames: [] };
        } finally {
          try {
            oc.FS.unlink(fileName);
          } catch {
            // ignoré
          }
        }
      }),
    );
  }

  tagImported(solid: KernelShape, featureId: Id): KernelShape {
    const src = asOcct(solid);
    return this.guard('solide importé', () => {
      const shape = src.shape.Oriented(src.shape.Orientation());
      const faces = this.taggedFaces(shape);
      faces.forEach((f, index) => addTags(f.tags, [{ featureId, role: 'imported', index }]));
      return new OcctShape(shape, faces);
    });
  }

  analyze(shapeIn: KernelShape): ShapeAnalysis {
    const { shape } = asOcct(shapeIn);
    const oc = this.oc;
    return this.guard('analyse', () =>
      withScope((scope) => {
        const vp = scope.track(new oc.GProp_GProps());
        oc.BRepGProp.VolumeProperties(shape, vp, false, false, false);
        const sp = scope.track(new oc.GProp_GProps());
        oc.BRepGProp.SurfaceProperties(shape, sp, false, false);
        const box = scope.track(new oc.Bnd_Box());
        oc.BRepBndLib.AddOptimal(shape, box, false, false);
        const bbox = box.IsVoid()
          ? null
          : {
              min: { x: box.GetXMin(), y: box.GetYMin(), z: box.GetZMin() },
              max: { x: box.GetXMax(), y: box.GetYMax(), z: box.GetZMax() },
            };
        const solids = this.explore(shape, 'solid');
        for (const s of solids) s.delete();
        const volume = vp.Mass();
        let centroid: Vec3 | null = null;
        if (volume > 1e-12) {
          const c = scope.track(vp.CentreOfMass());
          centroid = { x: c.X(), y: c.Y(), z: c.Z() };
        }
        return { volume, area: sp.Mass(), bbox, solidCount: solids.length, valid: this.isValid(shape), centroid };
      }),
    );
  }

  findFacePlane(shapeIn: KernelShape, ref: FaceRef): FacePlaneLookup {
    const src = asOcct(shapeIn);
    const matches = src.faces.filter((f) => f.tags.some((t) => sameFaceTag(t, ref)));
    if (matches.length === 0) return { status: 'lost' };
    return this.guard('recherche de face', () =>
      withScope((scope) => {
        const planes: { origin: Vec3; normal: Vec3 }[] = [];
        for (const m of matches) {
          const info = this.surfaceInfo(scope, m.face);
          if (info.surface !== 'plane' || !info.plane) return { status: 'not-planar' as const };
          planes.push(info.plane);
        }
        const first = planes[0]!;
        for (const p of planes.slice(1)) {
          const sameNormal = length3(sub3(p.normal, first.normal)) < PLANE_TOL;
          const samePlane = Math.abs(dot3(sub3(p.origin, first.origin), first.normal)) < PLANE_TOL;
          if (!sameNormal || !samePlane) return { status: 'ambiguous' as const };
        }
        // Repère de référence : point du plan le plus proche de l'origine du modèle.
        const d = dot3(first.origin, first.normal);
        return { status: 'found' as const, origin: scale3(first.normal, d), normal: first.normal, faceCount: planes.length };
      }),
    );
  }

  /** Arêtes communes aux faces désignées par une référence d'arête (vide si introuvable). */
  private edgesForRef(scope: Scope, shape: OcctShape, ref: EdgeRef): TopoDS_Edge[] {
    const facesA = shape.faces.filter((f) => f.tags.some((t) => sameFaceTag(t, ref.faces[0])));
    const facesB = shape.faces.filter((f) => f.tags.some((t) => sameFaceTag(t, ref.faces[1])));
    if (facesA.length === 0 || facesB.length === 0) return [];
    const edgesB = facesB.flatMap((f) => this.explore(f.face, 'edge').map((e) => scope.track(e)));
    const out: TopoDS_Edge[] = [];
    for (const fa of facesA) {
      for (const e of this.explore(fa.face, 'edge')) {
        scope.track(e);
        if (edgesB.some((b) => b.IsSame(e)) && !out.some((o) => o.IsSame(e))) out.push(scope.track(this.oc.TopoDS.Edge(e)));
      }
    }
    return out;
  }

  transformed(shapeIn: KernelShape, m: readonly number[], retag?: CopyTag): KernelShape {
    const base = asOcct(shapeIn);
    const oc = this.oc;
    return this.guard('placement', () =>
      withScope((scope) => {
        const trsf = scope.track(new oc.gp_Trsf());
        // gp_Trsf attend la matrice 3 × 4 par lignes.
        trsf.SetValues(m[0]!, m[4]!, m[8]!, m[12]!, m[1]!, m[5]!, m[9]!, m[13]!, m[2]!, m[6]!, m[10]!, m[14]!);
        return this.copyWith(scope, base, trsf, retag);
      }),
    );
  }

  mirrored(shapeIn: KernelShape, origin: Vec3, normal: Vec3, retag?: CopyTag): KernelShape {
    const base = asOcct(shapeIn);
    const oc = this.oc;
    return this.guard('symétrie', () =>
      withScope((scope) => {
        const trsf = scope.track(new oc.gp_Trsf());
        trsf.SetMirror(scope.track(new oc.gp_Ax2(this.pnt(scope, origin), this.dir(scope, normal))));
        return this.copyWith(scope, base, trsf, retag);
      }),
    );
  }

  /**
   * Copie transformée d'une forme. Avec `retag`, la copie garde la topologie de l'original, dans
   * le même ordre : chaque face copiée reçoit l'étiquette d'origine réécrite au nom de la copie.
   */
  private copyWith(scope: Scope, base: OcctShape, trsf: InstanceType<OpenCascadeInstance['gp_Trsf']>, retag?: CopyTag): OcctShape {
    const op = scope.track(new this.oc.BRepBuilderAPI_Transform(base.shape, trsf, true, false));
    if (!op.IsDone()) throw new KernelError('La copie n’a pas pu être placée.');
    const shape = op.Shape();
    const faces = this.taggedFaces(shape);
    if (retag) {
      const originals = this.explore(base.shape, 'face');
      originals.forEach((orig, i) => {
        const k = this.indexOfFace(base.faces, orig);
        const target = faces[i];
        if (k >= 0 && target) addTags(target.tags, base.faces[k]!.tags.map((t) => copyTag(t, retag)));
        orig.delete();
      });
    }
    return new OcctShape(shape, faces);
  }

  edgeCurves(shapeIn: KernelShape, ref: EdgeRef): EdgeCurve[] {
    const shape = asOcct(shapeIn);
    const oc = this.oc;
    return this.guard('lecture d’arête', () =>
      withScope((scope) =>
        this.edgesForRef(scope, shape, ref).map((edge): EdgeCurve => {
          const adaptor = scope.track(new oc.BRepAdaptor_Curve(edge));
          const type = adaptor.GetType();
          if (type === oc.GeomAbs_CurveType.GeomAbs_Line) {
            const p0 = scope.track(adaptor.Value(adaptor.FirstParameter()));
            const p1 = scope.track(adaptor.Value(adaptor.LastParameter()));
            return { kind: 'line', start: { x: p0.X(), y: p0.Y(), z: p0.Z() }, end: { x: p1.X(), y: p1.Y(), z: p1.Z() } };
          }
          if (type === oc.GeomAbs_CurveType.GeomAbs_Circle) {
            const circ = scope.track(adaptor.Circle());
            const loc = scope.track(circ.Location());
            const d = scope.track(scope.track(circ.Axis()).Direction());
            return { kind: 'circle', center: { x: loc.X(), y: loc.Y(), z: loc.Z() }, axis: { x: d.X(), y: d.Y(), z: d.Z() }, radius: circ.Radius() };
          }
          return { kind: 'other' };
        }),
      ),
    );
  }

  blend(baseIn: KernelShape, request: BlendRequest): BlendResult {
    const base = asOcct(baseIn);
    const oc = this.oc;
    try {
      return withScope((scope) => {
        const resolved = request.edges.map((ref) => this.edgesForRef(scope, base, ref));
        const missing = resolved.flatMap((edges, i) => (edges.length === 0 ? [i] : []));
        if (missing.length > 0) return { status: 'edges-lost', missing };
        const mk = scope.track(request.kind === 'fillet' ? new oc.BRepFilletAPI_MakeFillet(base.shape) : new oc.BRepFilletAPI_MakeChamfer(base.shape));
        const added: TopoDS_Edge[] = [];
        for (const edges of resolved) {
          for (const e of edges) {
            if (added.some((a) => a.IsSame(e))) continue;
            mk.Add(request.size, e);
            added.push(e);
          }
        }
        mk.Build(scope.track(new oc.Message_ProgressRange()));
        if (!mk.IsDone()) return { status: 'failed', detail: 'Construction impossible avec cette valeur.' };
        const result = mk.Shape();
        const faces = this.taggedFaces(result);
        for (const tf of base.faces) {
          if (tf.tags.length === 0 || mk.IsDeleted(tf.face)) continue;
          const modified = this.listToArray(scope.track(mk.Modified(tf.face)));
          if (modified.length === 0) {
            const i = this.indexOfFace(faces, tf.face);
            if (i >= 0) addTags(faces[i]!.tags, tf.tags);
          } else {
            for (const m of modified) {
              scope.track(m);
              const i = this.indexOfFace(faces, m);
              if (i >= 0) addTags(faces[i]!.tags, tf.tags);
            }
          }
        }
        resolved.forEach((edges, index) => {
          for (const e of edges) {
            for (const g of this.listToArray(scope.track(mk.Generated(e)))) {
              scope.track(g);
              const i = this.indexOfFace(faces, g);
              if (i >= 0) addTags(faces[i]!.tags, [{ featureId: request.featureId, role: 'blend', index }]);
            }
          }
        });
        return { status: 'ok', shape: new OcctShape(result, faces) };
      });
    } catch (err) {
      const e = this.toKernelError(request.kind === 'fillet' ? 'congé' : 'chanfrein', err);
      return { status: 'failed', detail: [e.message, e.detail].filter(Boolean).join(' — ') };
    }
  }

  shell(baseIn: KernelShape, request: ShellRequest): ShellResult {
    const base = asOcct(baseIn);
    const oc = this.oc;
    if (!(request.thickness > 0)) return { status: 'failed', detail: 'L’épaisseur doit être positive.' };
    try {
      return withScope((scope) => {
        const resolved = request.open.map((ref) => base.faces.filter((f) => f.tags.some((t) => sameFaceTag(t, ref))));
        const missing = resolved.flatMap((faces, i) => (faces.length === 0 ? [i] : []));
        if (missing.length > 0) return { status: 'faces-lost', missing };
        const list = scope.track(new oc.NCollection_List_TopoDS_Shape());
        const added: TaggedFace[] = [];
        for (const faces of resolved) for (const f of faces) if (!added.includes(f)) (added.push(f), list.Append(f.face));
        const mk = scope.track(new oc.BRepOffsetAPI_MakeThickSolid());
        // Jointures « intersection » : coins vifs (par défaut, le moteur les arrondit vers l'extérieur).
        mk.MakeThickSolidByJoin(
          base.shape,
          list,
          request.outward ? request.thickness : -request.thickness,
          1e-3,
          oc.BRepOffset_Mode.BRepOffset_Skin,
          false,
          false,
          oc.GeomAbs_JoinType.GeomAbs_Intersection,
        );
        if (!mk.IsDone()) return { status: 'failed', detail: 'Construction impossible avec cette épaisseur.' };
        if (added.length === 0) {
          // Sans face ouverte, le moteur rend le volume décalé (intérieur ou agrandi) : la pièce
          // creuse fermée s'obtient en le retirant de la pièce (ou la pièce du volume agrandi).
          const offset = mk.Shape();
          const offsetFaces = this.taggedFaces(offset);
          offsetFaces.forEach((f, index) => addTags(f.tags, [{ featureId: request.featureId, role: 'side', entityId: request.outward ? 'outer' : 'inner', index }]));
          const tool = new OcctShape(offset, offsetFaces);
          try {
            const closed = request.outward ? this.boolean('cut', tool, base) : this.boolean('cut', base, tool);
            return { status: 'ok', shape: closed };
          } finally {
            this.dispose(tool);
          }
        }
        const result = mk.Shape();
        const faces = this.taggedFaces(result);
        base.faces.forEach((tf, index) => {
          if (tf.tags.length === 0) return;
          // Faces d'origine conservées (ou modifiées) : mêmes étiquettes.
          if (!mk.IsDeleted(tf.face)) {
            const modified = this.listToArray(scope.track(mk.Modified(tf.face)));
            const targets = modified.length === 0 ? [tf.face] : modified.map((m) => scope.track(m));
            for (const m of targets) {
              const i = this.indexOfFace(faces, m);
              if (i >= 0) addTags(faces[i]!.tags, tf.tags);
            }
          }
          // Faces de la paroi intérieure, engendrées par le décalage de la face d'origine.
          for (const g of this.listToArray(scope.track(mk.Generated(tf.face)))) {
            scope.track(g);
            const i = this.indexOfFace(faces, g);
            if (i >= 0 && faces[i]!.tags.length === 0) addTags(faces[i]!.tags, [{ featureId: request.featureId, role: 'side', entityId: 'inner', index }]);
          }
        });
        // Faces restantes sans étiquette (jointures) : rattachées à la coque.
        faces.forEach((f, k) => {
          if (f.tags.length === 0) addTags(f.tags, [{ featureId: request.featureId, role: 'side', entityId: 'join', index: k }]);
        });
        return { status: 'ok', shape: new OcctShape(result, faces) };
      });
    } catch (err) {
      const e = this.toKernelError('coque', err);
      return { status: 'failed', detail: [e.message, e.detail].filter(Boolean).join(' — ') };
    }
  }

  private surfaceInfo(scope: Scope, face: TopoDS_Face): { surface: SurfaceKind; plane?: FaceMeshInfo['plane']; cylinder?: FaceMeshInfo['cylinder']; sphere?: FaceMeshInfo['sphere'] } {
    const oc = this.oc;
    const adaptor = scope.track(new oc.BRepAdaptor_Surface(face, true));
    const type = adaptor.GetType();
    const reversed = face.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED;
    const toVec = (p: { X(): number; Y(): number; Z(): number }) => ({ x: p.X(), y: p.Y(), z: p.Z() });
    if (type === oc.GeomAbs_SurfaceType.GeomAbs_Plane) {
      const pln = scope.track(adaptor.Plane());
      const loc = toVec(scope.track(pln.Location()));
      const axis = scope.track(pln.Axis());
      const n = toVec(scope.track(axis.Direction()));
      return { surface: 'plane', plane: { origin: loc, normal: reversed ? scale3(n, -1) : n } };
    }
    if (type === oc.GeomAbs_SurfaceType.GeomAbs_Cylinder) {
      const cyl = scope.track(adaptor.Cylinder());
      const axis = scope.track(cyl.Axis());
      return {
        surface: 'cylinder',
        cylinder: {
          origin: toVec(scope.track(axis.Location())),
          axis: toVec(scope.track(axis.Direction())),
          radius: cyl.Radius(),
        },
      };
    }
    if (type === oc.GeomAbs_SurfaceType.GeomAbs_Sphere) {
      const sph = scope.track(adaptor.Sphere());
      return { surface: 'sphere', sphere: { center: toVec(scope.track(sph.Location())), radius: sph.Radius() } };
    }
    const kinds: Record<string, SurfaceKind> = {
      GeomAbs_Cone: 'cone',
      GeomAbs_Torus: 'torus',
    };
    return { surface: kinds[type] ?? 'other' };
  }

  mesh(shapeIn: KernelShape, options: MeshOptions): MeshData {
    const src = asOcct(shapeIn);
    const oc = this.oc;
    return this.guard('maillage', () =>
      withScope((scope) => {
        const raw = scope.track(oc.ReplicadMeshExtractor.extract(src.shape, options.linearDeflection, options.angularDeflection, false));
        const vPtr = raw.getVerticesPtr();
        const vSize = raw.getVerticesSize();
        const nPtr = raw.getNormalsPtr();
        const nSize = raw.getNormalsSize();
        const tPtr = raw.getTrianglesPtr();
        const tSize = raw.getTrianglesSize();
        const gPtr = raw.getFaceGroupsPtr();
        const gSize = raw.getFaceGroupsSize();
        const buffer = oc.wasmMemory.buffer;
        const positions = new Float32Array(buffer, vPtr >>> 0, vSize).slice();
        const normals = new Float32Array(buffer, nPtr >>> 0, nSize).slice();
        const indices = new Uint32Array(buffer, tPtr >>> 0, tSize).slice();
        const groups = new Int32Array(buffer, gPtr >>> 0, gSize).slice();

        const faces: FaceMeshInfo[] = [];
        /** Rang de chaque face source (src.faces) dans le tableau `faces` du maillage. */
        const meshIndexOfFace = new Map<TaggedFace, number>();
        for (let g = 0; g < groups.length; g += 3) {
          const start = groups[g]!;
          const count = groups[g + 1]!;
          const faceHash = groups[g + 2]!;
          let tf = src.faces[g / 3];
          if (!tf || tf.hash !== faceHash) tf = src.faces.find((f) => f.hash === faceHash);
          if (!tf) continue;
          meshIndexOfFace.set(tf, faces.length);
          const info = this.surfaceInfo(scope, tf.face);
          const props = scope.track(new oc.GProp_GProps());
          oc.BRepGProp.SurfaceProperties(tf.face, props, false, false);
          faces.push({ start, count, tags: tf.tags.map((t) => ({ ...t })), area: props.Mass(), ...info });
        }

        const eraw = scope.track(oc.ReplicadEdgeMeshExtractor.extract(src.shape, options.linearDeflection, options.angularDeflection));
        const lPtr = eraw.getLinesPtr();
        const lSize = eraw.getLinesSize();
        const egPtr = eraw.getEdgeGroupsPtr();
        const egSize = eraw.getEdgeGroupsSize();
        const buffer2 = oc.wasmMemory.buffer;
        const edgePositions = new Float32Array(buffer2, lPtr >>> 0, lSize).slice();
        const edgeGroups = new Int32Array(buffer2, egPtr >>> 0, egSize).slice();
        const uniqueEdges = this.uniqueEdges(src.shape);
        for (const e of uniqueEdges) scope.track(e);
        const edgeByHash = new Map<number, TopoDS_Edge>();
        for (const e of uniqueEdges) edgeByHash.set(this.hash(e), e);
        const edges: EdgeMeshInfo[] = [];
        const meshIndexOfEdge = new Map<TopoDS_Edge, number>();
        for (let g = 0; g < edgeGroups.length; g += 3) {
          const start = edgeGroups[g]!;
          const count = edgeGroups[g + 1]!;
          const edgeHash = edgeGroups[g + 2]!;
          let edge = uniqueEdges[g / 3];
          if (!edge || this.hash(edge) !== edgeHash) edge = edgeByHash.get(edgeHash);
          const info: EdgeMeshInfo = { start, count, faces: [], curve: 'other', length: 0 };
          if (edge) {
            Object.assign(info, this.edgeInfo(scope, edge, edgePositions, start, count));
            meshIndexOfEdge.set(edge, edges.length);
          }
          edges.push(info);
        }
        // Adjacence : faces qui bordent chaque arête (pour désigner une arête par ses deux faces).
        for (const tf of src.faces) {
          const fi = meshIndexOfFace.get(tf);
          if (fi === undefined) continue;
          for (const e of this.explore(tf.face, 'edge')) {
            scope.track(e);
            const h = this.hash(e);
            const match = uniqueEdges.find((u) => this.hash(u) === h && u.IsSame(e));
            const ei = match ? meshIndexOfEdge.get(match) : undefined;
            if (ei !== undefined && !edges[ei]!.faces.includes(fi)) edges[ei]!.faces.push(fi);
          }
        }
        return { positions, normals, indices, faces, edgePositions, edges };
      }),
    );
  }

  private edgeInfo(scope: Scope, edge: TopoDS_Edge, lines: Float32Array, start: number, count: number): Partial<EdgeMeshInfo> {
    const oc = this.oc;
    const props = scope.track(new oc.GProp_GProps());
    oc.BRepGProp.LinearProperties(edge, props, false, false);
    const adaptor = scope.track(new oc.BRepAdaptor_Curve(edge));
    const type = adaptor.GetType();
    let curve: CurveKind = 'other';
    const out: Partial<EdgeMeshInfo> = { length: props.Mass() };
    if (type === oc.GeomAbs_CurveType.GeomAbs_Line) {
      curve = 'line';
      const at = (i: number) => ({ x: lines[i * 3]!, y: lines[i * 3 + 1]!, z: lines[i * 3 + 2]! });
      if (count >= 2) out.line = { start: at(start), end: at(start + count - 1) };
    } else if (type === oc.GeomAbs_CurveType.GeomAbs_Circle) {
      curve = 'circle';
      const circ = scope.track(adaptor.Circle());
      const loc = scope.track(circ.Location());
      const axis = scope.track(circ.Axis());
      const d = scope.track(axis.Direction());
      out.circle = { center: { x: loc.X(), y: loc.Y(), z: loc.Z() }, axis: { x: d.X(), y: d.Y(), z: d.Z() }, radius: circ.Radius() };
    }
    out.curve = curve;
    return out;
  }

  exportStep(items: StepExportItem[]): string {
    const oc = this.oc;
    if (items.length === 0) throw new KernelError('Aucune pièce à exporter.');
    return this.guard('export STEP', () =>
      withScope((scope) => {
        const doc = scope.track(new oc.TDocStd_Document(scope.track(new oc.TCollection_ExtendedString('XmlOcaf', true))));
        oc.XCAFDoc_ShapeTool.SetAutoNaming(false);
        const main = scope.track(doc.Main());
        const shapeTool = scope.track(oc.XCAFDoc_DocumentTool.ShapeTool(main));
        const colorTool = scope.track(oc.XCAFDoc_DocumentTool.ColorTool(main));
        for (const item of items) {
          const node = scope.track(shapeTool.NewShape());
          shapeTool.SetShape(node, asOcct(item.shape).shape);
          scope.track(oc.TDataStd_Name.Set(node, scope.track(new oc.TCollection_ExtendedString(item.name, true))));
          const [r, g, b] = hexToRgb(item.color);
          colorTool.SetColor(node, scope.track(new oc.Quantity_ColorRGBA(r, g, b, 1)), oc.XCAFDoc_ColorType.XCAFDoc_ColorSurf);
        }
        shapeTool.UpdateAssemblies();
        const session = scope.track(new oc.XSControl_WorkSession());
        const writer = scope.track(new oc.STEPCAFControl_Writer(session, false));
        writer.SetColorMode(true);
        writer.SetNameMode(true);
        writer.SetLayerMode(false);
        oc.Interface_Static.SetCVal('write.step.unit', 'MM');
        oc.Interface_Static.SetIVal('write.surfacecurve.mode', 1);
        oc.Interface_Static.SetIVal('write.precision.mode', 0);
        oc.Interface_Static.SetIVal('write.step.assembly', 2);
        // AP214 IS : schéma le plus largement pris en charge (FreeCAD, slicers, autres CAO).
        oc.Interface_Static.SetIVal('write.step.schema', 4);
        const fileName = `/export-${++this.fileCounter}.step`;
        const ok = writer.Perform(doc, fileName, scope.track(new oc.Message_ProgressRange()));
        if (!ok) throw new KernelError("L’écriture du fichier STEP a échoué.");
        try {
          return oc.FS.readFile(fileName, { encoding: 'utf8' });
        } finally {
          oc.FS.unlink(fileName);
        }
      }),
    );
  }

  distance(
    a: { shape: KernelShape; kind: 'face' | 'edge'; index: number },
    b: { shape: KernelShape; kind: 'face' | 'edge'; index: number },
  ): DistanceResult {
    const oc = this.oc;
    return this.guard('mesure', () =>
      withScope((scope) => {
        const pick = (p: typeof a): TopoDS_Shape => {
          const src = asOcct(p.shape);
          if (p.kind === 'face') {
            const f = src.faces[p.index];
            if (!f) throw new KernelError('Face introuvable.');
            return f.face;
          }
          const edges = this.uniqueEdges(src.shape);
          for (const e of edges) scope.track(e);
          const e = edges[p.index];
          if (!e) throw new KernelError('Arête introuvable.');
          return e;
        };
        const d = scope.track(new oc.BRepExtrema_DistShapeShape(pick(a), pick(b)));
        if (!d.IsDone() || d.NbSolution() < 1) throw new KernelError('La distance ne peut pas être calculée.');
        const pa = scope.track(d.PointOnShape1(1));
        const pb = scope.track(d.PointOnShape2(1));
        return {
          distance: d.Value(),
          pointA: { x: pa.X(), y: pa.Y(), z: pa.Z() },
          pointB: { x: pb.X(), y: pb.Y(), z: pb.Z() },
        };
      }),
    );
  }

  dispose(shapeIn: KernelShape): void {
    if (!(shapeIn instanceof OcctShape) || shapeIn.disposed) return;
    shapeIn.disposed = true;
    for (const f of shapeIn.faces) {
      try {
        f.face.delete();
      } catch {
        // ignoré
      }
    }
    try {
      shapeIn.shape.delete();
    } catch {
      // ignoré
    }
  }

  memoryBytes(): number {
    return this.oc.wasmMemory.buffer.byteLength;
  }
}
