import { Component, DestroyRef, ElementRef, OnDestroy, OnInit, ViewChild, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AppShell } from '../../shell/app-shell';
import { FormStatus } from '../../shared/form-status/form-status';
import { FormSubmission } from '../../shared/form-submission/form-submission';
import { ContentMessage } from '../../shared/content-message/content-message';
import { EditorialText } from '../../shared/editorial-text/editorial-text';
import { seededRotation } from '../../shared/random';
import { AuthService } from '../../core/auth.service';
import { RealtimeService } from '../../core/realtime.service';

interface Letter {
  id: number;
  author: string;
  isMine: boolean;
  body: string;
  createdAt: string;
  updatedAt?: string | null;
  readAt?: string | null;
}

const dateFormatter = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });

// Porting fedele di assets/js/lettere/main.js, inclusa l'animazione FLIP busta→lettera. Questa
// parte resta imperativa (misure DOM dirette con getBoundingClientRect) come nell'originale:
// non esiste un equivalente dichiarativo pulito in Angular per "anima da un elemento reale a
// un altro", e forzarla dentro @angular/animations sarebbe più complesso e più rischioso che
// portare la stessa logica già funzionante così com'è.
@Component({
  selector: 'app-lettere',
  standalone: true,
  imports: [AppShell, FormsModule, FormStatus, ContentMessage, EditorialText],
  providers: [FormSubmission],
  styleUrls: ['../../../styles/pages/lettere.css'],
  templateUrl: './lettere.html'
})
export class Lettere implements OnInit, OnDestroy {
  protected readonly submission = inject(FormSubmission);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly realtime = inject(RealtimeService);
  @ViewChild('letterDialog') private dialogRef?: ElementRef<HTMLDialogElement>;
  @ViewChild('dialogPaper') private dialogPaperRef?: ElementRef<HTMLDivElement>;
  @ViewChild('pagerViewport') private pagerViewportRef?: ElementRef<HTMLDivElement>;
  @ViewChild('pagerContent') private pagerContentRef?: ElementRef<HTMLDivElement>;

  protected readonly letters = signal<Letter[]>([]);
  protected readonly loadError = signal(false);
  protected readonly draftBody = signal('');
  protected readonly draftStatus = signal('');

  protected readonly dialogLetter = signal<Letter | null>(null);
  protected readonly dialogRotation = signal(0);
  protected readonly dialogSizeCategory = signal<'bigliettino' | 'media' | 'foglio-a4'>('media');
  protected readonly editingLetter = signal(false);
  protected readonly editBody = signal('');
  protected readonly editSaving = signal(false);
  protected readonly editError = signal('');

  // Sfogliare invece di scorrere: il testo scorre in colonne CSS larghe quanto il viewport
  // (una colonna = una pagina), e qui si tiene solo l'indice pagina + le metriche lette dal
  // DOM per calcolare quante pagine ci sono e di quanto traslare la striscia di colonne.
  protected readonly letterPage = signal(0);
  protected readonly letterPageCount = signal(1);
  protected readonly pageTurnDirection = signal<'next' | 'previous' | null>(null);
  private pageStridePx = 0;
  private pageTurnSwapTimer?: number;
  private pageTurnEndTimer?: number;
  private draftSaveTimer?: number;
  private draftSaveSequence = 0;

  private activeCardEl: HTMLElement | null = null;
  private readonly onWindowResize = () => this.recomputePages();
  private readonly onFontsLoaded = () => this.recomputePages();
  private readonly onPageHide = () => this.saveDraftOnExit();

