import { Component, DestroyRef, ElementRef, Injector, OnInit, ViewChild, afterNextRender, computed, inject, runInInjectionContext, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { AppShell } from '../../shell/app-shell';
import { AuthService } from '../../core/auth.service';
import { ApiService } from '../../core/api.service';
import { ConfirmationDialog } from '../../shared/confirmation-dialog/confirmation-dialog';
import { RealtimeService } from '../../core/realtime.service';
import { ChatMessage, GlobalChatService } from '../../core/global-chat.service';

const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

@Component({
  selector: 'app-ponti-chat',
  standalone: true,
  imports: [AppShell, FormsModule, DatePipe, ConfirmationDialog],
  host: {
    '(document:click)': 'closeMessageMenu()',
    '(document:keydown.escape)': 'dismissMessageMenu()'
  },
  styleUrls: ['../../../styles/pages/ponti-chat.css'],
  templateUrl: './ponti-chat.html'
})
export class PontiChat implements OnInit {
  private readonly authService = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly realtime = inject(RealtimeService);
  protected readonly chat = inject(GlobalChatService);

  @ViewChild('fileInput') private fileInput?: ElementRef<HTMLInputElement>;
  @ViewChild('log') private log?: ElementRef<HTMLElement>;
  @ViewChild('editInput') private editInput?: ElementRef<HTMLTextAreaElement>;

  protected readonly ownUserId = computed(() => this.authService.currentUser()?.id ?? null);

  protected readonly messages = signal<ChatMessage[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);

  protected readonly composeText = signal('');
  protected readonly sending = signal(false);
  protected readonly sendError = signal('');

  protected readonly pendingFile = signal<File | null>(null);
  protected readonly pendingFileType = signal<'photo' | 'video' | null>(null);
  protected readonly pendingPreviewUrl = signal<string | null>(null);
  protected readonly uploading = signal(false);

  protected readonly deleteTargetId = signal<string | null>(null);
  protected readonly openMessageMenuId = signal<string | null>(null);
  protected readonly menuBelow = signal(false);
  protected readonly editingMessage = signal<ChatMessage | null>(null);
  protected readonly editText = signal('');
  protected readonly savingEdit = signal(false);
  protected readonly editError = signal('');
  protected readonly editUnchanged = computed(() => this.editText().trim() === (this.editingMessage()?.body ?? ''));
  private menuTrigger?: HTMLElement;

  protected toggleMessageMenu(event: MouseEvent, id: string): void {
    event.stopPropagation();
    const button = event.currentTarget as HTMLElement;
    this.menuTrigger = button;
    this.menuBelow.set(button.getBoundingClientRect().top - (this.log?.nativeElement.getBoundingClientRect().top ?? 0) < 110);
    this.openMessageMenuId.update(current => current === id ? null : id);
  }

  protected closeMessageMenu(): void { this.openMessageMenuId.set(null); }

  protected dismissMessageMenu(): void {
    if (!this.openMessageMenuId()) return;
    this.closeMessageMenu();
    this.menuTrigger?.focus();
  }

  protected beginEdit(message: ChatMessage): void {
    if (message.senderUserId !== this.ownUserId() || this.editingMessage()) return;
    this.closeMessageMenu();
    this.editingMessage.set(message);
    this.editText.set(message.body ?? '');
    this.editError.set('');
    runInInjectionContext(this.injector, () => afterNextRender(() => this.editInput?.nativeElement.focus()));
  }

  protected cancelEdit(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    if (this.savingEdit()) return;
    this.editingMessage.set(null);
    this.editError.set('');
    runInInjectionContext(this.injector, () => afterNextRender(() => this.menuTrigger?.focus()));
  }

  protected async saveEdit(): Promise<void> {
    const message = this.editingMessage();
    if (!message || this.savingEdit() || this.editUnchanged()) return;
    const body = this.editText().trim();
    if (!body && !message.mediaKey) { this.editError.set('Il messaggio non può essere vuoto.'); return; }
    this.savingEdit.set(true);
    this.editError.set('');
    try {
      const response = await fetch(`/api/ponti-chat/${message.id}`, {
        method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, revision: message.revision ?? 1 })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Modifica non riuscita.');
      const updated = result as ChatMessage;
      this.messages.update(list => list.map(item => item.id === message.id ? updated : item));
      this.chat.messages.update(list => list.map(item => item.id === message.id ? updated : item));
      this.editingMessage.set(null);
      runInInjectionContext(this.injector, () => afterNextRender(() => this.menuTrigger?.focus()));
    } catch (error) {
      this.editError.set(error instanceof Error ? error.message : 'Modifica non riuscita.');
    } finally { this.savingEdit.set(false); }
  }

  async ngOnInit(): Promise<void> {
    await this.loadMessages();
    void this.markRead();
    this.realtime.on('ponti-chat:changed')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => {
        if (event['actorUserId'] !== this.authService.currentUser()?.id) void this.reloadFromRealtime();
      });
  }

  private async reloadFromRealtime(): Promise<void> {
    await this.loadMessages();
    void this.markRead();
  }

  private async loadMessages(): Promise<void> {
    try {
      const response = await fetch('/api/ponti-chat', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`Caricamento fallito: ${response.status}`);
      const data = await this.api.readApiResponse<{ messages?: ChatMessage[] }>(response);
      this.messages.set(data.messages ?? []);
      this.loadError.set(false);
      this.loading.set(false);
      this.scrollToBottom();
    } catch (error) {
      console.error('Errore nel caricamento della chat:', error);
      this.loadError.set(true);
      this.loading.set(false);
    }
  }

  private async markRead(): Promise<void> {
    await this.chat.markRead();
  }

  // afterNextRender (non queueMicrotask/setTimeout) perché deve leggere scrollHeight solo
  // dopo che Angular ha davvero applicato al DOM i nuovi messaggi, non solo schedulato la
  // change detection — altrimenti lo scroll si fermava un messaggio "indietro".
  private scrollToBottom(): void {
    runInInjectionContext(this.injector, () => {
      afterNextRender(() => {
        const el = this.log?.nativeElement;
        if (el) el.scrollTop = el.scrollHeight;
      });
    });
  }

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.sendError.set('');
    if (!file) return;

    const isPhoto = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    if (!isPhoto && !isVideo) {
      this.sendError.set('Puoi allegare soltanto una foto o un video.');
      input.value = '';
      return;
    }
    const maxBytes = isPhoto ? MAX_PHOTO_BYTES : MAX_VIDEO_BYTES;
    if (file.size > maxBytes) {
      this.sendError.set(`Il file supera la dimensione massima (${Math.round(maxBytes / 1024 / 1024)} MB).`);
      input.value = '';
      return;
    }

    this.pendingFile.set(file);
    this.pendingFileType.set(isPhoto ? 'photo' : 'video');
    this.pendingPreviewUrl.set(URL.createObjectURL(file));
  }

  protected clearPendingFile(): void {
    const url = this.pendingPreviewUrl();
    if (url) URL.revokeObjectURL(url);
    this.pendingFile.set(null);
    this.pendingFileType.set(null);
    this.pendingPreviewUrl.set(null);
    if (this.fileInput) this.fileInput.nativeElement.value = '';
  }

  protected async send(): Promise<void> {
    const text = this.composeText().trim();
    const file = this.pendingFile();
    const mediaType = this.pendingFileType();
    if (!text && !file) return;
    if (this.sending()) return;

    this.sending.set(true);
    this.sendError.set('');

    try {
      let mediaKey: string | null = null;
      if (file && mediaType) {
        this.uploading.set(true);
        const uploadResponse = await fetch(`/api/ponti-chat/media?type=${mediaType}`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': file.type },
          body: file
        });
        const uploadResult = await uploadResponse.json().catch(() => ({}));
        this.uploading.set(false);
        if (!uploadResponse.ok) {
          throw new Error(typeof uploadResult.error === 'string' ? uploadResult.error : 'Upload non riuscito.');
        }
        mediaKey = uploadResult.key;
      }

      const response = await fetch('/api/ponti-chat', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text || undefined, mediaKey: mediaKey ?? undefined, mediaType: mediaKey ? mediaType : undefined })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof result.error === 'string' ? result.error : 'Invio non riuscito.');
      }

      this.messages.set([...this.messages(), result as ChatMessage]);
      await this.markRead();
      this.composeText.set('');
      this.clearPendingFile();
      this.scrollToBottom();
    } catch (error) {
      this.sendError.set(error instanceof Error ? error.message : 'Invio non riuscito.');
    } finally {
      this.sending.set(false);
      this.uploading.set(false);
    }
  }

  protected onComposerKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    void this.send();
  }

  protected mediaUrl(message: ChatMessage): string {
    return `/api/media/${message.mediaKey}`;
  }

  protected startsNewDay(index: number): boolean {
    if (index === 0) return true;
    const current = new Date(this.messages()[index].createdAt);
    const previous = new Date(this.messages()[index - 1].createdAt);
    return current.getFullYear() !== previous.getFullYear()
      || current.getMonth() !== previous.getMonth()
      || current.getDate() !== previous.getDate();
  }

  protected requestDelete(id: string): void {
    this.closeMessageMenu();
    this.deleteTargetId.set(id);
  }

  protected cancelDelete(): void {
    this.deleteTargetId.set(null);
  }

  protected async confirmDelete(): Promise<void> {
    const id = this.deleteTargetId();
    if (!id) return;
    await this.api.sendAuthenticatedJson(`/api/ponti-chat/${id}`, {}, 'DELETE');
    this.deleteTargetId.set(null);
    this.messages.set(this.messages().filter((message) => message.id !== id));
  }
}
