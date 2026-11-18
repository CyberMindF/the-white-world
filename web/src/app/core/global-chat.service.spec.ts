import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject, filter } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { ChatMessage, GlobalChatService } from './global-chat.service';
import { RealtimeEvent, RealtimeService } from './realtime.service';
import { SafeModeService } from './safe-mode.service';

const message = (id: number, senderUserId = 1): ChatMessage => ({
  id: String(id),
  senderUserId,
  senderIdentity: senderUserId === 1 ? 'lui' : 'lei',
  body: 'Messaggio ' + id,
  mediaKey: null,
  mediaType: null,
  readAt: null,
  createdAt: '2026-11-18T12:00:00Z',
});
async function setup(initialLoad = true) {
  const events = new Subject<RealtimeEvent>(),
    read = vi.fn().mockResolvedValue(true);
  let messages = [message(1)],
    visibility: DocumentVisibilityState = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockImplementation(async () => Response.json({ messages, unreadCount: messages.length })),
  );
  TestBed.configureTestingModule({
    providers: [
      GlobalChatService,
      {
        provide: AuthService,
        useValue: { currentUser: signal({ id: 2, identity: 'lei' }), impersonation: signal(null) },
      },
      { provide: SafeModeService, useValue: { enabled: signal(false) } },
      {
        provide: RealtimeService,
        useValue: { on: (type: string) => events.pipe(filter((e) => e.type === type)) },
      },
      {
        provide: ApiService,
        useValue: { readApiResponse: (r: Response) => r.json(), sendAuthenticatedJson: read },
      },
    ],
  });
  const chat = TestBed.inject(GlobalChatService),
    received: ChatMessage[] = [];
  chat.incomingMessage$.subscribe((m) => received.push(m));
  if (initialLoad) await chat.startForCurrentUser();
  return {
    chat,
    read,
    received,
    setMessages(value: ChatMessage[]) {
      messages = value;
    },
    setVisibility(value: DocumentVisibilityState) {
      visibility = value;
    },
    async event(action: string, id: number) {
      events.next({
        type: 'ponti-chat:changed',
        occurredAt: new Date().toISOString(),
        action,
        messageId: id,
      });
      await vi.waitFor(() => expect(chat.loading()).toBe(false));
    },
  };
}

describe('anteprime dei nuovi messaggi ricevuti', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it('ignora la cronologia iniziale, mostra solo i nuovi arrivi e non li segna come letti', async () => {
    const h = await setup();
    expect(h.received).toEqual([]);
    h.setMessages([message(1), message(2)]);
    await h.event('created', 2);
    expect(h.received.map((m) => m.id)).toEqual(['2']);
    expect(h.read).not.toHaveBeenCalled();
    await h.event('created', 2);
    expect(h.received).toHaveLength(1);
    h.setMessages([message(1), message(2), message(3, 2)]);
    await h.event('created', 3);
    expect(h.received).toHaveLength(1);
  });
  it('modifiche, letture e cancellazioni aggiornano la chat senza riproporre il fumetto', async () => {
    const h = await setup();
    h.setMessages([message(1), message(2)]);
    for (const action of ['edited', 'read', 'deleted']) await h.event(action, 2);
    expect(h.received).toEqual([]);
    expect(h.chat.messages()).toHaveLength(2);
  });
  it('non notifica durante il primo caricamento o per un messaggio già letto', async () => {
    const h = await setup(false);
    await h.event('created', 1);
    expect(h.received).toEqual([]);
    h.setMessages([message(1), { ...message(2), readAt: '2026-11-18T12:01:00Z' }]);
    await h.event('created', 2);
    expect(h.received).toEqual([]);
  });
  it('non ripropone al rientro i messaggi arrivati in background o mentre la chat era aperta', async () => {
    const h = await setup();
    h.setVisibility('hidden');
    h.setMessages([message(1), message(2)]);
    await h.event('created', 2);
    h.setVisibility('visible');
    await h.event('created', 2);
    expect(h.received).toEqual([]);
    h.chat.panelOpen.set(true);
    h.setMessages([message(1), message(2), message(3)]);
    await h.event('created', 3);
    h.chat.panelOpen.set(false);
    await h.event('created', 3);
    expect(h.received).toEqual([]);
  });
  it('la notifica non viene ripetuta a chi si iscrive in seguito', async () => {
    const h = await setup();
    h.setMessages([message(1), message(2)]);
    await h.event('created', 2);
    const later: ChatMessage[] = [];
    h.chat.incomingMessage$.subscribe((m) => later.push(m));
    expect(later).toEqual([]);
  });
});
