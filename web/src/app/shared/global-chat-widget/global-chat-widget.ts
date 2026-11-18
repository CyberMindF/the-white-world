import { Component, DestroyRef, ElementRef, Injector, ViewChild, afterNextRender, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { GlobalChatService } from '../../core/global-chat.service';

@Component({
  selector: 'app-global-chat-widget',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink],
  templateUrl: './global-chat-widget.html',
  styleUrl: './global-chat-widget.css',
  host: { '(document:visibilitychange)': 'onVisibilityChange()' }
})
export class GlobalChatWidget {
  protected readonly chat = inject(GlobalChatService);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private waitingForFirstMessages = false;
  protected readonly open = signal(false);
  protected readonly text = signal('');
  protected readonly sending = signal(false);
  protected readonly error = signal('');
  protected readonly pendingFile = signal<File | null>(null);
  protected readonly pendingPreviewUrl = signal<string | null>(null);
  private readonly arrivalId = signal<string | null>(null);
  protected readonly arrival = computed(() => this.chat.messages().find(message => message.id === this.arrivalId()));
  protected readonly arrivalFading = signal(false);
  protected readonly arrivalText = computed(() => {
    const message = this.arrival();
    const text = message?.body?.trim().replace(/\s+/g, ' ');
    return text ? text.slice(0, 180) + (text.length > 180 ? '…' : '')
      : message?.mediaType === 'photo' ? '📷 Foto' : message?.mediaType === 'video' ? '🎬 Video' : 'Nuovo messaggio';
  });
  private arrivalTimer?: ReturnType<typeof setTimeout>;
  private arrivalRemovalTimer?: ReturnType<typeof setTimeout>;
  @ViewChild('log') private log?: ElementRef<HTMLElement>;
  @ViewChild('fileInput') private fileInput?: ElementRef<HTMLInputElement>;
  @ViewChild('arrivalElement') private arrivalElement?: ElementRef<HTMLElement>;

  constructor() {
    this.chat.incomingMessage$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(message => {
      if (this.open() || document.visibilityState !== 'visible') return;
      this.pauseArrival();
      this.arrivalId.set(message.id);
      this.resumeArrival();
    });
    this.destroyRef.onDestroy(() => this.clearArrivalTimers());
    effect(() => {
      const opened = this.open(), count = this.chat.messages().length;
      // Se la prima risposta arriva dopo l'apertura, partiamo comunque dall'ultimo messaggio.
      // Gli aggiornamenti successivi non devono interrompere chi sta leggendo più indietro.
      if (opened && count && this.waitingForFirstMessages) {
        this.waitingForFirstMessages = false;
        untracked(() => this.scheduleScrollToBottom());
      }
    });
  }

  protected toggle(): void {
    this.dismissArrival();
    this.open.update((value) => !value);
    this.chat.panelOpen.set(this.open());
    this.waitingForFirstMessages = this.open() && this.chat.messages().length === 0;
    if (this.open()) {
      void this.chat.markRead();
      this.scheduleScrollToBottom();
    }
  }

  private clearArrivalTimers(): void {
    clearTimeout(this.arrivalTimer);
    clearTimeout(this.arrivalRemovalTimer);
  }

  protected pauseArrival(): void {
    this.clearArrivalTimers();
    this.arrivalFading.set(false);
  }

  protected resumeArrival(): void {
    if (!this.arrivalId() || this.arrivalElement?.nativeElement.matches(':hover, :focus-within')) return;
    this.clearArrivalTimers();
    this.arrivalTimer = setTimeout(() => {
      this.arrivalFading.set(true);
      this.arrivalRemovalTimer = setTimeout(() => this.dismissArrival(), 2000);
    }, 4000);
  }

  protected dismissArrival(): void {
    this.clearArrivalTimers();
    this.arrivalId.set(null);
    this.arrivalFading.set(false);
  }

  protected onVisibilityChange(): void {
    if (document.visibilityState !== 'visible') this.dismissArrival();
  }

  protected async send(): Promise<void> {
    const body = this.text().trim();
    const file = this.pendingFile();
    if ((!body && !file) || this.sending()) return;
    this.sending.set(true);
    this.error.set('');
    const sent = await this.chat.send(body, file ?? undefined);
    this.sending.set(false);
    if (!sent) {
      this.error.set('Non sono riuscito a inviare il messaggio.');
      return;
    }
    this.text.set('');
    this.clearPendingFile();
    this.scheduleScrollToBottom();
  }

  protected onComposerKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    void this.send();
  }

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
      this.error.set('Puoi allegare soltanto una foto o un video.');
      input.value = '';
      return;
    }
    const maxBytes = file.type.startsWith('image/') ? 15 * 1024 * 1024 : 200 * 1024 * 1024;
    if (file.size > maxBytes) {
      this.error.set(`Il file supera la dimensione massima (${maxBytes / 1024 / 1024} MB).`);
      input.value = '';
      return;
    }
    this.clearPendingFile();
    this.pendingFile.set(file);
    this.pendingPreviewUrl.set(URL.createObjectURL(file));
  }

  protected clearPendingFile(): void {
    const preview = this.pendingPreviewUrl();
    if (preview) URL.revokeObjectURL(preview);
    this.pendingFile.set(null);
    this.pendingPreviewUrl.set(null);
    if (this.fileInput) this.fileInput.nativeElement.value = '';
  }

  protected mediaUrl = this.chat.mediaUrl.bind(this.chat);

  private scheduleScrollToBottom(): void {
    afterNextRender(() => this.scrollToBottom(), { injector: this.injector });
  }

  private scrollToBottom(): void {
    const element = this.log?.nativeElement;
    if (element) element.scrollTop = element.scrollHeight;
  }
}
