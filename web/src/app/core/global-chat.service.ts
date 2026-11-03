import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService, UserIdentity } from './auth.service';
import { ApiService } from './api.service';
import { RealtimeService } from './realtime.service';
import { SafeModeService, isSafeRoute } from './safe-mode.service';
import { WORLD_PLACES } from './world-places';

export interface ChatMessage {
  id: string;
  senderUserId: number;
  senderIdentity: UserIdentity;
  body: string | null;
  mediaKey: string | null;
  mediaType: 'photo' | 'video' | null;
  readAt: string | null;
  createdAt: string;
}

export interface ContactPresence {
  online: boolean;
  path: string | null;
  lastSeen: string | null;
}

@Injectable({ providedIn: 'root' })
export class GlobalChatService {
  private readonly auth = inject(AuthService);
  private readonly safe = inject(SafeModeService);
  private readonly api = inject(ApiService);
  private readonly realtime = inject(RealtimeService);
  private readonly destroyRef = inject(DestroyRef);
  private originalTitle = document.title;
  private loadedForUserId: number | null = null;

  readonly messages = signal<ChatMessage[]>([]);
  readonly unreadCount = signal(0);
  readonly loading = signal(false);
  readonly panelOpen = signal(false);
  readonly contactPresence = signal<ContactPresence>({ online: false, path: null, lastSeen: null });
  readonly ownUserId = computed(() => this.auth.currentUser()?.id ?? null);
  readonly contactName = computed(() => this.auth.currentUser()?.identity === 'lui' ? 'Desy' : 'Rory');

  constructor() {
    this.realtime.on('ponti-chat:changed').pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => void this.loadRecent());
    this.realtime.on('presence:changed').pipe(takeUntilDestroyed(this.destroyRef)).subscribe((event) => {
      const user = this.auth.currentUser();
      if (!user || event['identity'] === user.identity || event['isTest'] !== user.isTest) return;
      this.contactPresence.set({
        online: event['online'] === true,
        path: typeof event['path'] === 'string' ? event['path'] : null,
        lastSeen: typeof event['lastSeen'] === 'string' ? event['lastSeen'] : null
      });
    });
  }

  async startForCurrentUser(): Promise<void> {
    const userId = this.auth.currentUser()?.id;
    if (userId === undefined || this.loadedForUserId === userId) return;
    this.loadedForUserId = userId;
    await this.loadRecent();
  }

  clear(): void {
    this.loadedForUserId = null;
    this.messages.set([]);
    this.unreadCount.set(0);
    this.contactPresence.set({ online: false, path: null, lastSeen: null });
    this.updateTitle();
  }

  async loadRecent(limit = 30): Promise<void> {
    if (!this.auth.currentUser()) return;
    this.loading.set(true);
    try {
      const response = await fetch(`/api/ponti-chat?limit=${limit}`, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (!response.ok) return;
      const result = await this.api.readApiResponse<{ messages?: ChatMessage[]; unreadCount?: number }>(response);
      this.messages.set(result.messages ?? []);
      this.unreadCount.set(result.unreadCount ?? 0);
      this.updateTitle();
      if (this.panelOpen() && this.unreadCount()) void this.markRead();
    } finally {
      this.loading.set(false);
    }
  }

  async markRead(): Promise<void> {
    const succeeded = await this.api.sendAuthenticatedJson('/api/ponti-chat/read', {}, 'POST');
    if (succeeded) {
      this.unreadCount.set(0);
      this.updateTitle();
    }
  }

  async send(body: string, file?: File): Promise<boolean> {
    let mediaKey: string | undefined;
    let mediaType: 'photo' | 'video' | undefined;
    if (file) {
      mediaType = file.type.startsWith('image/') ? 'photo' : 'video';
      const upload = await fetch(`/api/ponti-chat/media?type=${mediaType}`, {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': file.type }, body: file
      });
      if (!upload.ok) return false;
      const uploaded = await this.api.readApiResponse<{ key?: string }>(upload);
      mediaKey = 'key' in uploaded ? uploaded.key : undefined;
      if (!mediaKey) return false;
    }
    const response = await fetch('/api/ponti-chat', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: body || undefined, mediaKey, mediaType })
    });
    if (!response.ok) return false;
    const created = await this.api.readApiResponse<ChatMessage>(response) as ChatMessage;
    this.messages.update((messages) => [...messages, created]);
    await this.markRead();
    return true;
  }

  async sendText(body: string): Promise<boolean> { return this.send(body); }

  mediaUrl(message: ChatMessage): string { return `/api/media/${message.mediaKey}`; }

  contactPageLabel(): string {
    const path = this.contactPresence().path;
    if (this.safe.enabled() && path && !isSafeRoute(path)) return 'Online';
    if (this.safe.enabled() && path === '/ponti-chat') return 'Chat';
    if (!path || path === '/') return 'Il Mondo Bianco';
    if (path === '/ponti-chat' || path === '/stranger-chat') return 'I Ponti';
    const place = [...WORLD_PLACES]
      .filter((candidate) => candidate.route && (path === candidate.route || path.startsWith(`${candidate.route}/`)))
      .sort((a, b) => (b.route?.length ?? 0) - (a.route?.length ?? 0))[0];
    return place?.fallbackName ?? 'Il Mondo Bianco';
  }

  startsNewDay(index: number): boolean {
    if (index === 0) return true;
    const current = new Date(this.messages()[index].createdAt);
    const previous = new Date(this.messages()[index - 1].createdAt);
    return current.getFullYear() !== previous.getFullYear()
      || current.getMonth() !== previous.getMonth()
      || current.getDate() !== previous.getDate();
  }

  private updateTitle(): void {
    const current = document.title.replace(/^\(\d+\)\s*/, '');
    if (!this.unreadCount()) this.originalTitle = current;
    document.title = this.unreadCount() ? `(${this.unreadCount()}) ${this.originalTitle}` : this.originalTitle;
  }
}
