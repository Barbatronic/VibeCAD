import { describe, expect, it } from 'vitest';
import { fetchLibrary, libraryBaseUrl, matchesSearch, parseLibraryIndex } from '../../src/app/library';
import { createDocument, setPartMaterial } from '../../src/domain/document';
import { copyPartsInto } from '../../src/domain/part-copy';
import { buildPlateDocument } from '../helpers/plate';

const index = {
  format: 'vibecad-library',
  version: 1,
  name: 'Barbatronic',
  description: 'Composants',
  collections: [
    {
      id: 'bearings',
      name: 'Roulements',
      description: '',
      components: [
        { id: '608-2rs', name: 'Roulement 608-2RS', description: 'Alésage 8 mm', tags: ['roulement', '608'], dimensions: { d: 8 }, files: { vibecad: 'bearings/608-2rs.vibecad', step: 'bearings/608-2rs.step', preview: 'bearings/608-2rs.png' } },
        { id: 'sans-fichier', name: 'Sans fichier', files: {} },
        { id: 'piege', name: 'Piège', files: { step: '../../secret.step' } },
      ],
    },
    { id: 'vide', name: 'Vide', components: [] },
  ],
};

describe('bibliothèques de composants', () => {
  it('adresse de base : dépôt GitHub, branche et dossier, adresse web', () => {
    expect(libraryBaseUrl('https://github.com/Barbatronic/VibeCAD-Components')).toBe('https://raw.githubusercontent.com/Barbatronic/VibeCAD-Components/HEAD/');
    expect(libraryBaseUrl('https://github.com/a/b.git')).toBe('https://raw.githubusercontent.com/a/b/HEAD/');
    expect(libraryBaseUrl('https://github.com/a/b/tree/dev/pieces')).toBe('https://raw.githubusercontent.com/a/b/dev/pieces/');
    expect(libraryBaseUrl('https://exemple.fr/biblio/index.json')).toBe('https://exemple.fr/biblio/');
    expect(libraryBaseUrl('https://exemple.fr/biblio')).toBe('https://exemple.fr/biblio/');
    expect(libraryBaseUrl('http://exemple.fr/biblio')).toBeNull();
    expect(libraryBaseUrl('pas une adresse')).toBeNull();
    expect(libraryBaseUrl('https://github.com/seul')).toBeNull();
  });

  it('catalogue : composants sans fichier ou hors du dépôt écartés, collections vides retirées', () => {
    const lib = parseLibraryIndex(index);
    expect(lib.collections.map((c) => c.id)).toEqual(['bearings']);
    expect(lib.collections[0]!.components.map((k) => k.id)).toEqual(['608-2rs']);
    expect(() => parseLibraryIndex({ format: 'autre' })).toThrow(/catalogue/);
    expect(() => parseLibraryIndex({ format: 'vibecad-library', version: 2 })).toThrow(/Version/);
  });

  it('recherche sans accents ni casse, sur le nom, la description et les mots-clés', () => {
    const k = parseLibraryIndex(index).collections[0]!.components[0]!;
    expect(matchesSearch(k, 'roulement 608')).toBe(true);
    expect(matchesSearch(k, 'ALESAGE')).toBe(true);
    expect(matchesSearch(k, 'poulie')).toBe(false);
    expect(matchesSearch(k, '  ')).toBe(true);
  });

  it('chargement : catalogue lu, erreurs expliquées', async () => {
    const ok = await fetchLibrary('https://github.com/a/b', (async () => new Response(JSON.stringify(index))) as typeof fetch);
    expect(ok.status === 'ready' && ok.base).toBe('https://raw.githubusercontent.com/a/b/HEAD/');
    const missing = await fetchLibrary('https://github.com/a/b', (async () => new Response('', { status: 404 })) as typeof fetch);
    expect(missing.status === 'error' && missing.error).toMatch(/introuvable/);
    const offline = await fetchLibrary('https://github.com/a/b', (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch);
    expect(offline.status === 'error' && offline.error).toMatch(/injoignable/);
  });

  it('copie d’une pièce dans le projet : historique gardé, identifiants renouvelés, références suivies', () => {
    const { doc: source } = buildPlateDocument();
    const withMaterial = setPartMaterial(source, source.parts[0]!.id, 'steel');
    const target = createDocument('Projet');
    const once = copyPartsInto(target, withMaterial);
    const twice = copyPartsInto(once.doc, withMaterial);
    expect(twice.doc.parts).toHaveLength(3);
    const copy = twice.doc.parts[2]!;
    const original = withMaterial.parts[0]!;
    expect(copy.material).toBe('steel');
    expect(copy.features.map((f) => f.type)).toEqual(original.features.map((f) => f.type));
    // Identifiants uniques dans le projet, différents de la source.
    const ids = twice.doc.parts.flatMap((p) => [p.id, ...p.features.map((f) => f.id)]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(copy.features.some((f) => original.features.some((o) => o.id === f.id))).toBe(false);
    // La poche suit l'esquisse copiée, l'esquisse du trou suit la face de l'extrusion copiée.
    const pocket = copy.features[3] as { params: { sketchId: string } };
    expect(pocket.params.sketchId).toBe(copy.features[2]!.id);
    expect(JSON.stringify(copy.features[2])).toContain(copy.features[1]!.id);
    // Composant de bibliothèque : esquisses masquées, le reste visible.
    const hidden = copyPartsInto(target, withMaterial, undefined, { hideSketches: true }).doc.parts.at(-1)!;
    expect(hidden.features.map((f) => (f.type === 'sketch' ? f.visible : null))).toEqual(original.features.map((f) => (f.type === 'sketch' ? false : null)));
  });
});
