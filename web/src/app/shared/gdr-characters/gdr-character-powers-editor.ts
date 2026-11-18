import { Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GdrWorkspaceService, WorkspaceCharacter, CharacterPower } from '../../core/gdr-workspace.service';

@Component({
  selector: 'app-gdr-character-powers-editor',
  standalone: true,
  imports: [FormsModule],
  template: `
    <section aria-label="Abilità e magie del personaggio">
      <h4>Abilità e magie</h4>
      @if (error()) { <p role="alert">{{ error() }}</p> }
      @if (!editing()) {
        <p>Assegna a {{ character().name }} le voci disponibili per questa avventura.</p>
        <button type="button" class="btn" [disabled]="disabled()" (click)="begin()">Scegli abilità e magie</button>
      } @else {
        @if (loading()) { <p role="status">Caricamento del catalogo…</p> }
        <fieldset [disabled]="loading() || saving()">
          <label>Cerca nel catalogo<input type="search" [ngModel]="search()" (ngModelChange)="search.set($event)" /></label>
          @for (kind of kinds; track kind.id) {
            <h5>{{ kind.label }}</h5>
            @for (power of filtered(kind.id); track power.id) {
              <label class="power-choice"><input type="checkbox" [checked]="selected().includes(power.id)" (change)="toggle(power.id, $any($event.target).checked)" /><span><strong>{{ power.name }}</strong><small>{{ power.description }}</small></span></label>
            } @empty { <p>Nessuna voce disponibile.</p> }
          }
        </fieldset>
        <div class="actions">
          <button type="button" class="btn" [disabled]="saving()" (click)="cancel()">Annulla selezione</button>
          <button type="button" class="btn" [disabled]="loading() || saving() || !loaded()" (click)="save()">{{ saving() ? 'Salvataggio…' : 'Salva abilità e magie' }}</button>
        </div>
      }
    </section>
  `,
  styles: `
    :host {display:block;margin-top:1rem;min-width:0}
    fieldset {border:0;padding:0;min-width:0}
    label {display:grid;gap:.4rem;margin:.7rem 0}
    input[type=search] {width:100%;box-sizing:border-box;font:inherit;padding:.6rem;border-radius:.5rem;border:1px solid var(--panel-border-color);background:var(--input-bg);color:var(--text-color)}
    .power-choice {display:flex;gap:.7rem;align-items:start;padding:.65rem;border:1px solid var(--panel-border-color);border-radius:.6rem}
    .power-choice input {flex:0 0 auto;margin-top:.3rem}
    .power-choice span {min-width:0;overflow-wrap:anywhere}
    small {display:block;white-space:pre-wrap;opacity:.8;max-height:6rem;overflow:auto}
    .actions {display:flex;flex-wrap:wrap;gap:.5rem;margin-top:1rem}
  `,
})
export class GdrCharacterPowersEditor {
  readonly character = input.required<WorkspaceCharacter>();
  readonly disabled = input(false);
  readonly pending = output<boolean>();
  private readonly workspace = inject(GdrWorkspaceService);
  protected readonly kinds = [{id: 'ability', label: 'Abilità'}, {id: 'spell', label: 'Magie'}];
  protected readonly editing = signal(false);
  protected readonly loading = signal(false);
  protected readonly loaded = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly search = signal('');
  protected readonly selected = signal<string[]>([]);
  protected readonly powers = signal<(CharacterPower & {adventureIds: string[]})[]>([]);
  private revision = 0;
  protected filtered(kind: string) {
    return this.powers().filter(p => p.kind === kind && (p.name + ' ' + p.description).toLocaleLowerCase('it').includes(this.search().trim().toLocaleLowerCase('it')));
  }
  protected async begin(): Promise<void> {
    if (this.disabled() || this.editing()) return;
    this.pending.emit(true);
    this.editing.set(true);
    this.loading.set(true);
    this.loaded.set(false);
    this.error.set('');
    this.search.set('');
    const character = this.character();
    this.revision = character.revision;
    try {
      const response = await fetch('/api/gdr-powers', { credentials: 'same-origin' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Catalogo non disponibile.');
      this.powers.set(data.powers.filter((p: {adventureIds: string[]}) => p.adventureIds.includes(character.adventureId)));
      // Legge le assegnazioni aggiornate insieme al catalogo.
      this.selected.set(data.powers.filter((p: {characterIds: string[]}) => p.characterIds.includes(character.id)).map((p: {id: string}) => p.id));
      this.loaded.set(true);
    } catch (error) { this.error.set(error instanceof Error ? error.message : 'Catalogo non disponibile.'); }
    finally { this.loading.set(false); }
  }
  protected toggle(id: string, checked: boolean): void {
    this.selected.update(ids => checked ? [...ids, id] : ids.filter(value => value !== id));
  }
  protected cancel(): void {
    if (this.saving()) return;
    this.editing.set(false);
    this.pending.emit(false);
    this.error.set('');
    // Rilegge anche la revisione dopo un eventuale conflitto.
    void this.workspace.load(this.character().adventureId);
  }
  protected async save(): Promise<void> {
    if (!this.loaded() || this.saving()) return;
    this.saving.set(true);
    this.error.set('');
    try {
      const response = await fetch('/api/gdr-powers/assignments', {
        method: 'PUT', credentials: 'same-origin', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({characterId: this.character().id, revision: this.revision, powerIds: this.selected()}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Salvataggio non riuscito.');
      await this.workspace.load(this.character().adventureId);
      if (!this.workspace.available()) throw new Error('Salvataggio riuscito. Ricarica la pagina per rileggere la scheda aggiornata.');
      this.editing.set(false);
      this.pending.emit(false);
      this.workspace.message.set('Abilità e magie salvate.');
    } catch (error) { this.error.set(error instanceof Error ? error.message : 'Salvataggio non riuscito.'); }
    finally { this.saving.set(false); }
  }
}
