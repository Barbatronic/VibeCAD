/** Grille discrète adaptative (plan XY ou plan d'esquisse) et axes du repère. */
import { BufferGeometry, Color, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Matrix4, Vector3 } from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Frame3D } from '../math/frame';
import type { Vec2 } from '../math/vec';
import type { ViewportPalette } from './colors';

export function frameMatrix(frame: Frame3D): Matrix4 {
  const m = new Matrix4();
  m.makeBasis(
    new Vector3(frame.xAxis.x, frame.xAxis.y, frame.xAxis.z),
    new Vector3(frame.yAxis.x, frame.yAxis.y, frame.yAxis.z),
    new Vector3(frame.normal.x, frame.normal.y, frame.normal.z),
  );
  m.setPosition(frame.origin.x, frame.origin.y, frame.origin.z);
  return m;
}

export class PlaneGrid {
  readonly group = new Group();
  private readonly minor: LineSegments;
  private readonly major: LineSegments;
  private key = '';

  constructor(palette: ViewportPalette) {
    this.minor = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: palette.gridMinor, transparent: true, opacity: 0.55, depthWrite: false }));
    this.major = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: palette.gridMajor, transparent: true, opacity: 0.8, depthWrite: false }));
    this.minor.renderOrder = -2;
    this.major.renderOrder = -1;
    this.group.add(this.minor, this.major);
    this.group.matrixAutoUpdate = false;
  }

  setPalette(palette: ViewportPalette): void {
    (this.minor.material as LineBasicMaterial).color = new Color(palette.gridMinor);
    (this.major.material as LineBasicMaterial).color = new Color(palette.gridMajor);
  }

  /** Reconstruit la grille autour de `center` (coordonnées du plan) avec un pas `step` (mm). */
  update(frame: Frame3D, step: number, center: Vec2, halfCount = 50): void {
    const majorStep = step * 10;
    const cx = Math.round(center.x / majorStep) * majorStep;
    const cy = Math.round(center.y / majorStep) * majorStep;
    const key = `${step}|${cx}|${cy}|${frame.origin.x},${frame.origin.y},${frame.origin.z}|${frame.normal.x},${frame.normal.y},${frame.normal.z}|${frame.xAxis.x},${frame.xAxis.y},${frame.xAxis.z}`;
    if (key === this.key) return;
    this.key = key;
    const extent = step * halfCount;
    const minor: number[] = [];
    const major: number[] = [];
    for (let i = -halfCount; i <= halfCount; i++) {
      const x = cx + i * step;
      const y = cy + i * step;
      const isMajorX = Math.abs(Math.round(x / majorStep) * majorStep - x) < step * 1e-6;
      const isMajorY = Math.abs(Math.round(y / majorStep) * majorStep - y) < step * 1e-6;
      (isMajorX ? major : minor).push(x, cy - extent, 0, x, cy + extent, 0);
      (isMajorY ? major : minor).push(cx - extent, y, 0, cx + extent, y, 0);
    }
    this.minor.geometry.dispose();
    this.major.geometry.dispose();
    this.minor.geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(minor, 3));
    this.major.geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(major, 3));
    this.group.matrix.copy(frameMatrix(frame));
    this.group.matrixWorldNeedsUpdate = true;
  }

  dispose(): void {
    this.minor.geometry.dispose();
    this.major.geometry.dispose();
    (this.minor.material as LineBasicMaterial).dispose();
    (this.major.material as LineBasicMaterial).dispose();
  }
}

function axisLabel(text: string, color: string): CSS2DObject {
  const el = document.createElement('span');
  el.className = 'vp-axis-label';
  el.textContent = text;
  el.style.color = color;
  el.setAttribute('aria-hidden', 'true');
  return new CSS2DObject(el);
}

/** Axes X (rouge), Y (vert), Z (bleu) depuis l'origine, avec leurs lettres. */
export class AxesView {
  readonly group = new Group();
  private readonly lines: LineSegments;
  private readonly labels: CSS2DObject[];
  private length = 0;

  constructor(palette: ViewportPalette) {
    const geometry = new BufferGeometry();
    const material = new LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true });
    this.lines = new LineSegments(geometry, material);
    this.lines.renderOrder = 5;
    this.labels = [axisLabel('X', palette.axisX), axisLabel('Y', palette.axisY), axisLabel('Z', palette.axisZ)];
    this.group.add(this.lines, ...this.labels);
    this.setPalette(palette);
    this.setLength(20);
  }

  setPalette(palette: ViewportPalette): void {
    const cols = [palette.axisX, palette.axisY, palette.axisZ].map((c) => new Color(c));
    const colors: number[] = [];
    for (const c of cols) colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    this.lines.geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    this.labels.forEach((l, i) => ((l.element as HTMLElement).style.color = [palette.axisX, palette.axisY, palette.axisZ][i]!));
  }

  setLength(length: number): void {
    if (Math.abs(length - this.length) < length * 0.05) return;
    this.length = length;
    this.lines.geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, length, 0, 0, 0, 0, 0, 0, length, 0, 0, 0, 0, 0, 0, length], 3));
    this.labels[0]!.position.set(length * 1.08, 0, 0);
    this.labels[1]!.position.set(0, length * 1.08, 0);
    this.labels[2]!.position.set(0, 0, length * 1.08);
  }

  dispose(): void {
    this.lines.geometry.dispose();
    (this.lines.material as LineBasicMaterial).dispose();
  }
}