  async ngOnInit(): Promise<void> {
    await Promise.all([this.loadLetters(), this.loadDraft()]);
    this.realtime.on('letters:changed')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => {
        if (event['actorUserId'] !== this.authService.currentUser()?.id) void this.loadLetters(false);
      });
    window.addEventListener('resize', this.onWindowResize);
    window.addEventListener('pagehide', this.onPageHide);
    document.fonts?.addEventListener?.('loadingdone', this.onFontsLoaded);
  }

  ngOnDestroy(): void {
    this.clearPageTurnTimers();
    if (this.draftSaveTimer !== undefined) window.clearTimeout(this.draftSaveTimer);
    this.saveDraftOnExit();
    window.removeEventListener('resize', this.onWindowResize);
    window.removeEventListener('pagehide', this.onPageHide);
    document.fonts?.removeEventListener?.('loadingdone', this.onFontsLoaded);
  }

  protected formatDate(isoDate: string): string {
    return dateFormatter.format(new Date(isoDate));
  }

  protected isUnread(letter: Letter): boolean {
    return !letter.isMine && !letter.readAt;
  }

  private letterRotation(id: number): number {
    return seededRotation(id);
  }

  // Un biglietto corto resta piccolo, una lettera lunga diventa un vero foglio.
  private letterSizeCategory(bodyLength: number): 'bigliettino' | 'media' | 'foglio-a4' {
    if (bodyLength < 240) {
      return 'bigliettino';
    }
    if (bodyLength > 900) {
      return 'foglio-a4';
    }
    return 'media';
  }

  private flipTransform(fromRect: DOMRect, toRect: DOMRect): string {
    const scaleX = fromRect.width / toRect.width;
    const scaleY = fromRect.height / toRect.height;
    const translateX = fromRect.left + fromRect.width / 2 - (toRect.left + toRect.width / 2);
    const translateY = fromRect.top + fromRect.height / 2 - (toRect.top + toRect.height / 2);
    return `translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY}) rotate(0deg)`;
  }

  protected async openLetter(letter: Letter, cardEl: HTMLElement): Promise<void> {
    const dialog = this.dialogRef?.nativeElement;
    const paper = this.dialogPaperRef?.nativeElement;
    if (!dialog || !paper) {
      return;
    }

    this.activeCardEl = cardEl;
    const envelopeEl = cardEl.querySelector('.envelope');
    const fromRect = envelopeEl?.getBoundingClientRect();

    this.dialogLetter.set(letter);
    this.editingLetter.set(false);
    this.editBody.set(letter.body);
    this.editError.set('');
    this.dialogRotation.set(this.letterRotation(letter.id));
    this.dialogSizeCategory.set(this.letterSizeCategory(letter.body.length));
    this.letterPage.set(0);

    dialog.showModal();
    this.updateLetterInUrl(letter.id);

    // Doppio rAF: il primo lascia ad Angular il tempo di aggiornare il DOM con la nuova
    // lettera, il secondo lascia al browser il tempo di calcolare il layout delle colonne
    // prima che si legga scrollWidth. Il listener sui font (ngOnInit) ricalcola di nuovo se
    // Caveat finisce di caricare dopo, cambiando le metriche del testo.
    requestAnimationFrame(() => requestAnimationFrame(() => this.recomputePages()));

    if (fromRect) {
      const toRect = paper.getBoundingClientRect();
      paper.style.transition = 'none';
      paper.style.opacity = '0.5';
      paper.style.transform = this.flipTransform(fromRect, toRect);
      paper.getBoundingClientRect(); // forza il reflow prima di rimuovere lo stato iniziale

      requestAnimationFrame(() => {
        paper.style.transition = '';
        paper.style.transform = '';
        paper.style.opacity = '';
      });
    }

    if (!letter.isMine && !letter.readAt && !this.authService.impersonation()) {
      try {
        const response = await fetch(`/api/letters/${letter.id}`, { method: 'POST', credentials: 'same-origin' });
        const result = await response.json().catch(() => ({}));
        if (response.ok && result.readAt) {
          this.letters.update((list) => list.map((entry) => (entry.id === letter.id ? { ...entry, readAt: result.readAt } : entry)));
        }
      } catch (error) {
        console.error('Errore nel segnare la lettera come letta:', error);
      }
    }
  }

  protected closeLetterAnimated(): void {
    if (this.pageTurnDirection()) {
      return;
    }
    const dialog = this.dialogRef?.nativeElement;
    const paper = this.dialogPaperRef?.nativeElement;
    const envelopeEl = this.activeCardEl?.querySelector('.envelope');

    if (!dialog || !paper || !envelopeEl || !dialog.open) {
      dialog?.close();
      this.updateLetterInUrl(null);
      return;
    }

    const toRect = envelopeEl.getBoundingClientRect();
    const fromRect = paper.getBoundingClientRect();
    paper.style.transition = 'transform .35s ease, opacity .3s ease';
    paper.style.opacity = '0.4';
    paper.style.transform = this.flipTransform(toRect, fromRect);

    const onEnd = () => {
      paper.removeEventListener('transitionend', onEnd);
      dialog.close();
      paper.style.transition = '';
      paper.style.transform = '';
      paper.style.opacity = '';
      this.updateLetterInUrl(null);
    };
    paper.addEventListener('transitionend', onEnd);
  }

  // L'URL della pagina è anche il link condivisibile della lettera aperta. Aggiorniamo la
  // cronologia direttamente, senza una navigazione Router che riporterebbe la pagina in alto.
  private updateLetterInUrl(letterId: number | null): void {
    const urlTree = this.router.createUrlTree([], {
      relativeTo: this.route,
      queryParams: { lettera: letterId },
      queryParamsHandling: 'merge'
    });
    this.location.replaceState(this.router.serializeUrl(urlTree));
  }

  // Il column-width della pagina è il testo stesso a "chiederlo": si legge quanto è largo il
  // viewport e lo si impone come larghezza di colonna, poi si conta quante colonne il browser
  // ha effettivamente creato dallo scrollWidth risultante. Nessun testo viene spezzato a mano.
  private recomputePages(): void {
    if (!this.dialogRef?.nativeElement.open) {
      return;
    }
    const viewport = this.pagerViewportRef?.nativeElement;
    const content = this.pagerContentRef?.nativeElement;
    if (!viewport || !content) {
      return;
    }
    const columnWidth = viewport.clientWidth;
    if (columnWidth <= 0) {
      return;
    }
    content.style.columnWidth = `${columnWidth}px`;
    const gap = parseFloat(getComputedStyle(content).columnGap) || 0;
    this.pageStridePx = columnWidth + gap;
    const pages = Math.max(1, Math.round((content.scrollWidth + gap) / this.pageStridePx));
    this.letterPageCount.set(pages);
    this.letterPage.update((page) => Math.min(page, pages - 1));
  }

  protected pagerTransform(): string {
    return `translateX(${-(this.letterPage() * this.pageStridePx)}px)`;
  }

  protected nextPage(): void {
    this.turnPage('next');
  }

  protected prevPage(): void {
    this.turnPage('previous');
  }

  private turnPage(direction: 'next' | 'previous'): void {
    if (this.pageTurnDirection()) return;
    const delta = direction === 'next' ? 1 : -1;
    const destination = this.letterPage() + delta;
    if (destination < 0 || destination >= this.letterPageCount()) return;

    this.pageTurnDirection.set(direction);
    this.pageTurnSwapTimer = window.setTimeout(() => this.letterPage.set(destination), 180);
    this.pageTurnEndTimer = window.setTimeout(() => {
      this.pageTurnDirection.set(null);
      this.clearPageTurnTimers();
    }, 420);
  }

  private clearPageTurnTimers(): void {
    if (this.pageTurnSwapTimer !== undefined) window.clearTimeout(this.pageTurnSwapTimer);
    if (this.pageTurnEndTimer !== undefined) window.clearTimeout(this.pageTurnEndTimer);
    this.pageTurnSwapTimer = undefined;
    this.pageTurnEndTimer = undefined;
  }

  protected onDialogClick(event: MouseEvent): void {
    if (!this.pageTurnDirection() && event.target === this.dialogRef?.nativeElement) {
      this.closeLetterAnimated();
    }
  }

  protected onDialogCancel(event: Event): void {
    event.preventDefault();
    this.closeLetterAnimated();
  }

  protected startEditingLetter(): void {
    const letter = this.dialogLetter();
    if (!letter?.isMine) return;
    this.editBody.set(letter.body);
    this.editError.set('');
    this.editingLetter.set(true);
  }

  protected cancelEditingLetter(): void {
    this.editingLetter.set(false);
    this.editError.set('');
  }

  protected async saveEditedLetter(): Promise<void> {
    const letter = this.dialogLetter();
    const body = this.editBody().trim();
    if (!letter?.isMine || !body || this.editSaving()) return;

    this.editSaving.set(true);
    this.editError.set('');
    try {
      const form = new FormData();
      form.set('body', body);
      const response = await fetch(`/api/letters/${letter.id}`, {
        method: 'PUT', credentials: 'same-origin', body: form
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string; body?: string; updatedAt?: string };
      if (!response.ok) throw new Error(result.error || 'Modifica non riuscita.');

      const updated = { ...letter, body: result.body ?? body, updatedAt: result.updatedAt ?? new Date().toISOString() };
      this.dialogLetter.set(updated);
      this.letters.update((list) => list.map((entry) => entry.id === letter.id ? updated : entry));
      this.dialogSizeCategory.set(this.letterSizeCategory(updated.body.length));
      this.editingLetter.set(false);
      requestAnimationFrame(() => requestAnimationFrame(() => this.recomputePages()));
    } catch (error) {
      this.editError.set(error instanceof Error ? error.message : 'Modifica non riuscita.');
    } finally {
      this.editSaving.set(false);
    }
  }

  protected onDraftInput(value: string): void {
    this.draftBody.set(value);
    this.draftStatus.set('Modifiche non ancora salvate…');
    if (this.draftSaveTimer !== undefined) window.clearTimeout(this.draftSaveTimer);
    this.draftSaveTimer = window.setTimeout(() => void this.saveDraft(), 700);
  }

  private async loadDraft(): Promise<void> {
    try {
      const response = await fetch('/api/letters/draft', { credentials: 'same-origin' });
      if (!response.ok) return;
      const data = (await response.json()) as { body?: string; updatedAt?: string | null };
      this.draftBody.set(data.body ?? '');
      if (data.body) this.draftStatus.set('Bozza recuperata.');
    } catch (error) {
      console.error('Errore nel recupero della bozza:', error);
    }
  }

  private async saveDraft(): Promise<void> {
    const sequence = ++this.draftSaveSequence;
    const form = new FormData();
    form.set('body', this.draftBody());
    try {
      const response = await fetch('/api/letters/draft', {
        method: 'PUT', credentials: 'same-origin', body: form, keepalive: true
      });
      if (!response.ok) throw new Error(`Salvataggio fallito: ${response.status}`);
      if (sequence === this.draftSaveSequence) this.draftStatus.set(this.draftBody() ? 'Bozza salvata.' : '');
    } catch (error) {
      if (sequence === this.draftSaveSequence) this.draftStatus.set('Bozza non salvata.');
      console.error('Errore nel salvataggio della bozza:', error);
    }
  }

  private saveDraftOnExit(): void {
    if (this.draftSaveTimer !== undefined) window.clearTimeout(this.draftSaveTimer);
    const form = new FormData();
    form.set('body', this.draftBody());
    void fetch('/api/letters/draft', {
      method: 'PUT', credentials: 'same-origin', body: form, keepalive: true
    });
  }

  private async loadLetters(openDeepLink = true): Promise<void> {
    try {
      const response = await fetch('/api/letters', { credentials: 'same-origin' });
      if (!response.ok) {
        throw new Error(`Caricamento fallito: ${response.status}`);
      }
      const data = (await response.json()) as { letters?: Letter[] };
      this.letters.set(data.letters || []);
      this.loadError.set(false);
      if (openDeepLink) this.openRequestedLetter();
    } catch (error) {
      console.error('Errore nel caricamento delle lettere:', error);
      this.loadError.set(true);
    }
  }

  // #e14: deep-link dal banner "Ecco qualcosa che è successo oggi" (?lettera=<id>) — apre
  // direttamente la lettera richiesta, stessa animazione dell'apertura manuale.
  private openRequestedLetter(): void {
    const letterId = this.route.snapshot.queryParamMap.get('lettera');
    if (!letterId) {
      return;
    }
    const letter = this.letters().find((entry) => String(entry.id) === letterId);
    if (!letter) {
      return;
    }
    requestAnimationFrame(() => {
      const cardEl = document.getElementById(`letter-card-${letter.id}`);
      if (cardEl) {
        void this.openLetter(letter, cardEl);
      }
    });
  }

  protected async submitLetter(form: HTMLFormElement): Promise<void> {
    await this.submission.submit(form, {
      url: '/api/letters',
      pendingMessage: 'Sto inviando la lettera...',
      successMessage: 'Lettera inviata.',
      afterSuccess: async () => {
        this.draftBody.set('');
        this.draftStatus.set('');
        this.draftSaveSequence++;
        await this.loadLetters();
      }
    });
  }
}
