import { Component, Input, Output, EventEmitter, inject, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { renderInlineLinks } from '../inline-text';
import {
  GdrBlockRow,
  GdrCalloutData,
  GdrHeadingData,
  GdrImageData,
  GdrListData,
  GdrNpcGridData,
  GdrParagraphData,
  GdrTableData,
} from './gdr-block.types';

// Rendering pubblico dei documenti del GDR "Il Prezzo della Verità" (Avventura, La Tua Maga —
// solo le sezioni Abilità/Effetti/Incantesimi). Componente condiviso invece di duplicare lo
// stesso @switch in due pagine (documentazione/cms/planning-editor-contenuti.md, Fase 7). I nomi di classe
// riprendono quelli storici di avventura.html/tavolo.css (avventura-figure, npc-grid,
// npc-card, avventura-callout, maga-list, wild-table) ma vivono nel CSS di questo componente,
// non più in tavolo.css: l'incapsulamento di Angular non farebbe comunque arrivare stili
// scoped a un componente figlio diverso.
@Component({
  selector: 'app-gdr-blocks',
  standalone: true,
  styleUrls: ['./gdr-blocks.css'],
  host: { style: 'display: contents' },
  templateUrl: './gdr-blocks.html',
})
export class GdrBlocks {
  @Input() blocks: GdrBlockRow[] = [];
  @Input() editable = false;
  @Input() continuation = false;
  @Output() editBlock = new EventEmitter<number>();

  @Output() characterOpen = new EventEmitter<import('./gdr-block.types').GdrNpcEntry>();
  protected readonly preview = signal<{src:string;alt:string}|null>(null);
  protected openNpc(entry: import('./gdr-block.types').GdrNpcEntry): void {
    if (this.characterOpen.observed) this.characterOpen.emit(entry);
    else this.preview.set({src:entry.image,alt:entry.name});
  }
  private readonly sanitizer = inject(DomSanitizer);

  protected asHeading(data: unknown): GdrHeadingData {
    return data as GdrHeadingData;
  }

  protected asParagraph(data: unknown): GdrParagraphData {
    return data as GdrParagraphData;
  }

  protected asCallout(data: unknown): GdrCalloutData {
    return data as GdrCalloutData;
  }

  protected asImage(data: unknown): GdrImageData {
    return data as GdrImageData;
  }

  protected asNpcGrid(data: unknown): GdrNpcGridData {
    return data as GdrNpcGridData;
  }

  protected asList(data: unknown): GdrListData {
    return data as GdrListData;
  }

  protected asTable(data: unknown): GdrTableData {
    return data as GdrTableData;
  }

  protected renderInline(text: string): SafeHtml {
    return renderInlineLinks(this.sanitizer, text);
  }
}
