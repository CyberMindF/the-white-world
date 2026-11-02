import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { updateGdrTextarea } from '../gdr-textarea';
import { replaceNarrativeSelection } from '../gdr-turn/gdr-writing';
import { AuthService } from '../../core/auth.service';
import { GdrBlocksService } from '../../core/gdr-blocks.service';
import { GdrBlocks } from './gdr-blocks';
import { GdrBlockRow, GdrBlockType, GdrDocumentKey } from './gdr-block.types';
import { GdrParseError, parseGdrMarkdown } from './gdr-markdown.parser';
import { serializeGdrBlocks } from './gdr-markdown.serializer';

import { SNIPPETS, SNIPPET_LABELS, BLOCK_TYPES } from './gdr-snippets';

// Editor amministrativo condiviso dei documenti del GDR, stile Homebrewery: un unico campo di
// testo con sintassi leggera (gdr-markdown.parser.ts) invece di un blocco = un form JSON, con
// anteprima live ottenuta riusando GdrBlocks (nessun renderer parallelo). Usato identico da
// Avventura, La Tua Maga e La casa che trattiene il respiro, cambia solo `documentKey`.
@Component({
  selector: 'app-gdr-document-editor',
  standalone: true,
  imports: [FormsModule, GdrBlocks],
  styleUrls: ['./gdr-document-editor.css'],
  templateUrl: './gdr-document-editor.html'
})
export class GdrDocumentEditor implements OnInit {
  @Input({ required: true }) documentKey!: GdrDocumentKey;

  private readonly gdrBlocks = inject(GdrBlocksService);
  protected readonly authService = inject(AuthService);

  protected readonly canEdit = computed(() => this.authService.isAdmin() && this.authService.adminModeEnabled());
  protected readonly panelOpen = signal(false);
  protected readonly blockTypes = BLOCK_TYPES;
  protected readonly snippetLabels = SNIPPET_LABELS;

  private readonly rawBlocks = signal<GdrBlockRow[]>([]);
  protected readonly sourceText = signal('');
  protected readonly saving = signal(false);
  protected readonly saveError = signal('');

  private readonly parsed = computed(() => parseGdrMarkdown(this.sourceText()));
  protected readonly parseErrors = computed<GdrParseError[]>(() => this.parsed().errors);
  protected readonly previewBlocks = computed<GdrBlockRow[]>(() =>
    this.parsed().blocks.map((block, index) => ({
      id: `preview-${index}`,
      documentKey: this.documentKey,
      type: block.type,
      data: block.data as GdrBlockRow['data'],
      position: index
    }))
  );

  ngOnInit(): void {
    // Non carica subito: il pannello parte chiuso, come Cruciverba/Mappa.
  }

  protected togglePanel(): void {
    const next = !this.panelOpen();
    this.panelOpen.set(next);
    if (next && this.rawBlocks().length === 0) {
      void this.load();
    }
  }

  private async load(): Promise<void> {
    try {
      const blocks = await this.gdrBlocks.list();
      this.rawBlocks.set(blocks);
      const own = blocks.filter((block) => block.documentKey === this.documentKey).sort((a, b) => a.position - b.position);
      this.sourceText.set(serializeGdrBlocks(own));
    } catch (error) {
      console.error('Errore nel caricamento dei blocchi del GDR:', error);
    }
  }

  protected updateSourceText(value: string): void {
    this.sourceText.set(value);
    this.saveError.set('');
  }

  // Scroll sincronizzato tra testo sorgente e anteprima (split-view stile Homebrewery): scorrono
  // insieme in proporzione, non riga per riga (i due contenuti hanno lunghezze diverse). La
  // guardia evita il loop infinito source→preview→source innescato dall'evento scroll che lo
  // scorrimento programmatico stesso genera sull'altro elemento.
  private syncingScroll = false;

  protected syncScroll(source: HTMLElement, target: HTMLElement): void {
    if (this.syncingScroll) return;
    this.syncingScroll = true;
    const sourceRange = source.scrollHeight - source.clientHeight;
    const targetRange = target.scrollHeight - target.clientHeight;
    if (sourceRange > 0 && targetRange > 0) {
      target.scrollTop = (source.scrollTop / sourceRange) * targetRange;
    }
    requestAnimationFrame(() => {
      this.syncingScroll = false;
    });
  }

  protected insertSnippet(type: GdrBlockType, textarea: HTMLTextAreaElement): void {
    const snippet = SNIPPETS[type];
    const current = this.sourceText();
    const start = textarea.selectionStart ?? current.length;
    const end = textarea.selectionEnd ?? current.length;
    const replacement = replaceNarrativeSelection(current, start, end, snippet);
    updateGdrTextarea(textarea, () => {
      this.sourceText.set(replacement.source);
      this.saveError.set('');
    }, replacement.end, replacement.end);
  }

  protected async save(): Promise<void> {
    if (this.parseErrors().length > 0 || this.saving()) return;

    this.saving.set(true);
    this.saveError.set('');
    try {
      const existing = this.rawBlocks().filter((block) => block.documentKey === this.documentKey);
      await Promise.all(existing.map((block) => this.gdrBlocks.remove(block.id)));

      for (const block of this.parsed().blocks) {
        const ok = await this.gdrBlocks.create(this.documentKey, block.type, block.data);
        if (!ok) {
          this.saveError.set('Salvataggio incompleto, alcuni blocchi potrebbero mancare. Ricarica per verificare.');
          break;
        }
      }
    } catch (error) {
      console.error('Errore nel salvataggio dei blocchi del GDR:', error);
      this.saveError.set('Salvataggio incompleto, alcuni blocchi potrebbero mancare. Ricarica per verificare.');
    } finally {
      await this.load();
      this.saving.set(false);
    }
  }
}
