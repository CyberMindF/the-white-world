import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../core/auth.service';
import { TelemetryService } from '../../core/telemetry.service';
import { AppShell } from '../../shell/app-shell';
import { EditorialText } from '../../shared/editorial-text/editorial-text';
import { ConfirmationDialog } from '../../shared/confirmation-dialog/confirmation-dialog';
import { CoseInsieme } from './cose-insieme';

const activity = {
  id: 79, number: 79, text: 'Una passeggiata', category: 'categoria-storica',
  link: null, approximateDate: '11/11/2026', hasPrivatePart: false,
  privateOnly: false, status: 'todo'
};

async function setup() {
  const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) =>
    Promise.resolve(Response.json(init?.method ? { id: 80 } : { activities: [activity] }))
  );
  vi.stubGlobal('fetch', fetchMock);
  TestBed.configureTestingModule({
    imports: [CoseInsieme],
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: { isAdmin: () => true, adminModeEnabled: () => true } },
      { provide: TelemetryService, useValue: { trackEvent: vi.fn() } }
    ]
  });
  TestBed.overrideComponent(CoseInsieme, {
    remove: { imports: [AppShell, EditorialText, ConfirmationDialog] },
    add: { schemas: [NO_ERRORS_SCHEMA] }
  });
  const fixture = TestBed.createComponent(CoseInsieme);
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, fetchMock };
}

function button(fixture: ComponentFixture<CoseInsieme>, label: string): HTMLButtonElement {
  const found = [...fixture.nativeElement.querySelectorAll('button')] as HTMLButtonElement[];
  const result = found.find(element => element.textContent?.trim() === label);
  if (!result) throw new Error(`Pulsante non trovato: ${label}`);
  return result;
}

async function createDraft(fixture: ComponentFixture<CoseInsieme>) {
  button(fixture, '➕ Aggiungi attività').click();
  fixture.detectChanges();
  await fixture.whenStable();
  for (const [name, value] of [['text', 'Fare delle foto insieme'], ['approximateDate', '11/11/2026']]) {
    const input = fixture.nativeElement.querySelector(`[name="${name}"]`) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }
  const category = fixture.nativeElement.querySelector('[role="combobox"][aria-label="Categoria"]');
  category.click();
  fixture.detectChanges();
  button(fixture, 'Foto e ricordi').click();
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('salvataggio nell’Agenda delle Idee', () => {
  afterEach(() => { TestBed.resetTestingModule(); vi.unstubAllGlobals(); });

  it('sceglie una categoria leggibile e invia la chiave accettata dal server', async () => {
    const { fixture, fetchMock } = await setup();
    await createDraft(fixture);
    expect(fixture.nativeElement.querySelector('input[type="text"][name="category"]')).toBeNull();
    button(fixture, 'Salva').click();
    await fixture.whenStable();
    fixture.detectChanges();
    const mutation = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(mutation?.[0]).toBe('/api/together/activities');
    expect(JSON.parse(mutation![1].body as string)).toMatchObject({
      text: 'Fare delle foto insieme', category: 'ricordi', approximateDate: '11/11/2026'
    });
    expect(fixture.nativeElement.querySelector('.activity-form')).toBeNull();
  });

  it('conserva le categorie storiche nella select durante la modifica', async () => {
    const { fixture, fetchMock } = await setup();
    fetchMock.mockResolvedValueOnce(Response.json({ activities: [{ ...activity, privateText: null }] }));
    button(fixture, '✏️ Modifica').click();
    await fixture.whenStable();
    fixture.detectChanges();
    const category = fixture.nativeElement.querySelector('[role="combobox"][aria-label="Categoria"]');
    expect(category.textContent).toContain('categoria-storica');
    category.click();
    fixture.detectChanges();
    expect(button(fixture, 'Foto e ricordi')).toBeDefined();
    expect(button(fixture, 'categoria-storica')).toBeDefined();
    button(fixture, 'categoria-storica').click();
    fixture.detectChanges();
    button(fixture, 'Salva').click();
    await fixture.whenStable();
    const mutation = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(mutation?.[0]).toBe('/api/together/activities/79');
    expect(JSON.parse(mutation![1].body as string).category).toBe('categoria-storica');
  });

  it('mostra il motivo del rifiuto senza perdere la bozza e permette di riprovare', async () => {
    const { fixture, fetchMock } = await setup();
    await createDraft(fixture);
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'Sessione non valida o scaduta.' }, { status: 401 }));
    button(fixture, 'Salva').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('Sessione non valida o scaduta.');
    expect(fixture.nativeElement.querySelector('[name="text"]').value).toBe('Fare delle foto insieme');
    expect(button(fixture, 'Salva').disabled).toBe(false);
    button(fixture, 'Salva').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.activity-form')).toBeNull();
  });

  it('impedisce invii duplicati durante il salvataggio', async () => {
    const { fixture, fetchMock } = await setup();
    await createDraft(fixture);
    let complete!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { complete = resolve; }));
    button(fixture, 'Salva').click();
    fixture.detectChanges();
    expect(button(fixture, 'Salvataggio…').disabled).toBe(true);
    fixture.nativeElement.querySelector('form.activity-form').dispatchEvent(new Event('submit', { cancelable: true }));
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    complete(Response.json({ id: 80 }));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.activity-form')).toBeNull();
  });
});
