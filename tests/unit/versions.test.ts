import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import { addPart, addResource, newResourceId, removePart, renamePart, setPartColor } from '../../src/domain/document';
import type { CadDocument } from '../../src/domain/model';
import { parseNativeFile, serializeDocument } from '../../src/io/native-format';
import { canonicalHistory, hashText, historyToFile, packObjects, unpackObjects, type VersionHistory } from '../../src/io/version-store';
import { addBranch, advanceBranch, commitDiff, commitOf, createVersion, deleteBranch, diffTrees, documentAt, documentOfTree, headOf, layoutGraph, mergeBase, mergeState, mergeTrees, partHistory, sameTree, switchBranch, treeAt, treeOf } from '../../src/io/versions';
import { buildPlateDocument, setDimension } from '../helpers/plate';

/** Trois versions : plaque seule, deuxième pièce ajoutée, plaque recolorée. */
const ids = buildPlateDocument().ids;

function threeVersions(): { h: VersionHistory; docs: CadDocument[] } {
  const d1 = buildPlateDocument().doc;
  const d2 = addPart(d1, 'Équerre').doc;
  const d3 = setPartColor(d2, d2.parts[0]!.id, '#123456');
  let h = createVersion(null, d1, 'Plaque', '2026-11-15T10:00:00.000Z')!;
  h = createVersion(h, d2, 'Équerre ajoutée', '2026-11-15T10:01:00.000Z')!;
  h = createVersion(h, d3, 'Plaque recolorée', '2026-11-15T10:02:00.000Z')!;
  return { h, docs: [d1, d2, d3] };
}

