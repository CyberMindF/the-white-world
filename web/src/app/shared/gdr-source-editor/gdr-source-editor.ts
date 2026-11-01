import { Component, computed, effect, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GdrTurn } from '../gdr-turn/gdr-turn';
import { parseNarrative } from '../gdr-turn/gdr-turn.parser';
import { BLOCK_TYPES, SNIPPET_LABELS } from '../gdr-blocks/gdr-snippets';

import { NarrativeCharacter, narrativeSnippet } from '../gdr-turn/gdr-writing';
export type { NarrativeCharacter } from '../gdr-turn/gdr-writing';
@Component({
  selector: 'app-gdr-source-editor',
  standalone: true,
  imports: [FormsModule, GdrTurn],
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
  readonly allowGeneric = input(true);
  readonly allowImages = input(false);
  readonly characters = input<NarrativeCharacter[]>([]);
  readonly editorId = input('gdr-source');
  protected readonly inlineEditing = signal(false);
  protected readonly mode = signal<'split' | 'source' | 'preview'>('source');
  protected readonly characterIndex = signal(0);
  protected readonly voiceMessage = signal('');
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
  }
  public openPreview(): void {
    if (this.source().trim() && !this.inlineEditing()) this.mode.set('preview');
  }
  protected insert(type: string, area: HTMLTextAreaElement): void {
    if (type === 'image' && !this.allowImages()) return;
    if (this.inlineEditing()) {
      this.voiceMessage.set('Applica prima la modifica rapida.');
      return;
    }
    const text = this.source();
    const start = area.selectionStart ?? text.length;
    const end = area.selectionEnd ?? start;
    const selected = text.slice(start, end);
    const character = this.characters()[this.characterIndex()] ?? this.characters()[0];
    if (type === 'dialogo' && !character && !this.allowGeneric()) return;
    const snippet = narrativeSnippet(type, selected, character);
    if (!snippet) return;
    const prefix =
      start && !text.slice(0, start).endsWith('\n\n')
        ? text[start - 1] === '\n'
          ? '\n'
          : '\n\n'
        : '';
    const suffix =
      end < text.length && !text.slice(end).startsWith('\n\n')
        ? text[end] === '\n'
          ? '\n'
          : '\n\n'
        : '\n\n';
    const insertion = prefix + snippet + suffix;
    this.sourceChange.emit(text.slice(0, start) + insertion + text.slice(end));
    this.mode.set(this.mode() === 'preview' ? 'split' : this.mode());
    // Angular applica il nuovo valore prima di ripristinare focus e selezione.
    requestAnimationFrame(() => {
      area.focus();
      const contentOffset =
        type === 'dialogo' || type === 'azione' || type === 'nota' ? snippet.indexOf('\n') + 1 : 0;
      const contentLength =
        selected.length ||
        (contentOffset ? snippet.lastIndexOf('\n') - contentOffset : snippet.length);
      area.setSelectionRange(
        start + prefix.length + contentOffset,
        start + prefix.length + contentOffset + contentLength,
      );
    });
  }
}
