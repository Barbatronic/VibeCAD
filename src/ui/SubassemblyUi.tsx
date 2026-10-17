/**
 * Sous-assemblages (onglet Assemblage, niveau Expert) : choix de l'assemblage modifié (principal
 * ou un sous-assemblage), création, renommage, suppression. Voir `domain/subassemblies.ts`.
 */
import { useEffect, useState } from 'preact/hooks';
import { allows } from '../app/levels';
import { subassemblyList, subassemblyUses } from '../domain/subassemblies';
import { useAppState, useController } from './context';
import { Button, Callout, IconButton } from './components/controls';

export function SubassemblyBar() {
  const c = useController();
  const data = useAppState(
    (s) => ({
      can: allows(s.level, 'assembly:subassemblies'),
      editing: s.doc.editingSubassembly ?? null,
      subs: subassemblyList(s.doc).map((x) => ({ id: x.id, name: x.name })),
      uses: s.doc.editingSubassembly ? subassemblyUses(s.doc, s.doc.editingSubassembly) : [],
    }),
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  const current = data.subs.find((x) => x.id === data.editing);
  const [name, setName] = useState(current?.name ?? '');
  useEffect(() => setName(current?.name ?? ''), [current?.name]);
  if (!data.can && !data.editing) return null;
  return (
    <div class="subassembly-bar">
      <div class="subassembly-row">
        <label class="field-label" for="as-context">
          Assemblage
        </label>
        <select id="as-context" class="select" value={data.editing ?? ''} onChange={(e) => c.editSubassembly((e.target as HTMLSelectElement).value || null)}>
          <option value="">Principal</option>
          {data.subs.map((x) => (
            <option key={x.id} value={x.id}>
              Sous-assemblage : {x.name}
            </option>
          ))}
        </select>
        <IconButton id="as-new-sub" icon="plus" small label="Nouveau sous-assemblage (un bloc à insérer ensuite, une ou plusieurs fois)" onClick={() => c.createSubassembly()} />
      </div>
      {current ? (
        <Callout kind="info">
          <p>
            Vous modifiez le sous-assemblage <strong>« {current.name} »</strong> : insérez-y des pièces et reliez-les. Il s’insère ensuite comme un{' '}
            <strong>bloc rigide</strong> (Insérer ▾){data.uses.length ? `, il est déjà dans ${data.uses.join(', ')}` : ''}.
          </p>
          <div class="subassembly-row">
            <input
              id="as-sub-name"
              class="input"
              aria-label="Nom du sous-assemblage"
              value={name}
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
              onChange={() => c.renameSubassemblyTo(current.id, name)}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
            <IconButton icon="trash" small label={`Supprimer le sous-assemblage « ${current.name} »`} onClick={() => c.deleteSubassembly(current.id)} />
          </div>
          <Button small icon="chevron-left" onClick={() => c.editSubassembly(null)}>
            Revenir à l’assemblage principal
          </Button>
        </Callout>
      ) : null}
    </div>
  );
}
