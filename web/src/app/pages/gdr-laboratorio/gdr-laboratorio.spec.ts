import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { EMPTY } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../core/auth.service';
import { SafeModeService } from '../../core/safe-mode.service';
import { RealtimeService } from '../../core/realtime.service';
import { GdrWorkspaceService } from '../../core/gdr-workspace.service';
import { GdrLaboratorio } from './gdr-laboratorio';

class TurnPage extends GdrLaboratorio {
  draft(text: string) { this.updateDraft(text); }
  preview() { this.turnPreview.set(true); }
  leavePreview() { this.turnPreview.set(false); }
  send() { return this.publish(); }
  state() { return { local: this.local(), turns: this.turns(), status: this.status(), error: this.turnsError() }; }
}
function create(live = true) {
  TestBed.configureTestingModule({providers: [
    {provide: AuthService, useValue: {currentUser: signal({id: 7, nickname: 'Rory'}), isAdmin: signal(true)}},
    {provide: SafeModeService, useValue: {enabled: signal(false)}},
    {provide: RealtimeService, useValue: {on: () => EMPTY}},
    {provide: GdrWorkspaceService, useValue: {}},
    {provide: ActivatedRoute, useValue: {snapshot: {paramMap: convertToParamMap(live ? {adventureId: 'il-prezzo-della-verita'} : {})}}},
  ]});
  const page = TestBed.runInInjectionContext(() => new TurnPage());
  page.preview();
  return page;
}
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), {status});
const saved = {saved: true, turnId: 42, author: 'Rory', createdAt: '2026-10-31T22:00:00Z'};
describe('invio dei turni della partita reale', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => { vi.unstubAllGlobals(); TestBed.resetTestingModule(); });
  it('non pubblica prima di passare dall’anteprima', async () => {
    const fetchMock=vi.fn(); vi.stubGlobal('fetch',fetchMock);
    const page=create(); page.draft('Una risposta'); page.leavePreview(); await page.send();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(page.state().local.draft).toBe('Una risposta');
  });
  it('invia il testo completo al server e rilegge la cronologia condivisa', async () => {
    const body = 'Mi avvicino.\n\n::: dialogo Ada\nCiao!\n:::';
    const fetchMock = vi.fn().mockResolvedValueOnce(reply(saved, 201)).mockResolvedValueOnce(reply({turns:[{id:42, author:'Rory', createdAt:saved.createdAt, body, isMine:true}]}));
    vi.stubGlobal('fetch', fetchMock);
    const page = create(); page.draft(body); await page.send();
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/gdr/turns');
    expect(options.method).toBe('POST');
    expect(options.credentials).toBe('same-origin');
    expect(options.body.get('body')).toBe(body);
    expect(options.body.get('adventure')).toBe('il-prezzo-della-verita');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/gdr/turns?adventure=il-prezzo-della-verita');
    expect(page.state().local.draft).toBe('');
    expect(page.state().local.turns).toHaveLength(0);
    expect(page.state().turns[0].body).toBe(body);
  });
  it('conserva la bozza se il server rifiuta l’invio', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({error:'Sessione scaduta'},401)));
    const page=create(); page.draft('Non perdere questo testo'); await page.send();
    expect(page.state().local.draft).toBe('Non perdere questo testo');
    expect(page.state().turns).toHaveLength(0);
    expect(page.state().status).toContain('Sessione scaduta');
  });
  it('mantiene visibile il turno già salvato anche se la rilettura fallisce', async () => {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(reply(saved,201)).mockRejectedValueOnce(new Error('offline')));
    const page=create(); page.draft('Turno salvato'); await page.send();
    expect(page.state().turns[0].id).toBe(42);
    expect(page.state().local.draft).toBe('');
    expect(page.state().error).toContain('aggiornare i turni');
  });
  it('impedisce due invii contemporanei e conserva il testo scritto durante l’invio', async () => {
    let finish!: (response: Response) => void;
    const fetchMock=vi.fn().mockImplementationOnce(()=>new Promise<Response>(resolve=>finish=resolve)).mockResolvedValue(reply({turns:[]}));
    vi.stubGlobal('fetch',fetchMock);
    const page=create(); page.draft('Primo turno'); const pending=page.send();
    await page.send(); expect(fetchMock).toHaveBeenCalledTimes(1);
    page.draft('Bozza del prossimo turno'); finish(reply(saved,201)); await pending;
    expect(page.state().local.draft).toBe('Bozza del prossimo turno');
  });
  it('mantiene gli invii locali esclusivamente nel laboratorio', async () => {
    const fetchMock=vi.fn(); vi.stubGlobal('fetch',fetchMock);
    const page=create(false); page.draft('Solo una prova'); await page.send();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(page.state().local.turns[0].source).toBe('Solo una prova');
  });
});
