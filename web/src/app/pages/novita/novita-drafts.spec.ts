import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../core/auth.service';
import { SafeModeService } from '../../core/safe-mode.service';
import { AppShell } from '../../shell/app-shell';
import { Novita } from './novita';

async function setup(admin = true) {
  const adminModeEnabled = signal(admin);
  const safe = signal(false);
  const scroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  let updates = [
    { id: '1', kind: 'mondo', emoji: '✨', title: 'Novità pubblicata', body: 'Disponibile', route: null, ctaLabel: null, publishedAt: '2026-11-01T12:00:00Z', active: true, announce: true, safe: true, seen: true },
    { id: '2', kind: 'mondo', emoji: '✨', title: 'Novità in bozza', body: 'Da pubblicare', route: '/novita', ctaLabel: 'Apri', publishedAt: '2026-11-02T12:00:00Z', active: false, announce: true, safe: true, seen: false },
  ];
  let reject = false;
  const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST' && url.endsWith('/seen')) return Response.json({ ok: true });
    if (init?.method === 'PUT' || init?.method === 'POST') {
      if (reject) return Response.json({ error: 'Salvataggio non riuscito.' }, { status: 500 });
      const payload = JSON.parse(init.body as string);
      const id = init.method === 'POST' ? '3' : url.split('/').at(-1)!;
      const update = { ...payload, id, seen: false };
      updates = [...updates.filter(u => u.id !== id), update];
      return Response.json(update);
    }
    if (url === '/api/world-updates') {
      return Response.json({ updates: updates.filter(u => adminModeEnabled() || u.active) });
    }
    return Response.json({ campaigns: [] });
  });
  vi.stubGlobal('fetch', fetchMock);
  TestBed.configureTestingModule({
    imports: [Novita],
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: { isAdmin: signal(true), adminModeEnabled, currentUser: signal({ isTest: false }), impersonation: signal(null) } },
      { provide: SafeModeService, useValue: { enabled: safe } },
    ],
  });
  TestBed.overrideComponent(Novita, { remove: { imports: [AppShell] }, add: { schemas: [NO_ERRORS_SCHEMA] } });
  const fixture = TestBed.createComponent(Novita);
  fixture.detectChanges();
  await fixture.whenStable();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.updates-timeline').textContent).toContain('Novità pubblicata');
  });
  const button = (text: string, root: HTMLElement = fixture.nativeElement) =>
    [...root.querySelectorAll('button')].find(b => b.textContent?.trim() === text)!;
  const setInput = async (name: string, value: string | boolean) => {
    const input = fixture.nativeElement.querySelector(`[name="${name}"]`) as HTMLInputElement;
    if (typeof value === 'boolean') { input.checked = value; input.dispatchEvent(new Event('change')); }
    else { input.value = value; input.dispatchEvent(new Event('input')); }
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const openDraft = async () => {
    button('Modifica', fixture.nativeElement.querySelector('.draft-list')).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  return { fixture, fetchMock, button, setInput, openDraft, adminModeEnabled, safe,
    reject: () => { reject = true; },
    restoreScroll: () => { if (scroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scroll); else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView'); },
  };
}

describe('bozze delle novità', () => {
  let restoreScroll: (() => void) | undefined;
  afterEach(() => { TestBed.resetTestingModule(); vi.unstubAllGlobals(); restoreScroll?.(); });

  it('mostra le bozze solo all’admin e le recupera entrando in modalità admin', async () => {
    const h = await setup(false); restoreScroll = h.restoreScroll;
    expect(h.fixture.nativeElement.textContent).not.toContain('Novità in bozza');
    const reads = () => h.fetchMock.mock.calls.filter(([url]) => url === '/api/world-updates').length;
    const before = reads();
    h.adminModeEnabled.set(true);
    h.fixture.detectChanges();
    await vi.waitFor(() => {
      h.fixture.detectChanges();
      expect(reads()).toBeGreaterThan(before);
      expect(h.fixture.nativeElement.querySelector('.draft-list')?.textContent).toContain('Novità in bozza');
    });
    expect(h.fixture.nativeElement.querySelector('.updates-timeline').textContent).not.toContain('Novità in bozza');
    h.adminModeEnabled.set(false); h.fixture.detectChanges();
    expect(h.fixture.nativeElement.querySelector('.draft-list')).toBeNull();
  });

  it('crea una bozza e permette di modificarla senza pubblicarla né segnarla letta', async () => {
    const h = await setup(); restoreScroll = h.restoreScroll;
    await h.setInput('updateTitle', 'Nuova bozza');
    await h.setInput('updateActive', false);
    h.button('Salva bozza').click();
    await vi.waitFor(() => {
      h.fixture.detectChanges();
      expect(h.fixture.nativeElement.querySelector('.draft-list').textContent).toContain('Nuova bozza');
    });
    const created = h.fetchMock.mock.calls.find(([, init]) => init?.method === 'POST' && !String(init?.body).includes('"ids"'))!;
    expect(JSON.parse(created[1]!.body as string)).toMatchObject({ title: 'Nuova bozza', active: false, announce: true });
    await h.openDraft();
    await h.setInput('updateBody', 'Bozza aggiornata');
    h.button('Salva bozza').click();
    await vi.waitFor(() => {
      h.fixture.detectChanges();
      expect(h.fixture.nativeElement.querySelector('.draft-list').textContent).toContain('Bozza aggiornata');
    });
    const updated = h.fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(JSON.parse(updated[1]!.body as string)).toMatchObject({ active: false, body: 'Bozza aggiornata' });
    expect(h.fetchMock.mock.calls.some(([url]) => String(url).endsWith('/seen'))).toBe(false);
  });

  it('pubblica una bozza esistente e la sposta nell’elenco delle novità', async () => {
    const h = await setup(); restoreScroll = h.restoreScroll;
    await h.openDraft();
    expect(h.button('Salva bozza')).toBeDefined();
    await h.setInput('updateActive', true);
    h.button('Salva modifiche').click();
    await vi.waitFor(() => {
      h.fixture.detectChanges();
      expect(h.fixture.nativeElement.querySelector('.updates-timeline').textContent).toContain('Novità in bozza');
    });
    expect(h.fixture.nativeElement.querySelector('.draft-list').textContent).not.toContain('Novità in bozza');
    const [url, init] = h.fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(url).toBe('/api/world-updates/2');
    expect(JSON.parse(init!.body as string)).toMatchObject({ active: true, announce: true });
  });

  it('conserva testo e stato inattivo se il salvataggio fallisce', async () => {
    const h = await setup(); restoreScroll = h.restoreScroll;
    await h.openDraft();
    await h.setInput('updateBody', 'Testo da conservare');
    h.reject(); h.button('Salva bozza').click();
    await vi.waitFor(() => {
      h.fixture.detectChanges();
      expect(h.fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('Salvataggio non riuscito.');
    });
    expect(h.fixture.nativeElement.querySelector('[name="updateBody"]').value).toBe('Testo da conservare');
    expect(h.fixture.nativeElement.querySelector('[name="updateActive"]').checked).toBe(false);
    expect(h.fixture.nativeElement.querySelector('.draft-list').textContent).toContain('Novità in bozza');
    h.safe.set(true); h.fixture.detectChanges();
    expect(h.fixture.nativeElement.querySelector('.draft-list')).toBeNull();
  });
});
