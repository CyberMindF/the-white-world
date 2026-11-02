import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GdrNotesEditor } from './gdr-notes-editor';

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status});
async function setup(readOnly = false, failLoad = false) {
  const fetchMock = vi.fn().mockResolvedValueOnce(reply({body:'<p>Indizio salvato</p>'}, failLoad ? 500 : 200)).mockImplementation(async () => reply({saved:true}));
  vi.stubGlobal('fetch', fetchMock);
  TestBed.configureTestingModule({imports:[GdrNotesEditor]});
  const fixture = TestBed.createComponent(GdrNotesEditor);
  fixture.componentRef.setInput('adventure','il-prezzo-della-verita');
  fixture.componentRef.setInput('readOnly',readOnly); fixture.detectChanges();
  const editor = fixture.nativeElement.querySelector('[aria-label="I tuoi appunti"]') as HTMLDivElement;
  await vi.waitFor(() => {
    fixture.detectChanges();
    if (failLoad) expect(fixture.nativeElement.textContent).toContain('Riprova caricamento');
    else expect(editor.innerHTML).toBe('<p>Indizio salvato</p>');
  });
  return {fixture,editor,fetchMock};
}

describe('appunti personali della partita', () => {
  afterEach(() => {TestBed.resetTestingModule();vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});
  it('carica gli appunti dell’account e salva le modifiche per la stessa avventura', async () => {
    const {fixture,editor,fetchMock} = await setup(); vi.useFakeTimers();
    expect(editor.getAttribute('contenteditable')).toBe('true');
    editor.innerHTML='<p>Un nuovo indizio</p>'; editor.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(800); fixture.detectChanges();
    const [url,options] = fetchMock.mock.calls[1];
    expect(url).toBe('/api/gdr/notes');expect(options.credentials).toBe('same-origin');
    expect(options.body.get('adventure')).toBe('il-prezzo-della-verita');
    expect(options.body.get('body')).toBe('<p>Un nuovo indizio</p>');
    expect(fixture.nativeElement.textContent).toContain('Salvato nel tuo account.');
  });
  it('invia l’ultima modifica anche lasciando la pagina prima dell’autosalvataggio', async () => {
    const {fixture,editor,fetchMock} = await setup();vi.useFakeTimers();
    editor.innerHTML='Non perdere questo appunto';editor.dispatchEvent(new Event('input'));
    fixture.destroy();await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].body.get('body')).toBe('Non perdere questo appunto');
    expect(fetchMock.mock.calls[1][1].keepalive).toBe(true);
  });
  it('impedisce che un caricamento fallito sovrascriva gli appunti salvati', async () => {
    vi.spyOn(console,'error').mockImplementation(()=>{});
    const {editor,fetchMock} = await setup(false,true);vi.useFakeTimers();
    expect(editor.getAttribute('contenteditable')).toBe('false');
    editor.dispatchEvent(new Event('input'));await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('conserva il testo e permette di ritentare dopo un errore di salvataggio', async () => {
    vi.spyOn(console,'error').mockImplementation(()=>{});
    const {fixture,editor,fetchMock} = await setup();vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(reply({},500));
    editor.innerHTML='Appunto da ritentare';editor.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(800);fixture.detectChanges();
    expect(editor.innerHTML).toBe('Appunto da ritentare');
    const retry=Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(b=>b.textContent?.includes('Riprova salvataggio'))!;
    retry.click();await vi.advanceTimersByTimeAsync(0);fixture.detectChanges();
    expect(fetchMock.mock.calls[2][1].body.get('body')).toBe('Appunto da ritentare');
    expect(fixture.nativeElement.textContent).toContain('Salvato nel tuo account.');
  });
  it('in impersonificazione o anteprima legge senza consentire scritture', async () => {
    const {fixture,editor,fetchMock} = await setup(true);vi.useFakeTimers();
    expect(editor.getAttribute('contenteditable')).toBe('false');
    expect(fixture.nativeElement.querySelector('.gdr-notes-toolbar')).toBeNull();
    editor.dispatchEvent(new Event('input'));await vi.advanceTimersByTimeAsync(1000);fixture.destroy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('mantiene l’ordine dei salvataggi quando si continua a scrivere durante una richiesta lenta', async () => {
    const {fixture,editor,fetchMock}=await setup();vi.useFakeTimers();
    let finish!: (response:Response)=>void;
    fetchMock.mockImplementationOnce(()=>new Promise<Response>(resolve=>finish=resolve));
    editor.innerHTML='Prima versione';editor.dispatchEvent(new Event('input'));await vi.advanceTimersByTimeAsync(800);
    editor.innerHTML='Versione più recente';editor.dispatchEvent(new Event('input'));await vi.advanceTimersByTimeAsync(800);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    finish(reply({saved:true}));await vi.advanceTimersByTimeAsync(0);fixture.detectChanges();
    expect(fetchMock.mock.calls[2][1].body.get('body')).toBe('Versione più recente');
    expect(fixture.nativeElement.textContent).toContain('Salvato nel tuo account.');
  });
});