describe('versions du projet', () => {
  it('ne stocke que ce qui change d’une version à l’autre', () => {
    const { h, docs } = threeVersions();
    expect(h.commits.map((c) => c.message)).toEqual(['Plaque', 'Équerre ajoutée', 'Plaque recolorée']);
    expect(h.commits.map((c) => c.parents.length)).toEqual([0, 1, 1]);
    // 1 coquille (inchangée) + plaque + équerre + plaque recolorée.
    expect(Object.keys(h.objects!)).toHaveLength(4);
    expect(h.commits[0]!.shell).toBe(h.commits[2]!.shell);
    expect(h.commits[1]!.parts[1]).toBe(h.commits[2]!.parts[1]);
    expect(createVersion(h, docs[2]!, 'Rien', '2026-11-15T10:03:00.000Z')).toBeNull();
  });

  it('ne dépend ni du nom du projet ni de sa date de modification', () => {
    const { doc } = buildPlateDocument();
    expect(sameTree(treeOf(doc), treeOf({ ...doc, name: 'Autre nom', modifiedAt: '2030-01-01T00:00:00.000Z' }))).toBe(true);
  });

  it('retrouve le projet exact de chaque version', () => {
    const { h, docs } = threeVersions();
    const current = { ...docs[2]!, name: 'Renommé depuis' };
    h.commits.forEach((commit, i) => {
      const parsed = documentAt(h, commit, current);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.doc).toEqual({ ...docs[i]!, name: 'Renommé depuis', modifiedAt: commit.date });
    });
  });

  it('suit le projet dans son fichier, bloc compressé ou en clair', async () => {
    const { h, docs } = threeVersions();
    const plain = parseNativeFile(serializeDocument(docs[2]!, '2026-11-15T10:05:00.000Z', historyToFile(h, docs[2]!.resources)));
    expect(plain.ok && plain.history?.objects).toEqual(h.objects);
    const packed = await packObjects(h.objects!);
    expect(packed).not.toBeNull();
    const text = serializeDocument(docs[2]!, '2026-11-15T10:05:00.000Z', historyToFile({ ...h, packed }, docs[2]!.resources));
    expect(JSON.parse(text).history.objects).toBeUndefined();
    const parsed = parseNativeFile(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // À l'ouverture, le bloc n'est pas décodé.
    expect(parsed.history?.objects).toBeNull();
    expect(parsed.history?.commits).toEqual(h.commits);
    expect(await unpackObjects(parsed.history!.packed!)).toEqual(h.objects);
    expect(parsed.doc).toEqual(docs[2]);
    // Un projet sans versions n'a pas de champ `history`.
    expect(JSON.parse(serializeDocument(docs[2]!)).history).toBeUndefined();
  });

  it('écarte un historique abîmé sans empêcher l’ouverture', () => {
    const { h, docs } = threeVersions();
    const file = JSON.parse(serializeDocument(docs[2]!, undefined, historyToFile(h, docs[2]!.resources)));
    delete file.history.objects[h.commits[0]!.parts[0]!];
    const parsed = parseNativeFile(JSON.stringify(file));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.history).toBeNull();
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.doc).toEqual(docs[2]);
  });

  it('garde une ressource importée que le projet courant n’a plus', () => {
    let { doc } = buildPlateDocument();
    const resource = { id: newResourceId(doc), kind: 'step' as const, fileName: 'piece.step', encoding: 'utf8' as const, data: 'ISO-10303-21;', byteLength: 13, sha256: 'a'.repeat(64), importedAt: '2026-11-15T10:00:00.000Z' };
    doc = addResource(doc, resource);
    const h = createVersion(null, doc, 'Avec import', '2026-11-15T10:00:00.000Z')!;
    // Encore dans le projet : pas de double dans l'historique.
    expect(historyToFile(h, doc.resources).resources).toBeUndefined();
    const without = { ...doc, resources: {} };
    const file = historyToFile(h, without.resources);
    expect(file.resources).toEqual({ [resource.id]: resource });
    const parsed = parseNativeFile(serializeDocument(without, undefined, file));
    expect(parsed.ok && parsed.history?.resources).toEqual({ [resource.id]: resource });
    if (!parsed.ok) return;
    const back = documentAt(parsed.history!, parsed.history!.commits[0]!, without);
    expect(back.ok && back.doc.resources).toEqual({ [resource.id]: resource });
  });

  it('compare deux versions, jusqu’aux étapes de chaque pièce', () => {
    const { h, docs } = threeVersions();
    const plate = docs[0]!.parts[0]!.id;
    const bracket = docs[1]!.parts[1]!.id;
    expect(commitDiff(h, h.commits[0]!)).toEqual({ parts: [{ id: plate, name: 'Pièce 1', status: 'added', steps: [] }], sections: [] });
    expect(commitDiff(h, h.commits[1]!)).toEqual({ parts: [{ id: bracket, name: 'Équerre', status: 'added', steps: [] }], sections: [] });
    expect(commitDiff(h, h.commits[2]!)).toEqual({ parts: [{ id: plate, name: 'Pièce 1', status: 'modified', steps: [{ name: 'Couleur', status: 'modified' }] }], sections: [] });
    // Modifications en cours : une cote changée, une pièce supprimée.
    const edited = setDimension(removePart(docs[2]!, bracket), docs[2]!.parts[0]!.features[0]!.id, ids.widthConstraint, 80);
    const working = treeOf(edited);
    expect(diffTrees(h.commits[2]!, working, (hash) => h.objects![hash] ?? working.texts[hash])).toEqual({
      parts: [
        { id: plate, name: 'Pièce 1', status: 'modified', steps: [{ name: docs[2]!.parts[0]!.features[0]!.name, status: 'modified' }] },
        { id: bracket, name: 'Équerre', status: 'removed', steps: [] },
      ],
      sections: [],
    });
  });

  it('retrace ce qui est arrivé à une pièce', () => {
    const { h, docs } = threeVersions();
    expect(partHistory(h, docs[0]!.parts[0]!.id).map((x) => [x.commit.message, x.change.status])).toEqual([
      ['Plaque recolorée', 'modified'],
      ['Plaque', 'added'],
    ]);
    expect(partHistory(h, docs[1]!.parts[1]!.id).map((x) => x.commit.message)).toEqual(['Équerre ajoutée']);
  });

  it('branches : création, bascule, suppression avec ses versions', () => {
    const { h, docs } = threeVersions();
    let b = addBranch(h, 'essai', h.commits[0]!.id);
    expect(b.current).toBe('essai');
    b = createVersion(b, renamePart(docs[0]!, docs[0]!.parts[0]!.id, 'Variante'), 'Variante', '2026-11-15T10:10:00.000Z')!;
    expect(headOf(b)?.message).toBe('Variante');
    expect(headOf(b, 'principal')?.message).toBe('Plaque recolorée');
    const graph = layoutGraph(b);
    expect(graph.rows.map((r) => [r.commit.message, r.lane])).toEqual([
      ['Variante', 0],
      ['Plaque recolorée', 1],
      ['Équerre ajoutée', 1],
      ['Plaque', 0],
    ]);
    expect(graph.lanes).toBe(2);
    expect(graph.edges).toEqual([
      { from: 0, fromLane: 0, to: 3, toLane: 0, lane: 0 },
      { from: 1, fromLane: 1, to: 2, toLane: 1, lane: 1 },
      { from: 2, fromLane: 1, to: 3, toLane: 0, lane: 1 },
    ]);
    const back = deleteBranch(switchBranch(b, 'principal'), 'essai');
    expect(back.commits.map((c) => c.message)).toEqual(['Plaque', 'Équerre ajoutée', 'Plaque recolorée']);
    expect(Object.keys(back.objects!).sort()).toEqual(Object.keys(h.objects!).sort());
  });

  /** Deux lignées depuis « Équerre ajoutée » : `principal` recolore la plaque, `essai` fait autre chose. */
  function twoBranches(change: (doc: CadDocument) => CadDocument): { h: VersionHistory; docs: CadDocument[]; ours: string; theirs: string } {
    const { h, docs } = threeVersions();
    const ours = headOf(h)!.id;
    let b = addBranch(h, 'essai', h.commits[1]!.id);
    b = createVersion(b, change(docs[1]!), 'Essai', '2026-11-15T10:10:00.000Z')!;
    const theirs = headOf(b)!.id;
    return { h: switchBranch(b, 'principal'), docs, ours, theirs };
  }

  function merge(h: VersionHistory, ours: string, theirs: string, doc: CadDocument, choices = {}) {
    const base = mergeBase(h, ours, theirs);
    return mergeTrees(base ? treeAt(h, base, doc) : null, treeAt(h, commitOf(h, ours)!, doc)!, treeAt(h, commitOf(h, theirs)!, doc)!, choices);
  }

  it('fusion : situe une version par rapport à la branche de travail', () => {
    const { h, ours, theirs } = twoBranches((d) => renamePart(d, d.parts[1]!.id, 'Équerre renforcée'));
    expect(mergeState(h, ours, theirs)).toBe('diverged');
    expect(mergeState(h, ours, h.commits[0]!.id)).toBe('merged');
    expect(mergeState(h, h.commits[0]!.id, ours)).toBe('forward');
    expect(mergeBase(h, ours, theirs)?.message).toBe('Équerre ajoutée');
    expect(headOf(advanceBranch(addBranch(h, 'retard', h.commits[0]!.id), ours))?.id).toBe(ours);
  });

  it('fusion : reprend seule ce que chaque côté a changé de son côté', () => {
    const { h, docs, ours, theirs } = twoBranches((d) => addPart(renamePart(d, d.parts[1]!.id, 'Équerre renforcée'), 'Cale').doc);
    const { tree, conflicts } = merge(h, ours, theirs, docs[2]!);
    expect(conflicts).toEqual([]);
    const parsed = documentOfTree(h, tree, docs[2]!, '2026-11-15T10:20:00.000Z');
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.doc.parts.map((p) => [p.name, p.color === '#123456'])).toEqual([
      ['Pièce 1', true],
      ['Équerre renforcée', false],
      ['Cale', false],
    ]);
    // La version de fusion dérive des deux côtés ; le graphe la relie aux deux.
    const merged = createVersion(h, parsed.doc, 'Fusion de « essai »', '2026-11-15T10:20:00.000Z', [theirs])!;
    expect(headOf(merged)?.parents).toEqual([ours, theirs]);
    expect(mergeState(merged, headOf(merged)!.id, theirs)).toBe('merged');
    expect(layoutGraph(merged).edges.filter((e) => e.from === 0)).toHaveLength(2);
    expect(commitDiff(merged, headOf(merged)!).parts.map((p) => [p.name, p.status])).toEqual([
      ['Équerre renforcée', 'modified'],
      ['Cale', 'added'],
    ]);
  });

  it('fusion : une pièce changée des deux côtés demande un choix', () => {
    const { h, docs, ours, theirs } = twoBranches((d) => renamePart(d, d.parts[0]!.id, 'Plaque percée'));
    const mine = merge(h, ours, theirs, docs[2]!);
    expect(mine.conflicts).toEqual([{ key: `part:${docs[0]!.parts[0]!.id}`, name: 'Pièce 1', ours: 'modified', theirs: 'modified' }]);
    const nameOf = (tree: typeof mine.tree) => {
      const parsed = documentOfTree(h, tree, docs[2]!, '2026-11-15T10:20:00.000Z');
      if (!parsed.ok) throw new Error(parsed.error);
      return [parsed.doc.parts[0]!.name, parsed.doc.parts[0]!.color];
    };
    expect(nameOf(mine.tree)).toEqual(['Pièce 1', '#123456']);
    expect(nameOf(merge(h, ours, theirs, docs[2]!, { [`part:${docs[0]!.parts[0]!.id}`]: 'theirs' }).tree)[0]).toBe('Plaque percée');
  });

  it('fusion : une pièce supprimée d’un côté et modifiée de l’autre est un conflit, supprimée seule elle part', () => {
    const { h, docs, ours, theirs } = twoBranches((d) => removePart(d, d.parts[0]!.id));
    expect(merge(h, ours, theirs, docs[2]!).conflicts).toEqual([{ key: `part:${docs[0]!.parts[0]!.id}`, name: 'Pièce 1', ours: 'modified', theirs: 'removed' }]);
    const other = twoBranches((d) => removePart(d, d.parts[1]!.id));
    const { tree, conflicts } = merge(other.h, other.ours, other.theirs, other.docs[2]!);
    expect(conflicts).toEqual([]);
    expect(tree.parts).toHaveLength(1);
  });

  it('donne la même empreinte au projet relu depuis son fichier, et remet à jour un ancien historique', () => {
    const { h, docs } = threeVersions();
    const parsed = parseNativeFile(serializeDocument(docs[2]!, '2026-11-15T10:03:00.000Z'));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(sameTree(headOf(h)!, treeOf(parsed.doc))).toBe(true);
    // Ancien historique : contenus rangés tels quels, clés dans un autre ordre.
    const reversed = (x: unknown): unknown => (Array.isArray(x) ? x.map(reversed) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).reverse().map(([k, v]) => [k, reversed(v)])) : x);
    const renamed = new Map(Object.entries(h.objects!).map(([hash, text]) => [hash, JSON.stringify(reversed(JSON.parse(text)))] as const));
    const old = {
      commits: h.commits.map((c) => ({ ...c, shell: hashText(renamed.get(c.shell)!), parts: c.parts.map((p) => hashText(renamed.get(p)!)) })),
      objects: Object.fromEntries([...renamed.values()].map((text) => [hashText(text), text])),
    };
    const fixed = canonicalHistory(old);
    expect(fixed.commits).toEqual(h.commits);
    expect(fixed.objects).toEqual(h.objects);
    expect(canonicalHistory(fixed)).toBe(fixed);
  });

  it('écrit un fichier conforme au schéma publié, historique compris', async () => {
    const { h, docs } = threeVersions();
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync('docs/vibecad.schema.json', 'utf8')));
    for (const history of [h, { ...h, packed: await packObjects(h.objects!) }]) {
      validate(JSON.parse(serializeDocument(docs[2]!, '2026-11-15T10:03:00.000Z', historyToFile(history, docs[2]!.resources))));
      expect(validate.errors ?? []).toEqual([]);
    }
  });
});
