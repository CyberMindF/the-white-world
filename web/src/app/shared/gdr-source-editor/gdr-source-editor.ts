import { Component, ElementRef, computed, effect, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { updateGdrTextarea } from '../gdr-textarea';
import { GdrTurn } from '../gdr-turn/gdr-turn';
import { parseNarrative, safeNarrativeImage } from '../gdr-turn/gdr-turn.parser';
import { BLOCK_TYPES, SNIPPET_LABELS } from '../gdr-blocks/gdr-snippets';
import { GdrImageLibrary, GdrLibraryImage } from '../gdr-characters/gdr-image-library';

import { NarrativeCharacter, narrativeSnippet, replaceNarrativeSelection } from '../gdr-turn/gdr-writing';
export type { NarrativeCharacter } from '../gdr-turn/gdr-writing';
@Component({
  selector: 'app-gdr-source-editor',
  standalone: true,
  imports: [FormsModule, GdrTurn, GdrImageLibrary],
  templateUrl: './gdr-source-editor.html',
  styleUrl: './gdr-source-editor.css',
})
export class GdrSourceEditor {
  readonly source = input.required<string>();
  readonly sourceChange = output<string>();
  readonly editingChange = output<boolean>();
  readonly modeChange = output<'split' | 'source' | 'preview'>();
  readonly label = input('Il tuo turno');
  readonly document = input(false);
  readonly masterTools = input(false);
  readonly images = input<GdrLibraryImage[]>([]);
  readonly allowGeneric = input(true);
  readonly allowImages = input(false);
  readonly characters = input<NarrativeCharacter[]>([]);
  readonly editorId = input('gdr-source');
  protected readonly inlineEditing = signal(false);
  protected readonly mode = signal<'split' | 'source' | 'preview'>('source');
  protected readonly characterIndex = signal(0);
  protected readonly voiceMessage = signal('');
  protected readonly imagePickerOpen = signal(false);
  private readonly sourceArea = viewChild<ElementRef<HTMLTextAreaElement>>('sourceArea');
  private readonly previewPane = viewChild<ElementRef<HTMLElement>>('previewPane');
  private scrollDriver: 'source' | 'preview' = 'source';
  private readonly syncedPositions = new WeakMap<HTMLElement, number>();
  private readonly parsed = computed(() => parseNarrative(this.source()));
  protected readonly errors = computed(() => this.parsed().errors);
  protected readonly recognized = computed(() =>
    this.parsed().sections.reduce((n, s) => n + (s.kind === 'document' ? s.blocks.length : 1), 0),
  );
  protected readonly blockTypes = BLOCK_TYPES;
  protected readonly snippetLabels = SNIPPET_LABELS;

  constructor() {
    effect(() => {
      if (this.mode() === 'preview' && !this.source().trim() && !this.inlineEditing()) this.mode.set('source');
      this.modeChange.emit(this.mode());
    });
    effect(() => {
      if (this.characterIndex() >= this.characters().length) this.characterIndex.set(0);
    });
    effect(() => {
      this.source();
      if (this.mode() === 'split' && this.previewPane())
        requestAnimationFrame(() => this.syncScroll('source', true));
    });
  }
  protected setMode(mode: 'split' | 'source' | 'preview'): void {
    const area = this.sourceArea()?.nativeElement, preview = this.previewPane()?.nativeElement;
    if (area) this.syncedPositions.delete(area);
    if (preview) this.syncedPositions.delete(preview);
    this.scrollDriver = 'source';
    this.mode.set(mode);
  }
  protected setScrollDriver(origin: 'source' | 'preview'): void {
    this.scrollDriver = origin;
  }
  protected syncScroll(origin: 'source' | 'preview', force = false): void {
    if (this.mode() !== 'split' || (!force && origin !== this.scrollDriver)) return;
    const area = this.sourceArea()?.nativeElement, preview = this.previewPane()?.nativeElement;
    if (!area || !preview) return;
    const from = origin === 'source' ? area : preview, to = origin === 'source' ? preview : area;
    // Ignora l’evento generato dal pannello che abbiamo appena spostato: evita rimbalzi.
    const programmed = this.syncedPositions.get(from);
    if (programmed !== undefined) {
      this.syncedPositions.delete(from);
      if (!force && Math.abs(from.scrollTop - programmed) < 1) return;
    }
    const sourceRange = from.scrollHeight - from.clientHeight;
    const targetRange = to.scrollHeight - to.clientHeight;
    const top = sourceRange > 0 ? from.scrollTop / sourceRange * Math.max(0, targetRange) : 0;
    if (Math.abs(to.scrollTop - top) < 1) return;
    to.scrollTop = top;
    this.syncedPositions.set(to, to.scrollTop);
  }
  public openPreview(): void {
    if (this.source().trim() && !this.inlineEditing()) this.setMode('preview');
  }
  protected insertImage(src: string, area: HTMLTextAreaElement): void {
    if (!this.allowImages() || !safeNarrativeImage(src)) return;
    const label = (this.images().find(image => image.src === src)?.label || 'Immagine')
      .replace(/[\[\]\r\n"]/g, ' ');
    this.insert('image', area, `![${label}](${src})`);
    this.imagePickerOpen.set(false);
  }
  protected insert(type: string, area: HTMLTextAreaElement, customSnippet?: string): void {
    if (type === 'image' && !this.allowImages()) return;
    if ((type !== 'image' && BLOCK_TYPES.includes(type as typeof BLOCK_TYPES[number])) || type === 'subtitle' || type === 'emphasis' || type === 'npc_full') {
      if (!this.document() && !this.masterTools()) return;
    }
    if (this.inlineEditing()) {
      this.voiceMessage.set('Applica prima la modifica rapida.');
      return;
    }
    if (type === 'image' && !customSnippet) {
      this.imagePickerOpen.update(value => !value);
      return;
    }
    const text = this.source();
    const start = area.selectionStart ?? text.length;
    const end = area.selectionEnd ?? start;
    const selected = text.slice(start, end);
    const character = this.characters()[this.characterIndex()] ?? this.characters()[0];
    if (type === 'dialogo' && !character && !this.allowGeneric()) return;
    const snippet = customSnippet ?? narrativeSnippet(type, selected, character);
    if (!snippet) {
      if (type === 'npc_grid' || type === 'npc_full') this.voiceMessage.set('Scegli un PNG con una foto completa nel menu Personaggio.');
      return;
    }
    this.voiceMessage.set('');
    const replacement = replaceNarrativeSelection(text, start, end, snippet);
    const fenced = ['dialogo', 'azione', 'nota', 'callout'].includes(type);
    const heading = type === 'heading' || type === 'subtitle';
    const contentOffset = fenced ? snippet.indexOf('\n') + 1 : heading ? snippet.indexOf(' ') + 1 : type === 'emphasis' ? 1 : 0;
    const contentLength = fenced ? snippet.lastIndexOf('\n') - contentOffset : type === 'emphasis' ? snippet.length - 2 : snippet.length - contentOffset;
    updateGdrTextarea(area, () => {
      this.sourceChange.emit(replacement.source);
      this.setMode(this.mode() === 'preview' ? 'split' : this.mode());
    }, replacement.start + contentOffset, replacement.start + contentOffset + contentLength);
  }
}
