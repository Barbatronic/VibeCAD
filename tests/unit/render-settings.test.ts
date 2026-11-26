import { describe, expect, it } from 'vitest';
import { DEFAULT_RENDER, lightDirection, renderSettings, storedRender } from '../../src/domain/render';

describe('scène de rendu', () => {
  it('valeurs par défaut pour les réglages absents ; seuls les écarts sont rangés', () => {
    expect(renderSettings(undefined)).toEqual(DEFAULT_RENDER);
    const s = renderSettings({ exposure: 1.4 });
    expect(s.exposure).toBe(1.4);
    expect(s.ground).toBe(DEFAULT_RENDER.ground);
    expect(storedRender(s)).toEqual({ exposure: 1.4 });
    expect(storedRender({ ...DEFAULT_RENDER })).toBeUndefined();
  });

  it('direction de la lumière : azimut depuis +X, hauteur au-dessus de l’horizon', () => {
    const d = lightDirection({ lightAzimuth: 90, lightElevation: 0 });
    expect(d.x).toBeCloseTo(0, 9);
    expect(d.y).toBeCloseTo(1, 9);
    expect(lightDirection({ lightAzimuth: 0, lightElevation: 90 }).z).toBeCloseTo(1, 9);
    // Par défaut : en hauteur, de devant à gauche (comme l'éclairage d'origine).
    const k = lightDirection(DEFAULT_RENDER);
    expect(k.x).toBeCloseTo(-0.304, 2);
    expect(k.y).toBeCloseTo(-0.47, 2);
    expect(k.z).toBeCloseTo(0.829, 2);
  });
});
