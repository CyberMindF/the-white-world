import { Component, ElementRef, ViewChild, computed, effect, input, output, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { updateGdrTextarea } from '../gdr-textarea';
import { PROFILE_FIELDS } from '../gdr-characters/character-profile';
import { GdrBlocks } from '../gdr-blocks/gdr-blocks';
import { BLOCK_TYPES, SNIPPET_LABELS } from '../gdr-blocks/gdr-snippets';
import { NarrativeCharacter, insertNarrativeBlock, narrativeSnippet, replaceNarrativeSelection } from './gdr-writing';
import { NarrativeSection, parseNarrative, safeNarrativeImage } from './gdr-turn.parser';
import { GdrBlockRow, GdrParagraphData } from '../gdr-blocks/gdr-block.types';
import { serializeGdrBlocks } from '../gdr-blocks/gdr-markdown.serializer';

interface RenderedSection extends NarrativeSection {
  persistentId?: string;
  ownerId?: string;
  ownerStart?: number;
  ownerEnd?: number;
}

@Component({
  selector: 'app-gdr-turn',
  standalone: true,
  imports: [GdrBlocks, FormsModule, NgTemplateOutlet],
  template: `
    @if (viewedCharacter(); as character) {
      <div class="character-backdrop" (click)="viewedCharacter.set(null)">
        <section class="character-modal" role="dialog" aria-modal="true" aria-label="Scheda personaggio" tabindex="-1" (keydown.escape)="viewedCharacter.set(null)" (click)="$event.stopPropagation()">
          <header><span>Scheda personaggio</span><button type="button" autofocus (click)="viewedCharacter.set(null)" aria-label="Chiudi scheda">✕</button></header>
          <div class="character-content" [class.with-artwork]="!!character.photo">
            @if (character.photo) { <div class="character-images"><img class="character-artwork" [src]="character.photo" [alt]="'Artwork di ' + character.name" /></div> }
            <div class="character-info">
              <div class="character-summary">
                @if (character.portrait) { <img class="character-avatar-large" [src]="character.portrait" [alt]="'Avatar di ' + character.name" /> }
                <h2>{{ character.name }}</h2>
              </div>
              <div class="character-details">
                <h3>Informazioni conosciute</h3>
                @if (!hasPublicInformation(character)) { <p class="character-empty">Sembra che qui non ci siano ancora informazioni.</p> }
                @if (character.profile; as profile) {
                  <dl class="character-facts">
                    @for (field of identityFields; track field.key) {
                      @if (profile[field.key]) { <div><dt>{{ field.label }}</dt><dd>{{ profile[field.key] }}</dd></div> }
                    }
                  </dl>
                  @for (field of profileFields; track field.key) {
                    @if (field.key === 'history' ? knownHistory(profile) : profile[field.key]) { <h3>{{ field.label }}</h3><p>{{ field.key === 'history' ? knownHistory(profile) : profile[field.key] }}</p> }
                  }
                } @else if (character.description) { <p>{{ character.description }}</p> }
              </div>
            </div>
          </div>
        </section>
      </div>
    }

    @for (section of rendered(); track section.id; let sectionIndex = $index) {
      @if (isInsertingBeside(section, 'above')) {
        <ng-container *ngTemplateOutlet="inlineEditor" />
      }
      @if (isEditing(section)) {
        <ng-container *ngTemplateOutlet="inlineEditor" />
      } @else if (section.kind === 'document') {
        <app-gdr-blocks
          [blocks]="section.blocks" (characterOpen)="openNpc($event)"
          [editable]="editable() && editBlocks()"
          [continuation]="sectionIndex > 0"
          (editBlock)="startEditing(section)"
        />
      } @else {
        <ng-container
          *ngTemplateOutlet="content; context: { $implicit: section, canEdit: editable() && editBlocks() }"
        />
      }
      @if (isInsertingBeside(section, 'below')) {
        <ng-container *ngTemplateOutlet="inlineEditor" />
      }
    }
    @if (editable() && insertable() && !rendered().length) {
      @if (inserting()) {
        <ng-container *ngTemplateOutlet="inlineEditor" />
      } @else {
        <button class="start-writing" type="button" aria-label="Inizia a scrivere" (click)="startInserting(0)">
          Inizia a scrivere
        </button>
      }
    }
    <ng-template #inlineEditor>
      <section
        class="inline-editor"
        [attr.aria-label]="inserting() ? 'Aggiungi in questo punto' : 'Modifica in questo punto'"
      >
        <div class="inline-header">
          <strong>{{ inserting() ? 'Aggiungi in questo punto' : 'Modifica questo punto' }}</strong
          ><span>Solo questa parte del racconto.</span>
        </div>
        <div class="inline-tools">
          <label [for]="fieldId + '-type'">Inserisci</label>
          <select
            #snippetType
            [id]="fieldId + '-type'"
            aria-label="Inserisci contenuto nel blocco"
            (change)="insertSnippet(snippetType.value); snippetType.value = ''"
          >
            <option value="">Scegli un contenuto…</option>
            @for (type of blockTypes; track type) {
              <option [value]="type">{{ snippetLabels[type] }}</option>
            }
            @if (deletable() || insertable()) {
              <option value="npc_full">PNG a tutta pagina</option>
            }
            <option value="dialogo" [disabled]="!characters().length && !allowGeneric()">
              Dialogo
            </option>
            <option value="azione">Azione</option>
            <option value="nota">Fuori personaggio</option>
          </select>
          @if (characters().length) {
            <label [for]="fieldId + '-voice'">Personaggio</label>
            <select
              [id]="fieldId + '-voice'"
              [ngModel]="voice()"
              (ngModelChange)="voice.set(+$event)"
            >
              @for (c of characters(); track $index) {
                <option [ngValue]="$index">{{ c.name }}</option>
              }
            </select>
          }
          @if ((deletable() || insertable()) && npcLayout()) {
            <label [for]="fieldId + '-layout'">Formato PNG</label>
            <select [id]="fieldId + '-layout'" [ngModel]="npcLayout()" (ngModelChange)="setNpcLayout($event)">
              <option value="card">Scheda</option>
              <option value="full">A tutta pagina</option>
            </select>
          }
        </div>
        <label class="sr-only" [for]="fieldId">{{
          inserting() ? 'Testo del nuovo blocco' : 'Testo del blocco selezionato'
        }}</label>
        <textarea
          #inlineArea
          [id]="fieldId"
          rows="7"
          [ngModel]="draft()"
          (ngModelChange)="draft.set($event)"
          spellcheck="true"
        ></textarea>
        @if (draftParsed().errors.length) {
          <ul class="inline-message" role="status">
            @for (error of draftParsed().errors; track $index) {
              <li>{{ error.message }}</li>
            }
          </ul>
        }
        @if (message()) {
          <p class="inline-message" role="status">{{ message() }}</p>
        }
        <div class="inline-actions">
          <button
            type="button"
            [disabled]="!!deleting() || (inserting() && !draft().trim()) || draftParsed().errors.length > 0"
            (click)="apply()"
          >
            {{ inserting() ? 'Aggiungi al racconto' : 'Applica al testo' }}</button
          ><button type="button" (click)="cancel()">
            {{ inserting() ? 'Annulla aggiunta' : 'Annulla modifica rapida' }}</button
          ><button type="button" [attr.aria-pressed]="preview()" (click)="preview.set(!preview())">
            Anteprima di questa parte
          </button>
          @if (insertable() && !inserting() && !deleting()) {
            <button type="button" [disabled]="!canAddBeside()" (click)="addBeside('above')">Aggiungi sopra</button>
            <button type="button" [disabled]="!canAddBeside()" (click)="addBeside('below')">Aggiungi sotto</button>
          }
          @if (canDelete() && !deleting()) {
            <button type="button" class="delete-block" (click)="requestDelete()">
              {{ editing()?.ownerId || deletionScope() === 'partita' ? 'Elimina blocco' : 'Elimina dalla bozza' }}
            </button>
          }
        </div>
        @if (insertable() && !inserting() && !deleting() && !canAddBeside()) {
          <p class="inline-message" role="status">Applica o annulla le modifiche per aggiungere un altro blocco.</p>
        }
        @if (deleting()) {
          <div class="delete-confirm" role="alert">
            <p>Eliminare questo blocco {{ editing()?.ownerId || deletionScope() === 'partita' ? 'dalla partita' : 'dalla bozza' }}?</p>
            <button type="button" (click)="confirmDelete()">Elimina</button>
            <button type="button" (click)="cancelDelete()">Annulla</button>
          </div>
        }
        @if (preview()) {
          <div class="inline-preview">
            @for (section of draftParsed().sections; track section.id) {
              <ng-container
                *ngTemplateOutlet="content; context: { $implicit: section, canEdit: false }"
              />
            }
          </div>
        }
      </section>
    </ng-template>
    <ng-template #content let-section let-canEdit="canEdit">
      @switch (section.kind) {
        @case ('document') {
          <app-gdr-blocks [blocks]="section.blocks" (characterOpen)="openNpc($event)" />
        }
        @case ('dialogo') {
          <div class="dialogue">
            <div class="speaker">
              <button type="button" class="view-character portrait-trigger" aria-label="Apri scheda personaggio" (click)="openCharacter(section)">
              @if (section.portrait) {
                <img [src]="section.portrait" alt="" loading="lazy" />
              } @else {
                <span class="initial" aria-hidden="true">{{
                  section.speaker.slice(0, 1) || '?'
                }}</span>
              }
              </button>
              @if (canEdit) {
                <button type="button" class="edit-speaker" (click)="startEditing(section)">
                  {{ section.speaker || 'Personaggio' }} <span aria-hidden="true">✎</span>
                </button>
              } @else {
                <button type="button" class="view-character name-trigger" (click)="openCharacter(section)">{{ section.speaker || 'Personaggio' }}</button>
              }
            </div>
            <p>{{ section.text }}</p>
          </div>
        }
        @case ('azione') {
          @if (canEdit) {
            <button type="button" class="edit-start" (click)="startEditing(section)">
              ✎ Modifica azione
            </button>
          }
          <p class="action">{{ section.text }}</p>
        }
        @case ('nota') {
          @if (canEdit) {
            <button type="button" class="edit-start" (click)="startEditing(section)">
              ✎ Modifica nota
            </button>
          }
          <p class="note"><small>Fuori personaggio</small>{{ section.text }}</p>
        }
      }
    </ng-template>
  `,
  styles: `
    :host {
      display: block;
      overflow-wrap: anywhere;
    }
    .delete-confirm { margin: 0 .7rem .7rem; padding: .8rem; border: 1px solid var(--border-color); border-radius: .65rem; background: var(--panel-color); }
    .delete-confirm p { margin: 0 0 .6rem; font-size: .9rem; }
    .delete-confirm button { padding: .4rem .75rem; margin-right: .5rem; border: 1px solid var(--border-color); border-radius: .5rem; background: var(--button-bg); color: var(--text-color); font: inherit; cursor: pointer; }
    .dialogue {
      display: grid;
      grid-template-columns: 40px minmax(0, 1fr);
      column-gap: 0.7rem;
      row-gap: 0.15rem;
      align-items: start;
      margin: 1.5rem 0;
    }
    .speaker {
      display: contents;
      color: var(--accent-color);
      font-size: 0.9rem;
    }
    .view-character { background: transparent; border: 0; padding: 0; color: inherit; font: inherit; cursor: pointer; text-align: left; }
    .speaker > .portrait-trigger { grid-column: 1; grid-row: 1 / span 2; width:40px; height:40px; min-width:0; min-height:0; border-radius:50%; }
    .speaker > .name-trigger { grid-column:2; font-weight:600; line-height:1.4; }
    .character-backdrop { position:fixed; inset:0; z-index:1500; background:rgb(20 18 16 / .65); backdrop-filter:blur(6px); display:grid; place-items:center; padding:24px; }
    .character-modal { width:min(900px,100%); max-height:90dvh; overflow:auto; background:var(--bg-color, #f7f4ee); color:var(--text-color); border:1px solid var(--border-color); border-radius:20px; box-shadow:0 24px 80px #0005; }
    .character-modal header { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:20px 24px; border-bottom:1px solid var(--border-color); }
    .character-modal h2 { margin:0; font-size:1.4rem; }
    .character-modal header button { border:1px solid var(--border-color); background:transparent; color:inherit; border-radius:50%; width:36px; height:36px; padding:0; cursor:pointer; }
    .character-content { padding:24px; }
    .character-content.with-artwork { display:grid; grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr); gap:28px; align-items:start; }
    .character-info { min-width:0; }
    .character-summary h2 { align-self:center; overflow-wrap:anywhere; }
    .character-summary { display:grid; grid-template-columns:120px minmax(0,1fr); gap:24px; align-items:start; margin-bottom:24px; }
    .character-avatar-large { width:120px; height:120px; object-fit:cover; border-radius:50%; }
    .character-facts { display:flex; flex-wrap:wrap; gap:12px; margin:12px 0; }
    .character-facts > div { border:1px solid var(--border-color); border-radius:10px; padding:10px 14px; min-width:80px; }
    .character-facts dt { font-size:.8rem; color:var(--muted-color); }
    .character-facts dd { margin:4px 0 0; }
    @media(max-width:600px) { .character-summary { grid-template-columns:80px minmax(0,1fr); gap:16px; } .character-avatar-large { width:80px; height:80px; } }
    .character-images { display:flex; flex-direction:column; align-items:center; gap:16px; }
    .character-artwork { display:block; max-width:100%; max-height:72dvh; width:auto; height:auto; object-fit:contain; border-radius:12px; }
    .character-avatar { display:flex; align-items:center; gap:12px; color:var(--muted-color); font-size:.85rem; text-decoration:none; }
    .character-avatar img { width:56px; height:56px; border-radius:50%; object-fit:cover; }
    .character-details:empty { display:none; }
    .character-details h3 { font-size:1rem; margin:20px 0 6px; color:var(--accent-color); }
    .character-details p { margin:8px 0; }
    @media(max-width:600px) { .character-backdrop { padding:12px; } .character-content { padding:16px; } .character-content.with-artwork { display:flex; flex-direction:column; } .character-info { order:-1; width:100%; } }
    .speaker img,
    .initial {
      grid-column: 1;
      grid-row: 1 / span 2;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      object-fit: cover;
      flex: none;
    }
    .initial {
      display: grid;
      place-items: center;
      background: var(--input-bg);
    }
    p {
      white-space: pre-wrap;
      line-height: 1.8;
      margin: 0.6rem 0 1.2rem;
    }
    .speaker > strong,
    .edit-speaker {
      grid-column: 2;
      line-height: 1.4;
    }
    .dialogue p {
      grid-column: 2;
      margin: 0;
      line-height: 1.65;
    }
    .action {
      font-style: italic;
    }
    .note {
      color: var(--muted-color);
      font-size: 0.9rem;
    }
    .note small {
      display: block;
      font-weight: 600;
      margin-bottom: 0.3rem;
    }
    .edit-speaker,
    .edit-start {
      border: 0;
      background: transparent;
      color: var(--accent-color);
      font: inherit;
      text-align: left;
      cursor: pointer;
      padding: 0;
    }
    .edit-speaker {
      font-weight: 600;
    }
    .edit-start {
      font-size: 0.75rem;
    }
    .start-writing {
      margin-block: 1rem;
      border: 1px dashed var(--border-color);
      border-radius: .65rem;
      padding: .55rem 1rem;
      background: transparent;
      color: var(--text-color);
      font: inherit;
      cursor: pointer;
    }
    .inline-tools {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem;
      padding: 0.6rem 0.8rem;
      font-size: 0.8rem;
      border-bottom: 1px solid var(--border-color);
    }
    .inline-tools select {
      min-width: 0;
      max-width: 100%;
      border: 1px solid var(--border-color);
      border-radius: 5px;
      color: var(--text-color);
      background: var(--input-bg);
      font: inherit;
      padding: 0.4rem;
    }
    .inline-editor {
      border: 1px solid var(--accent-color);
      border-radius: 8px;
      background: var(--input-bg);
      margin: 1rem 0;
      overflow: hidden;
    }
    .inline-header {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem 1rem;
      padding: 0.7rem 0.8rem;
      border-bottom: 1px solid var(--border-color);
      font-size: 0.85rem;
    }
    .inline-header span {
      font-size: 0.8rem;
      color: var(--muted-color);
    }
    textarea {
      display: block;
      width: 100%;
      box-sizing: border-box;
      min-height: 160px;
      resize: vertical;
      border: 0;
      background: var(--input-bg);
      padding: 0.8rem;
      color: var(--text-color);
      font: inherit;
      font-family: ui-monospace, monospace;
      font-size: 0.86rem;
      line-height: 1.7;
    }
    .inline-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      padding: 0.6rem 0.7rem;
      border-top: 1px solid var(--border-color);
    }
    .inline-actions button {
      border: 1px solid var(--border-color);
      background: var(--button-bg);
      border-radius: 5px;
      color: var(--text-color);
      font: inherit;
      font-size: 0.8rem;
      min-height: 36px;
      padding: 0.35rem 0.6rem;
      cursor: pointer;
    }
    .inline-actions button:first-child {
      color: var(--accent-color);
    }
    .inline-actions .delete-block {
      margin-inline-start: auto;
      color: var(--danger-text-color);
    }
    .inline-preview {
      padding: 0.9rem;
      border-top: 1px solid var(--border-color);
      background: var(--panel-color);
    }
    .inline-message {
      font-size: 0.8rem;
      color: var(--danger-text-color);
      padding: 0 0.8rem;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
    button:focus-visible,
    textarea:focus-visible {
      outline: 2px solid var(--focus-color);
      outline-offset: -2px;
    }
  `,
})
export class GdrTurn {
  readonly source = input.required<string>();
  readonly editable = input(false);
  readonly editBlocks = input(true);
  readonly insertable = input(false);
  readonly deletable = input(false);
  readonly deletionScope = input<'bozza' | 'partita'>('bozza');
  readonly persistedBlocks = input<GdrBlockRow[]>([]);
  readonly sharedDocument = input(false);
  readonly deleteBlock = output<string>();
  readonly blockChange = output<{id:string;source:string}>();
  readonly insertBlock = output<{beforeId?:string;source:string}>();
  protected hasPublicInformation(character: NarrativeCharacter): boolean {
    const profile = character.profile;
    return profile
      ? [...this.identityFields, ...this.profileFields].some(field => (field.key === 'history' ? this.knownHistory(profile) : profile[field.key] ?? '').trim().length > 0)
      : !!character.description?.trim();
  }
  protected knownHistory(profile: import('../../core/gdr-workspace.service').CharacterProfile): string { return [profile.history, profile.personality].filter(Boolean).join('\n\n'); }
  protected readonly identityFields = PROFILE_FIELDS.filter(field => ['surname','race','age'].includes(field.key));
  protected readonly profileFields = PROFILE_FIELDS.filter(field => ['appearance','history'].includes(field.key));
  private findCharacter(roster: NarrativeCharacter[], id: string | undefined, name: string): NarrativeCharacter | undefined {
    const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
    return roster.find(c => !!id && c.id === id) ?? roster.find(c => normalize(c.name) === normalize(name) || (!!c.baseName && normalize(c.baseName) === normalize(name)));
  }
  protected openNpc(entry: import('../gdr-blocks/gdr-block.types').GdrNpcEntry): void {
    const roster = this.characterRoster().length ? this.characterRoster() : this.characters();
    const character = this.findCharacter(roster, entry.characterId, entry.name);
    this.viewedCharacter.set(character ?? {name:entry.name,portrait:'',photo:entry.image,description:entry.description});
  }
  protected openCharacter(section: NarrativeSection): void {
    const roster = this.characterRoster().length ? this.characterRoster() : this.characters();
    const character = this.findCharacter(roster, section.characterId, section.speaker);
    this.viewedCharacter.set(character ?? { name: section.speaker, portrait: section.portrait });
  }
  protected readonly viewedCharacter = signal<NarrativeCharacter | null>(null);
  readonly characterRoster = input<NarrativeCharacter[]>([]);
  readonly characters = input<NarrativeCharacter[]>([]);
  readonly allowGeneric = input(true);
  protected readonly blockTypes = BLOCK_TYPES;
  protected readonly snippetLabels = SNIPPET_LABELS;
  protected readonly voice = signal(0);
  readonly sourceChange = output<string>();
  readonly editingChange = output<boolean>();
  @ViewChild('inlineArea') private area?: ElementRef<HTMLTextAreaElement>;
  protected readonly fieldId = 'inline-' + crypto.randomUUID();
  protected readonly parsed = computed(() => parseNarrative(this.source()));
  protected readonly rawRendered = computed<RenderedSection[]>(() => {
    const originals = this.persistedBlocks().slice().sort((a,b)=>a.position-b.position);
    if (originals.length && serializeGdrBlocks(originals) === this.source()) {
      let offset = 0;
      return originals.flatMap<RenderedSection>(block => {
        const source = serializeGdrBlocks([block]), start = offset;
        offset += source.length + 2;
        const owner={ownerId:block.id,ownerStart:start,ownerEnd:start+source.length};
        if(block.type!=='paragraph' || (block.data as GdrParagraphData).format!=='gdr-narrative') {
          return [{kind:'document' as const,id:`stored-${block.id}`,text:'',speaker:'',portrait:'',blocks:[block],
            start,end:start+source.length,ranges:[{start,end:start+source.length,startLine:0,endLine:source.split('\n').length-1}],persistentId:block.id,...owner}];
        }
        const sections=parseNarrative(source).sections.flatMap(section=>section.kind==='document'?section.blocks.map((child,index)=>({...section,blocks:[child],ranges:[section.ranges[index]],start:section.ranges[index].start,end:section.ranges[index].end})): [section]);
        return sections.map((section,index) => ({
          ...section, id: `stored-${block.id}-${index}`,
          start: start + section.start, end: start + section.end,
          ...owner,
          ranges: section.ranges.map(range=>({...range,start:start+range.start,end:start+range.end})),
        }));
      });
    }
    return this.parsed().sections.flatMap((section) =>
          section.kind === 'document'
            ? section.blocks.map((block, i) => ({
                ...section,
                id: block.id,
                blocks: [block],
                ranges: [section.ranges[i]],
                start: section.ranges[i].start,
                end: section.ranges[i].end,
              }))
            : [section],
        );
  });
  protected readonly rendered = computed(() => {
    const roster = this.characterRoster().length ? this.characterRoster() : this.characters();
    const resolve = (id: string | undefined) => id ? roster.find(c => c.id === id) : undefined;
    return this.rawRendered().map(section => {
      if (section.kind === 'dialogo') {
        const character = resolve(section.characterId);
        return character ? {...section, speaker: character.name, portrait: safeNarrativeImage(character.portrait)} : section;
      }
      return {...section, blocks: section.blocks.map(block => {
        if (block.type !== 'npc_grid') return block;
        const data = block.data as import('../gdr-blocks/gdr-block.types').GdrNpcGridData;
        return {...block, data: {...data, entries: data.entries.map(entry => {
          const character = resolve(entry.characterId);
          return character ? {...entry, name: character.name, alt: entry.alt === entry.name ? character.name : entry.alt} : entry;
        })}};
      })};
    });
  });
  protected readonly deleting = signal<(Pick<RenderedSection, 'start' | 'end' | 'ownerId' | 'ownerStart' | 'ownerEnd' | 'persistentId'> & {snapshot:string}) | null>(null);
  protected readonly canDelete = computed(() => {
    const current = this.editing();
    return this.editable() && this.deletable() && !!current && !current.inserting &&
      (!this.persistedBlocks().length || !!current.ownerId);
  });
  constructor() {
    effect(()=>{
      const target=this.deleting();
      if(target && target.snapshot!==this.source()) this.cancelDelete();
    });
  }
  protected requestDelete(): void {
    const current = this.editing();
    if (!this.canDelete() || !current || current.snapshot !== this.source()) return;
    this.deleting.set({...current});
  }
  protected cancelDelete(): void { this.deleting.set(null); }
  protected confirmDelete(): void {
    const target=this.deleting();
    if (!target || target.snapshot !== this.source() || !this.editable() || !this.deletable()) return;
    if(target.ownerId && !target.persistentId) {
      const source=target.snapshot.slice(target.ownerStart!,target.start)+target.snapshot.slice(target.end,target.ownerEnd!);
      if(source.trim()) this.blockChange.emit({id:target.ownerId,source});
      else this.deleteBlock.emit(target.ownerId);
    } else if (target.persistentId) this.deleteBlock.emit(target.persistentId);
    else this.sourceChange.emit(target.snapshot.slice(0,target.start) + target.snapshot.slice(target.end));
    this.cancel();
  }
  protected readonly inserting = computed(() => this.editing()?.inserting === true);
  protected readonly draft = signal('');
  protected readonly draftParsed = computed(() => parseNarrative(this.draft()));
  protected readonly npcLayout = computed(() => {
    const parsed = this.draftParsed();
    if (parsed.errors.length || parsed.sections.length !== 1) return null;
    const section = parsed.sections[0];
    if (section.kind !== 'document' || section.blocks.length !== 1 || section.blocks[0].type !== 'npc_grid') return null;
    return (section.blocks[0].data as {layout?:'full'}).layout === 'full' ? 'full' : 'card';
  });
  protected setNpcLayout(layout: string): void {
    if (!this.editable() || (!this.deletable() && !this.insertable()) || !this.npcLayout() || !['card','full'].includes(layout)) return;
    const area = this.area?.nativeElement;
    if (!area) return;
    const current = this.draft(), next = current.replace(/^::: npc(?: full)?(?=\r?$)/m, layout === 'full' ? '::: npc full' : '::: npc');
    const delta = next.length - current.length;
    updateGdrTextarea(area, () => this.draft.set(next), Math.max(0, area.selectionStart + delta), Math.max(0, area.selectionEnd + delta));
  }
  protected readonly preview = signal(false);
  protected readonly message = signal('');
  protected readonly editing = signal<{
    start: number;
    end: number;
    snapshot: string;
    inserting?: boolean;
    anchor?: {start:number;end:number;side:'above'|'below'};
    persistentId?:string;
    ownerId?:string;
    ownerStart?:number;
    ownerEnd?:number;
  } | null>(null);
  protected isEditing(range: { start: number; end: number }): boolean {
    const current = this.editing();
    return (
      !!current && !current.inserting && current.start === range.start && current.end === range.end
    );
  }
  protected readonly canAddBeside = computed(() => {
    const current = this.editing();
    return this.editable() && this.insertable() && !!current && !current.inserting &&
      current.snapshot === this.source() && this.draft() === current.snapshot.slice(current.start, current.end);
  });
  protected isInsertingBeside(range: {start:number;end:number}, side: 'above'|'below'): boolean {
    const current = this.editing();
    return current?.inserting === true && current.anchor?.side === side &&
      current.anchor.start === range.start && current.anchor.end === range.end;
  }
  protected addBeside(side: 'above'|'below'): void {
    const current = this.editing();
    if (!current || !this.canAddBeside() || this.deleting()) return;
    this.editing.set(null);
    this.startInserting(side === 'above' ? current.start : current.end, {start:current.start,end:current.end,side});
  }
  protected startInserting(offset: number, anchor?: {start:number;end:number;side:'above'|'below'}): void {
    if (!this.editable() || !this.insertable() || this.editing() || this.deleting()) return;
    const owner=this.rendered().find(section=>section.ownerId && offset>section.ownerStart! && offset<section.ownerEnd!);
    this.editing.set({ start: offset, end: offset, snapshot: this.source(), inserting: true,anchor,...(owner?{ownerId:owner.ownerId,ownerStart:owner.ownerStart,ownerEnd:owner.ownerEnd}:{}) });
    this.draft.set('');
    this.preview.set(false);
    this.message.set('');
    this.editingChange.emit(true);
    requestAnimationFrame(() => this.area?.nativeElement.focus({ preventScroll: true }));
  }
  protected insertSnippet(type: string): void {
    const area = this.area?.nativeElement;
    if (type === 'npc_full' && !this.deletable() && !this.insertable()) return;
    if (!area || !type || (type === 'dialogo' && !this.characters().length && !this.allowGeneric()))
      return;
    const start = area.selectionStart,
      end = area.selectionEnd;
    const snippet = narrativeSnippet(
      type,
      this.draft().slice(start, end),
      this.characters()[this.voice()] ?? this.characters()[0],
    );
    if (!snippet) {
      if (type === 'npc_grid' || type === 'npc_full') this.message.set('Scegli un PNG con una foto completa nel menu Personaggio.');
      return;
    }
    this.message.set('');
    const replacement = replaceNarrativeSelection(this.draft(), start, end, snippet);
    updateGdrTextarea(area, () => this.draft.set(replacement.source), replacement.start, replacement.end);
  }

  public startEditing(range: { start: number; end: number; ownerId?:string; ownerStart?:number; ownerEnd?:number }): void {
    if (!this.editable() || !this.editBlocks() || !range || this.deleting()) return;
    if (this.editing()) {
      this.message.set('Applica o annulla questa modifica prima di aprirne un’altra.');
      return;
    }
    const section = this.rendered().find(section => section.start === range.start && section.end === range.end);
    this.editing.set({ ...section, ...range, snapshot: this.source() });
    this.draft.set(this.source().slice(range.start, range.end));
    this.preview.set(false);
    this.message.set('');
    this.editingChange.emit(true);
    requestAnimationFrame(() => this.area?.nativeElement.focus({ preventScroll: true }));
  }
  protected apply(): void {
    const current = this.editing();
    if (!current || this.deleting() || (current.inserting && !this.draft().trim()) || this.draftParsed().errors.length)
      return;
    if (current.snapshot !== this.source()) {
      this.message.set(
        'Il documento è cambiato. Copia la modifica, annulla e riapri questo punto.',
      );
      return;
    }
    if(current.ownerId) {
      const source=current.inserting?insertNarrativeBlock(current.snapshot.slice(current.ownerStart,current.ownerEnd),current.start-current.ownerStart!,this.draft()):current.snapshot.slice(current.ownerStart!,current.start)+this.draft()+current.snapshot.slice(current.end,current.ownerEnd!);
      if(!source.trim()) {this.message.set('Per rimuovere il blocco usa Elimina blocco.');return;}
      this.blockChange.emit({id:current.ownerId,source});this.cancel();return;
    }
    if(current.inserting && (this.persistedBlocks().length || this.sharedDocument())) {
      const before=this.rendered().find(section=>section.ownerStart!>=current.start);
      this.insertBlock.emit({beforeId:before?.ownerId,source:this.draft()});this.cancel();return;
    }
    this.sourceChange.emit(
      current.inserting
        ? insertNarrativeBlock(current.snapshot, current.start, this.draft())
        : current.snapshot.slice(0, current.start) +
            this.draft() +
            current.snapshot.slice(current.end),
    );
    this.cancel();
  }
  protected cancel(): void {
    this.deleting.set(null);
    this.editing.set(null);
    this.editingChange.emit(false);
    this.message.set('');
  }
}
