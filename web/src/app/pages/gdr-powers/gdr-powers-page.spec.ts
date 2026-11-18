import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { AuthService } from '../../core/auth.service';
import { SafeModeService } from '../../core/safe-mode.service';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GdrManagementShell } from '../../shared/gdr-management/gdr-management-shell';
import { GdrPowersPage } from './gdr-powers-page';

async function setup() {
  let power = {
    id: 'spell',
    name: 'Scudo',
    kind: 'spell',
    description: 'Descrizione originale',
    effects: [],
    revision: 1,
    systemIds: ['a'],
    characterIds: ['daisy'],
  };
  let reject = false;
  const data = () => ({
    powers: [power],
    systems: [
      { id: 'a', name: 'Sistema A' },
      { id: 'b', name: 'Sistema B' },
    ],
    characters: [
      { id: 'daisy', name: 'Daisy', kind: 'pg', adventureId: 'a', archived: 0 },
      { id: 'npc', name: 'PNG', kind: 'png', adventureId: 'b', archived: 0 },
    ],
  });
  const fetchMock = vi.fn().mockImplementation(async (url, init) => {
    if (init?.method === 'POST') {
      if (reject) return Response.json({ error: 'La voce è cambiata.' }, { status: 409 });
      power = { ...JSON.parse(init.body), revision: 2 };
      return Response.json({ saved: true });
    }
    return Response.json(data());
  });
  vi.stubGlobal('fetch', fetchMock);
  TestBed.configureTestingModule({
    imports: [GdrPowersPage],
    providers: [
      {
        provide: AuthService,
        useValue: {
          isAdmin: () => true,
          adminModeEnabled: signal(true),
          currentUser: () => ({ isTest: false }),
        },
      },
      { provide: SafeModeService, useValue: { enabled: signal(false) } },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: { queryParamMap: convertToParamMap({ system: 'a', character: 'daisy' }) },
        },
      },
    ],
  });
  TestBed.overrideComponent(GdrPowersPage, {
    remove: { imports: [GdrManagementShell] },
    add: { schemas: [NO_ERRORS_SCHEMA] },
  });
  const fixture = TestBed.createComponent(GdrPowersPage);
  fixture.detectChanges();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Scudo');
  });
  await fixture.whenStable();
  fixture.detectChanges();
  const button = (text: string) =>
    ([...fixture.nativeElement.querySelectorAll('button')] as HTMLButtonElement[]).find(
      (b) => b.textContent?.trim() === text,
    )!;
  const check = (label: string) => {
    const element = (
      [...fixture.nativeElement.querySelectorAll('label.check')] as HTMLLabelElement[]
    ).find((l) => l.textContent?.includes(label))!;
    (element.querySelector('input') as HTMLInputElement).click();
    fixture.detectChanges();
  };
  return {
    fixture,
    fetchMock,
    button,
    check,
    reject() {
      reject = true;
    },
  };
}
describe('catalogo condiviso di abilità e magie', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
  });
  it('modifica una descrizione conservando sistemi e personaggi assegnati', async () => {
    const { fixture, fetchMock, button, check } = await setup();
    await fixture.whenStable();
    const description = fixture.nativeElement.querySelector('[name="description"]');
    description.value = 'Descrizione condivisa aggiornata';
    description.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    button('Salva voce').click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Voce salvata.');
    });
    const [, init] = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST')!;
    expect(JSON.parse(init.body)).not.toHaveProperty('characterIds');
    expect(JSON.parse(init.body)).toMatchObject({
      id: 'spell',
      revision: 1,
      description: 'Descrizione condivisa aggiornata',
      systemIds: ['a'],
    });
    expect(fixture.nativeElement.textContent).toContain('Voce salvata.');
    expect(fixture.nativeElement.querySelector('[name="description"]').value).toBe(
      'Descrizione condivisa aggiornata',
    );
  });
  it('un rifiuto conserva la bozza e non invia richieste aggiuntive', async () => {
    const h = await setup();
    h.reject();
    const description = h.fixture.nativeElement.querySelector('[name="description"]');
    description.value = 'Da conservare';
    description.dispatchEvent(new Event('input'));
    h.fixture.detectChanges();
    h.button('Salva voce').click();
    await vi.waitFor(() => {
      h.fixture.detectChanges();
      expect(h.fixture.nativeElement.textContent).toContain('La voce è cambiata.');
    });
    expect(h.fixture.nativeElement.querySelector('[name="description"]').value).toBe(
      'Da conservare',
    );
    expect(h.fixture.nativeElement.textContent).toContain('La voce è cambiata.');
    expect(h.button('+ Nuova voce').disabled).toBe(true);
    expect(h.fetchMock.mock.calls).toHaveLength(2);
  });
  it('non mostra assegnazioni ai personaggi nel catalogo', async () => {
    const h = await setup();
    expect(h.fixture.nativeElement.textContent).not.toContain('Usata dai personaggi');
    expect(h.fixture.nativeElement.textContent).toContain('dai dettagli del personaggio');
  });
  it('crea una voce senza assegnarla al sistema usato come filtro', async () => {
    const h=await setup();h.button('+ Nuova voce').click();h.fixture.detectChanges();await h.fixture.whenStable();
    const name=h.fixture.nativeElement.querySelector('[name="name"]');name.value='Nuova magia';name.dispatchEvent(new Event('input'));h.fixture.detectChanges();
    h.button('Salva voce').click();
    await vi.waitFor(()=>{h.fixture.detectChanges();expect(h.fixture.nativeElement.textContent).toContain('Puoi includerla nei sistemi');});
    const [,init]=h.fetchMock.mock.calls.find(([,options])=>options?.method==='POST')!;
    expect(JSON.parse(init.body).systemIds).toEqual([]);
  });

});
