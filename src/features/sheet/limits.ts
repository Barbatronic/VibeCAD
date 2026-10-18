/** Message d'alerte d'un pli difficile dans un matériau (rayon trop petit, angle trop grand). */
import { bendIssues, sheetMaterial } from '../../domain/sheet-metal';
import { formatLength, formatNumber } from '../../domain/units';

export function bendWarning(materialId: string, thickness: number, radius: number, angleDeg: number): string | null {
  const m = sheetMaterial(materialId);
  const messages = bendIssues(m, thickness, radius, angleDeg).flatMap((i) => {
    if (i.kind === 'radius') return [`Rayon trop petit pour ${m.name.toLowerCase()} de ${formatLength(thickness)} : au moins ${formatLength(i.min)}, sinon le pli risque de se fissurer ou de casser.`];
    if (i.kind === 'angle') return [`Angle trop grand pour ${m.name.toLowerCase()} : ${formatNumber(i.max, 0)}° au plus.`];
    return [];
  });
  return messages.length ? messages.join(' ') : null;
}

/** Validation commune des longueurs, angles et rayons de pli. */
export function validateBend(p: { angle: number; radius?: number }): { field: string; message: string }[] {
  const out: { field: string; message: string }[] = [];
  if (!Number.isFinite(p.angle) || p.angle <= 0 || p.angle > 180) out.push({ field: 'angle', message: 'L’angle du pli doit être entre 0 et 180°.' });
  if (p.radius !== undefined && (!Number.isFinite(p.radius) || p.radius < 0 || p.radius > 200)) out.push({ field: 'radius', message: 'Le rayon doit être entre 0 et 200 mm.' });
  return out;
}
