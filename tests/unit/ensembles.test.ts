import { describe, expect, it } from 'vitest';
import { addInstance, addPart, createDocument, renamePart } from '../../src/domain/document';
import { addLinkedCopy, createEnsemble, dissolveEnsemble, ensembleOf, movePartToEnsemble, partIsJointed, renameEnsemble } from '../../src/domain/ensembles';
import { assemblyContents } from '../../src/domain/subassemblies';
import { parseNativeFile, serializeDocument } from '../../src/io/native-format';

/** Deux pièces posées dans l'assemblage : A à l'origine, B à x = 40. */
function sample() {
  const a = addPart(createDocument('Ensembles'), 'A');
  const b = addPart(a.doc, 'B');
  let doc = addInstance(b.doc, a.partId, { x: 0, y: 0, z: 0 }).doc;
  doc = addInstance(doc, b.partId, { x: 40, y: 0, z: 0 }).doc;
  return { doc, a: a.partId, b: b.partId };
}

describe('ensembles de la liste des pièces', () => {
  it('range des pièces dans un bloc sans les déplacer', () => {
    const { doc, a, b } = sample();
    const made = createEnsemble(doc, a);
    const both = movePartToEnsemble(made.doc, b, made.id);
    expect(ensembleOf(both, a)).toBe(made.id);
    expect(ensembleOf(both, b)).toBe(made.id);
    // L'assemblage ne contient plus que le bloc ; les pièces gardent leur place dans le bloc.
    expect(both.assembly!.instances.map((i) => i.subassemblyId)).toEqual([made.id]);
    expect(both.subassemblies![0]!.instances.map((i) => [i.partId, i.position.x])).toEqual([
      [a, 0],
      [b, 40],
    ]);
    expect(movePartToEnsemble(both, b, made.id)).toBe(both);
  });

  it('garde la place d’une pièce qui entre dans un bloc déplacé, puis en sort', () => {
    const { doc, a, b } = sample();
    const made = createEnsemble(doc, a);
    const shifted = { ...made.doc, assembly: { ...made.doc.assembly!, instances: made.doc.assembly!.instances.map((i) => (i.subassemblyId ? { ...i, position: { x: 100, y: 0, z: 0 } } : i)) } };
    const inside = movePartToEnsemble(shifted, b, made.id);
    expect(inside.subassemblies![0]!.instances.find((i) => i.partId === b)!.position.x).toBe(-60);
    const back = movePartToEnsemble(inside, b, null);
    expect(back.assembly!.instances.find((i) => i.partId === b)!.position.x).toBe(40);
  });

  it('garde la place d’une pièce qui entre dans un bloc tourné, puis en sort', () => {
    const { doc, a, b } = sample();
    const made = createEnsemble(doc, a);
    // Bloc déplacé et tourné d'un quart de tour autour de Z.
    const turned = { ...made.doc, assembly: { ...made.doc.assembly!, instances: made.doc.assembly!.instances.map((i) => (i.subassemblyId ? { ...i, position: { x: 10, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 90 } } : i)) } };
    const inside = movePartToEnsemble(turned, b, made.id);
    const local = inside.subassemblies![0]!.instances.find((i) => i.partId === b)!;
    // Monde (40, 0, 0) → repère du bloc : (0, −30, 0), tournée de −90°.
    expect(local.position.x).toBeCloseTo(0, 6);
    expect(local.position.y).toBeCloseTo(-30, 6);
    expect(local.rotation?.z).toBeCloseTo(-90, 6);
    const back = movePartToEnsemble(inside, b, null).assembly!.instances.find((i) => i.partId === b)!;
    expect(back.position.x).toBeCloseTo(40, 6);
    expect(back.position.y).toBeCloseTo(0, 6);
    expect(back.rotation).toBeUndefined();
  });

  it('retire le bloc d’un ensemble vidé, et défait un ensemble', () => {
    const { doc, a, b } = sample();
    const made = createEnsemble(doc, a);
    const emptied = movePartToEnsemble(made.doc, a, null);
    expect(emptied.assembly!.instances.some((i) => i.subassemblyId)).toBe(false);
    expect(emptied.subassemblies).toHaveLength(1);
    const both = movePartToEnsemble(made.doc, b, made.id);
    const undone = dissolveEnsemble(both, made.id);
    expect(undone.subassemblies).toBeUndefined();
    expect(undone.assembly!.instances.map((i) => [i.partId, i.position.x])).toEqual([
      [a, 0],
      [b, 40],
    ]);
  });

  it('ajoute une copie liée là où la pièce est rangée, et renomme les blocs', () => {
    const { doc, a } = sample();
    const made = createEnsemble(doc, a);
    const copied = addLinkedCopy(made.doc, a, 25);
    expect(copied.subassemblies![0]!.instances.map((i) => [i.name, i.position.x])).toEqual([
      ['A', 0],
      ['A (2)', 25],
    ]);
    expect(assemblyContents(copied, copied.assembly).counts.get(a)).toBe(2);
    expect(partIsJointed(copied, a)).toBe(false);
    const renamed = renameEnsemble(copied, made.id, 'Chariot');
    expect(renamed.subassemblies![0]!.name).toBe('Chariot');
    expect(renamed.assembly!.instances.find((i) => i.subassemblyId)!.name).toBe('Chariot');
    const parsed = parseNativeFile(serializeDocument(renamed));
    expect(parsed.ok && parsed.doc.subassemblies![0]!.instances).toHaveLength(2);
  });

  it('renommer une pièce renomme ses insertions (assemblage et bloc), sauf celles renommées à part', () => {
    const { doc, a, b } = sample();
    let twice = addInstance(doc, a, { x: 0, y: 30, z: 0 }).doc;
    twice = { ...twice, assembly: { ...twice.assembly!, instances: [...twice.assembly!.instances, { ...twice.assembly!.instances[0]!, id: 'in-x', name: 'Roue avant' }] } };
    const renamed = renamePart(twice, a, 'Roue');
    expect(renamed.parts.find((p) => p.id === a)!.name).toBe('Roue');
    expect(renamed.assembly!.instances.filter((i) => i.partId === a).map((i) => i.name)).toEqual(['Roue', 'Roue (2)', 'Roue avant']);
    // Dans un bloc aussi.
    const made = createEnsemble(doc, b);
    const inBlock = renamePart(made.doc, b, 'Moteur');
    expect(inBlock.subassemblies![0]!.instances.find((i) => i.partId === b)!.name).toBe('Moteur');
  });
});
