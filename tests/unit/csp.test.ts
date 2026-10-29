import { describe, expect, it } from 'vitest';
import { DEFAULT_LIBRARIES, libraryBaseUrl } from '../../src/app/library';
import { offlinePlugin } from '../../scripts/vite-plugin-offline';

/** Politique de sécurité ajoutée à index.html au build, directive par directive. */
function buildCsp(): Map<string, string[]> {
  const plugin = offlinePlugin();
  const hook = plugin.transformIndexHtml as unknown as () => { attrs: { content: string } }[];
  const content = hook()[0]!.attrs.content;
  return new Map(content.split(';').map((d) => d.trim().split(/\s+/)).map(([name, ...values]) => [name!, values]));
}

describe('politique de sécurité (CSP) du build publié', () => {
  it('laisse lire les bibliothèques de composants par défaut (catalogue, fichiers, vignettes)', () => {
    const csp = buildCsp();
    for (const source of DEFAULT_LIBRARIES) {
      const origin = new URL(libraryBaseUrl(source)!).origin;
      expect(csp.get('connect-src')).toContain(origin);
      expect(csp.get('img-src')).toContain(origin);
    }
  });

  it('le code ne vient que de l’application', () => {
    const csp = buildCsp();
    expect(csp.get('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'"]);
    expect(csp.get('default-src')).toEqual(["'self'"]);
    expect(csp.get('font-src')).toEqual(["'self'"]);
    expect(csp.get('object-src')).toEqual(["'none'"]);
  });
});
