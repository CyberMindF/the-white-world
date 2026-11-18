import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatMessage, GlobalChatService } from '../../core/global-chat.service';
import { GlobalChatWidget } from './global-chat-widget';

function setup() {
  let visibility: DocumentVisibilityState = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  const incoming = new Subject<ChatMessage>(),
    messages = signal<ChatMessage[]>([]),
    read = vi.fn().mockResolvedValue(true);
  const chat = {
    messages,
    incomingMessage$: incoming.asObservable(),
    panelOpen: signal(false),
    loading: signal(false),
    unreadCount: signal(1),
    ownUserId: () => 2,
    contactName: () => 'Rory',
    contactPresence: signal({ online: true, lastSeen: null }),
    contactPageLabel: () => 'Il Mondo Bianco',
    startsNewDay: () => false,
    markRead: read,
    mediaUrl: () => '',
    send: vi.fn(),
  };
  TestBed.configureTestingModule({
    imports: [GlobalChatWidget],
    providers: [provideRouter([]), { provide: GlobalChatService, useValue: chat }],
  });
  const fixture = TestBed.createComponent(GlobalChatWidget);
  fixture.detectChanges();
  const incomingMessage = (id: string, body: string | null = 'Ciao!') => {
    const message: ChatMessage = {
      id,
      senderUserId: 1,
      senderIdentity: 'lui',
      body,
      mediaKey: body ? null : 'foto',
      mediaType: body ? null : 'photo',
      readAt: null,
      createdAt: '2026-11-18T12:00:00Z',
    };
    messages.update((list) => [...list, message]);
    incoming.next(message);
    fixture.detectChanges();
  };
  return {
    fixture,
    chat,
    read,
    incomingMessage,
    notice: () => fixture.nativeElement.querySelector('.global-chat-arrival') as HTMLElement | null,
    button: (name: string) =>
      ([...fixture.nativeElement.querySelectorAll('button')] as HTMLButtonElement[]).find(
        (b) => b.getAttribute('aria-label') === name,
      )!,
    hide() {
      visibility = 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));
      fixture.detectChanges();
    },
  };
}

describe('fumetto sopra la chat chiusa', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  it('mostra mittente e anteprima, poi sfuma lentamente senza segnare come letto', () => {
    const h = setup();
    vi.useFakeTimers();
    h.incomingMessage('2');
    expect(h.notice()?.textContent).toContain('Rory');
    expect(h.notice()?.textContent).toContain('Ciao!');
    vi.advanceTimersByTime(3999);
    h.fixture.detectChanges();
    expect(h.notice()?.classList.contains('is-fading')).toBe(false);
    vi.advanceTimersByTime(1);
    h.fixture.detectChanges();
    expect(h.notice()?.classList.contains('is-fading')).toBe(true);
    vi.advanceTimersByTime(2000);
    h.fixture.detectChanges();
    expect(h.notice()).toBeNull();
    expect(h.read).not.toHaveBeenCalled();
    expect(h.chat.unreadCount()).toBe(1);
  });
  it('un altro arrivo sostituisce il precedente e riparte il tempo; allegati senza testo hanno un’etichetta', () => {
    const h = setup();
    vi.useFakeTimers();
    h.incomingMessage('2');
    vi.advanceTimersByTime(5000);
    h.fixture.detectChanges();
    h.incomingMessage('3', null);
    expect(h.notice()?.textContent).toContain('Foto');
    expect(h.notice()?.classList.contains('is-fading')).toBe(false);
    vi.advanceTimersByTime(1000);
    h.fixture.detectChanges();
    expect(h.notice()).not.toBeNull();
    vi.advanceTimersByTime(5000);
    h.fixture.detectChanges();
    expect(h.notice()).toBeNull();
  });
  it('si può chiudere senza leggere; cliccando il fumetto si apre la conversazione', () => {
    const h = setup();
    h.incomingMessage('2');
    h.button('Chiudi anteprima del messaggio').click();
    h.fixture.detectChanges();
    expect(h.notice()).toBeNull();
    expect(h.read).not.toHaveBeenCalled();
    h.incomingMessage('3');
    h.button('Apri il messaggio di Rory').click();
    h.fixture.detectChanges();
    expect(h.notice()).toBeNull();
    expect(h.chat.panelOpen()).toBe(true);
    expect(h.read).toHaveBeenCalledOnce();
    h.incomingMessage('4');
    expect(h.notice()).toBeNull();
  });
  it('la sfumatura si ferma mentre il puntatore è sul fumetto e riprende quando esce', () => {
    const h = setup();
    vi.useFakeTimers();
    h.incomingMessage('2');
    h.notice()?.dispatchEvent(new Event('mouseenter'));
    vi.advanceTimersByTime(10000);
    h.fixture.detectChanges();
    expect(h.notice()?.classList.contains('is-fading')).toBe(false);
    h.notice()?.dispatchEvent(new Event('mouseleave'));
    vi.advanceTimersByTime(6000);
    h.fixture.detectChanges();
    expect(h.notice()).toBeNull();
  });
  it('aggiorna l’anteprima se il messaggio viene corretto e la nasconde quando si lascia la scheda', () => {
    const h = setup();
    h.incomingMessage('2');
    h.chat.messages.update((list) => list.map((m) => ({ ...m, body: 'Testo corretto' })));
    h.fixture.detectChanges();
    expect(h.notice()?.textContent).toContain('Testo corretto');
    h.hide();
    expect(h.notice()).toBeNull();
  });
});
