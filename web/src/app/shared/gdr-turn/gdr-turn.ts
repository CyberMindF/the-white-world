import { Component, ElementRef, ViewChild, computed, input, output, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GdrBlocks } from '../gdr-blocks/gdr-blocks';
import { BLOCK_TYPES, SNIPPET_LABELS } from '../gdr-blocks/gdr-snippets';
import { NarrativeCharacter, insertNarrativeBlock, narrativeSnippet } from './gdr-writing';
import { parseNarrative } from './gdr-turn.parser';

@Component({
  selector: 'app-gdr-turn',
  standalone: true,
  imports: [GdrBlocks, FormsModule, NgTemplateOutlet],
  template: `
    @for (section of rendered(); track section.id; let sectionIndex = $index) {
      @if (editable() && insertable()) {
        <ng-container
          *ngTemplateOutlet="
            insertionPoint;
            context: {
              offset: section.start,
              label: 'Aggiungi prima del blocco ' + (sectionIndex + 1),
            }
          "
        />
      }
      @if (isEditing(section)) {
        <ng-container *ngTemplateOutlet="inlineEditor" />
      } @else if (section.kind === 'document' && editable()) {
        <app-gdr-blocks
          [blocks]="section.blocks"
          [editable]="true"
          [continuation]="sectionIndex > 0"
          (editBlock)="startEditing(section)"
        />
      } @else {
        <ng-container
          *ngTemplateOutlet="content; context: { $implicit: section, canEdit: editable() }"
        />
      }
    }
    @if (editable() && insertable()) {
      <ng-container
        *ngTemplateOutlet="
          insertionPoint;
          context: {
            offset: source().length,
            label: rendered().length ? 'Aggiungi alla fine' : 'Inizia a scrivere',
            empty: !rendered().length,
          }
        "
      />
    }
    <ng-template #insertionPoint let-offset="offset" let-label="label" let-empty="empty">
      @if (isInserting(offset)) {
        <ng-container *ngTemplateOutlet="inlineEditor" />
      } @else {
        <div class="insertion-point" [class.is-empty]="empty">
          <button
            type="button"
            [attr.aria-label]="label"
            [title]="label"
            [disabled]="!!editing()"
            (click)="startInserting(offset)"
          >
            <span aria-hidden="true">＋</span>
            @if (empty) {
              <span>Inizia a scrivere</span>
            }
          </button>
        </div>
      }
    </ng-template>
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
            [disabled]="(inserting() && !draft().trim()) || draftParsed().errors.length > 0"
            (click)="apply()"
          >
            {{ inserting() ? 'Aggiungi al racconto' : 'Applica al testo' }}</button
          ><button type="button" (click)="cancel()">
            {{ inserting() ? 'Annulla aggiunta' : 'Annulla modifica rapida' }}</button
          ><button type="button" [attr.aria-pressed]="preview()" (click)="preview.set(!preview())">
            Anteprima di questa parte
          </button>
        </div>
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
          <app-gdr-blocks [blocks]="section.blocks" />
        }
        @case ('dialogo') {
          <div class="dialogue">
            <div class="speaker">
              @if (section.portrait) {
                <img [src]="section.portrait" alt="" loading="lazy" />
              } @else {
                <span class="initial" aria-hidden="true">{{
                  section.speaker.slice(0, 1) || '?'
                }}</span>
              }
              @if (canEdit) {
                <button type="button" class="edit-speaker" (click)="startEditing(section)">
                  {{ section.speaker || 'Personaggio' }} <span aria-hidden="true">✎</span>
                </button>
              } @else {
                <strong>{{ section.speaker || 'Personaggio' }}</strong>
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
    .dialogue {
      margin: 1.5rem 0;
    }
    .speaker {
      display: flex;
      align-items: center;
      gap: 0.7rem;
      color: var(--accent-color);
      font-size: 0.9rem;
    }
    .speaker img,
    .initial {
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
    .dialogue p {
      margin-left: calc(40px + 0.7rem);
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
    .insertion-point {
      display: flex;
      justify-content: flex-start;
      position: relative;
      height: 1.25rem;
    }
    .insertion-point button {
      position: absolute;
      left: 0.15rem;
      top: 50%;
      transform: translateY(-50%);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      width: 1.8rem;
      height: 1.8rem;
      padding: 0;
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: var(--muted-color);
      font: inherit;
      font-size: 0.78rem;
      opacity: 0.62;
      cursor: pointer;
    }
    .insertion-point button:hover,
    .insertion-point button:focus-visible {
      background: var(--button-hover-bg);
      color: var(--accent-color);
      opacity: 1;
    }
    .insertion-point button:disabled {
      opacity: 0.35;
      cursor: default;
    }
    .insertion-point.is-empty {
      height: auto;
      justify-content: flex-start;
      margin-block: 1rem;
    }
    .insertion-point.is-empty button {
      position: static;
      transform: none;
      width: auto;
      height: auto;
      border: 1px dashed var(--border-color);
      padding: 0.55rem 1rem;
      opacity: 1;
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
  readonly insertable = input(false);
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
  protected readonly rendered = computed(() =>
    this.editable()
      ? this.parsed().sections.flatMap((section) =>
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
        )
      : this.parsed().sections,
  );
  protected readonly inserting = computed(() => this.editing()?.inserting === true);
  protected readonly draft = signal('');
  protected readonly draftParsed = computed(() => parseNarrative(this.draft()));
  protected readonly preview = signal(false);
  protected readonly message = signal('');
  protected readonly editing = signal<{
    start: number;
    end: number;
    snapshot: string;
    inserting?: boolean;
  } | null>(null);
  protected isEditing(range: { start: number; end: number }): boolean {
    const current = this.editing();
    return (
      !!current && !current.inserting && current.start === range.start && current.end === range.end
    );
  }
  protected isInserting(offset: number): boolean {
    return this.editing()?.inserting === true && this.editing()?.start === offset;
  }
  protected startInserting(offset: number): void {
    if (!this.editable() || !this.insertable() || this.editing()) return;
    this.editing.set({ start: offset, end: offset, snapshot: this.source(), inserting: true });
    this.draft.set('');
    this.preview.set(false);
    this.message.set('');
    this.editingChange.emit(true);
    requestAnimationFrame(() => this.area?.nativeElement.focus({ preventScroll: true }));
  }
  protected insertSnippet(type: string): void {
    const area = this.area?.nativeElement;
    if (!area || !type || (type === 'dialogo' && !this.characters().length && !this.allowGeneric()))
      return;
    const start = area.selectionStart,
      end = area.selectionEnd;
    const snippet = narrativeSnippet(
      type,
      this.draft().slice(start, end),
      this.characters()[this.voice()] ?? this.characters()[0],
    );
    if (!snippet) return;
    this.draft.set(
      insertNarrativeBlock(this.draft().slice(0, start) + this.draft().slice(end), start, snippet),
    );
    requestAnimationFrame(() => {
      area.focus({ preventScroll: true });
      const position = area.value.indexOf(snippet, start);
      area.setSelectionRange(position, position + snippet.length);
    });
  }
  public startEditing(range: { start: number; end: number }): void {
    if (!this.editable() || !range) return;
    if (this.editing()) {
      this.message.set('Applica o annulla questa modifica prima di aprirne un’altra.');
      return;
    }
    this.editing.set({ ...range, snapshot: this.source() });
    this.draft.set(this.source().slice(range.start, range.end));
    this.preview.set(false);
    this.message.set('');
    this.editingChange.emit(true);
    requestAnimationFrame(() => this.area?.nativeElement.focus({ preventScroll: true }));
  }
  protected apply(): void {
    const current = this.editing();
    if (!current || (current.inserting && !this.draft().trim()) || this.draftParsed().errors.length)
      return;
    if (current.snapshot !== this.source()) {
      this.message.set(
        'Il documento è cambiato. Copia la modifica, annulla e riapri questo punto.',
      );
      return;
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
    this.editing.set(null);
    this.editingChange.emit(false);
    this.message.set('');
  }
}
