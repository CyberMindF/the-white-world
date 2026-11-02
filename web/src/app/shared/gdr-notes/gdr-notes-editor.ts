import { AfterViewInit, Component, ElementRef, Input, OnDestroy, SecurityContext, ViewChild, signal } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';

const SAVE_DEBOUNCE_MS = 800;

export const NOTE_TEXT_COLORS = [
  { value: 'inherit', label: 'Predefinito' },
  { value: '#f0dbb3', label: 'Oro' },
  { value: '#e28b8b', label: 'Rosso' },
  { value: '#8fc98f', label: 'Verde' },
  { value: '#8fb8e0', label: 'Azzurro' }
];

// Estratto da i-tuoi-appunti (autosalvataggio con debounce, /api/gdr/notes) per poterlo
// riusare anche dentro il pannello di gioco (GdrPanel), non solo sulla pagina dedicata di
// "Il Prezzo della Verità" — stessa logica, parametrizzata da `adventure` invece di una
// costante fissa. Diventato un editor "rich text" leggero (contenteditable + document.
// execCommand per grassetto/sottolineato/colore) su richiesta di Rory: il testo salvato ora è
// HTML, non più testo semplice. Il contenuto arriva da un servizio di sola scrittura tra due
// account fidati, ma viene comunque passato da DomSanitizer prima di finire nel DOM — non è
// mai bypassata la sanitizzazione di Angular, anche se qui si scrive a sé stessi.
@Component({
  selector: 'app-gdr-notes-editor',
  standalone: true,
  imports: [],
  templateUrl: './gdr-notes-editor.html',
  styleUrl: './gdr-notes-editor.css'
})
export class GdrNotesEditor implements AfterViewInit, OnDestroy {
  @Input({ required: true }) adventure!: string;
  @Input() readOnly = false;
  @ViewChild('editorEl') private readonly editorEl!: ElementRef<HTMLDivElement>;

  protected readonly disabled = signal(true);
  protected readonly statusMessage = signal('Sto caricando i tuoi appunti...');
  protected readonly colors = NOTE_TEXT_COLORS;
  protected readonly loadFailed = signal(false);
  protected readonly saveFailed = signal(false);

  private saveTimeout: ReturnType<typeof setTimeout> | null = null;
  private saveQueue: Promise<void> = Promise.resolve();
  private changeVersion = 0;
  private destroyed = false;

  constructor(private readonly domSanitizer: DomSanitizer) {}

  async ngAfterViewInit(): Promise<void> {
    await this.loadNotes();
  }

  ngOnDestroy(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
      void this.saveNotes();
    }
    this.destroyed = true;
  }

  protected async loadNotes(): Promise<void> {
    this.disabled.set(true);
    this.loadFailed.set(false);
    this.statusMessage.set('Sto caricando i tuoi appunti...');

    try {
      const response = await fetch(`/api/gdr/notes?adventure=${encodeURIComponent(this.adventure)}`, { credentials: 'same-origin' });
      if (!response.ok) {
        throw new Error(`Caricamento fallito: ${response.status}`);
      }
      const data = (await response.json()) as { body?: string };
      if (this.destroyed) return;
      const safe = this.domSanitizer.sanitize(SecurityContext.HTML, data.body || '') || '';
      this.editorEl.nativeElement.innerHTML = safe;
      this.statusMessage.set('');
      this.disabled.set(false);
    } catch (error) {
      console.error('Errore nel caricamento degli appunti:', error);
      this.statusMessage.set('Non è stato possibile caricare gli appunti salvati.');
      this.loadFailed.set(true);
    }
  }

  protected onInput(): void {
    if (this.readOnly || this.disabled()) return;
    this.changeVersion++;
    this.saveFailed.set(false);
    this.statusMessage.set('Sto salvando...');
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => {
      this.saveTimeout = null;
      void this.saveNotes();
    }, SAVE_DEBOUNCE_MS);
  }

  // mousedown con preventDefault, non click: altrimenti il contenteditable perde il focus (e
  // quindi la selezione di testo) prima che il comando di formattazione venga eseguito.
  protected preserveSelection(event: MouseEvent): void {
    event.preventDefault();
  }

  protected applyBold(): void {
    if (this.readOnly || this.disabled()) return;
    document.execCommand('bold');
    this.onInput();
  }

  protected applyUnderline(): void {
    if (this.readOnly || this.disabled()) return;
    document.execCommand('underline');
    this.onInput();
  }

  // execCommand('foreColor', ...) non capisce la parola chiave CSS 'inherit' come valore —
  // per "colore predefinito" serve il colore testo effettivo del tema attivo in quel momento
  // (diverso per ogni tema), letto dallo stile calcolato invece di un hex fisso che stonerebbe
  // in almeno un tema su cinque.
  protected applyColor(color: string): void {
    if (this.readOnly || this.disabled()) return;
    const resolved = color === 'inherit' ? getComputedStyle(this.editorEl.nativeElement).color : color;
    document.execCommand('foreColor', false, resolved);
    this.onInput();
  }

  protected async saveNotes(): Promise<void> {
    if (this.readOnly || this.disabled()) return;
    const body = this.editorEl.nativeElement.innerHTML;
    const adventure = this.adventure;
    const version = this.changeVersion;
    this.saveFailed.set(false);
    this.saveQueue = this.saveQueue.then(async () => {
      try {
        const formData = new FormData();
        formData.set('adventure', adventure);
        formData.set('body', body);
        const response = await fetch('/api/gdr/notes', { method: 'POST', credentials: 'same-origin', body: formData, keepalive: true });
        if (!response.ok) {
          throw new Error(`Salvataggio fallito: ${response.status}`);
        }
        if (!this.destroyed && version === this.changeVersion) this.statusMessage.set('Salvato nel tuo account.');
      } catch (error) {
        console.error('Errore nel salvataggio degli appunti:', error);
        if (!this.destroyed && version === this.changeVersion) {
          this.statusMessage.set('Non è stato possibile salvare. Il testo è ancora qui: riprova.');
          this.saveFailed.set(true);
        }
      }
    });
    await this.saveQueue;
  }
}
