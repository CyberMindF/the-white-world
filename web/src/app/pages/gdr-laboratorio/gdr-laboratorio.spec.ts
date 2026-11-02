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
import { GdrNpcGridData } from '../../shared/gdr-blocks/gdr-block.types';

const assignedVoices = signal<{id:string;name:string;profile:{surname:string};portrait:string;kind:'pg'|'png'}[]>([]);
class TurnPage extends GdrLaboratorio {
  draft(text: string) { this.updateDraft(text); }
  voices() { return this.characters(); }
  preview() { this.turnPreview.set(true); }
  leavePreview() { this.turnPreview.set(false); }
  send() { return this.publish(); }
  tools() { return {master: this.canPrepare(), notesReadOnly: this.notesReadOnly()}; }
  imageNames() { return this.siteImages().map(image=>image.label); }
  storyPhoto() { return (this.narrativeBlocks()[0].data as GdrNpcGridData).entries[0].image; }
  seedStory() { this.blocks.set([{id:'9',documentKey:'avventura',position:0,type:'npc_grid',data:{entries:[{name:'Shivay',image:'/assets/originale.webp',alt:'Shivay',description:'Compagna'}]}}]); }
  removeStoryBlock(id:string) {return this.deleteStoryBlock(id);}
  storyCount() {return this.narrativeBlocks().length;}
  editStory(id:string,source:string){return this.saveStoryBlock({id,source});}
  sharedReading(){return this.sharedStorySource();}
  privateDraft(source:string){this.updateDocument(source);}
  seedTurn(turn:{id:number;author:string;isMine:boolean;isMaster:boolean;body:string;createdAt:string}) {this.turns.set([turn]);}
  removeTurnPart(body:string) {return this.savePublishedTurn(this.turns()[0],body);}
  beginPlayerEdit(){this.editPlayerTurn(this.turns()[0]);}
  changePlayerEdit(body:string){this.playerTurnDraft.set(body);}
  previewPlayerEdit(){this.playerTurnPreview.set(true);}
  savePlayerEdit(){return this.savePlayerTurnEdit();}
  cancelPlayerEdit(){this.cancelPlayerTurnEdit();}
  canChange(turn=this.turns()[0]){return this.canEditPublishedTurn(turn);}
  editingPlayerState(){return {turn:this.playerTurnEdit(),draft:this.playerTurnDraft(),error:this.playerTurnEditError(),id:this.publishedEditId()};}
  state() { return { local: this.local(), turns: this.turns(), status: this.status(), error: this.turnsError() }; }
}
function create(live = true, player = false) {
  TestBed.configureTestingModule({providers: [
    {provide: AuthService, useValue: {currentUser: signal({id: 7, nickname: 'Rory'}), isAdmin: signal(!player), impersonation: signal(null)}},
    {provide: SafeModeService, useValue: {enabled: signal(false)}},
    {provide: RealtimeService, useValue: {on: () => EMPTY}},
    {provide: GdrWorkspaceService, useValue: {adventures: signal([]), characters: signal([]), storyCharacters: signal([]), voices: assignedVoices, available: signal(true)}},
    {provide: ActivatedRoute, useValue: {snapshot: {paramMap: convertToParamMap(live ? {adventureId: 'il-prezzo-della-verita'} : {})}}},
  ]});
  const page = TestBed.runInInjectionContext(() => new TurnPage());
  page.preview();
  return page;
}
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), {status});
const saved = {saved: true, turnId: 42, author: 'Rory', isMaster:true, createdAt: '2026-10-31T22:00:00Z'};
describe('invio dei turni della partita reale', () => {
  beforeEach(() => {localStorage.clear(); assignedVoices.set([]);});
  afterEach(() => { vi.unstubAllGlobals(); TestBed.resetTestingModule(); });
  it('usa il personaggio della scheda classica per il dialogo della giocatrice', () => {
    const page=create(true,true);
    expect(page.voices()).toEqual([]);
  });
  it('elimina il blocco iniziale sul server e aggiorna la storia senza cancellare altri dati',async()=>{
    const fetchMock=vi.fn().mockResolvedValue(reply({deleted:true}));vi.stubGlobal('fetch',fetchMock);
    const page=create();page.seedStory();await page.removeStoryBlock('9');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/gdr-blocks/9');expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');expect(page.storyCount()).toBe(0);
  });
  it('una vecchia bozza privata non sostituisce mai il contenuto della partita condivisa',()=>{
    const page=create();page.seedStory();const shared=page.sharedReading();page.privateDraft('Solo nel browser del master.');
    expect(page.sharedReading()).toBe(shared);expect(page.sharedReading()).not.toContain('Solo nel browser');
  });
  it('salva un dialogo iniziale nella riga condivisa e non crea una nuova copia privata',async()=>{
    const source='::: dialogo Shivay | /assets/avatar.webp\nNon è una buona notizia.\n:::';
    const fetchMock=vi.fn().mockResolvedValue(reply({id:'9',documentKey:'avventura',position:0,type:'paragraph',data:{text:source,format:'gdr-narrative'},updatedAt:'nuova'}));vi.stubGlobal('fetch',fetchMock);
    const page=create();page.seedStory();await page.editStory('9',source);
    expect(fetchMock.mock.calls[0][1].method).toBe('PUT');expect(JSON.parse(fetchMock.mock.calls[0][1].body).data).toEqual({text:source,format:'gdr-narrative'});
    expect(page.sharedReading()).toBe(source);expect(page.state().local.documentDraft).toBeNull();
  });
  it('salva la rimozione di un paragrafo pubblicato e cancella l’intervento quando si rimuove l’ultimo blocco',async()=>{
    const fetchMock=vi.fn().mockImplementation(async()=>reply({saved:true}));vi.stubGlobal('fetch',fetchMock);
    const page=create();page.seedTurn({id:8,author:'Rory',isMine:true,isMaster:true,body:'Prima.\n\nDopo.',createdAt:'2026-11-02T00:00:00Z'});
    await page.removeTurnPart('Dopo.');expect(fetchMock.mock.calls[0][1].method).toBe('PUT');expect(page.state().turns[0].body).toBe('Dopo.');
    await page.removeTurnPart('');expect(fetchMock.mock.calls[1][1].method).toBe('DELETE');expect(page.state().turns).toHaveLength(0);
  });
  it('la giocatrice modifica il proprio turno dopo l’anteprima senza inviarne uno nuovo o perdere la bozza successiva',async()=>{
    const fetchMock=vi.fn().mockResolvedValue(reply({saved:true}));vi.stubGlobal('fetch',fetchMock);
    const page=create(true,true);page.seedTurn({id:8,author:'Desy',isMine:true,isMaster:false,body:'Prima risposta.',createdAt:'2026-11-01T12:00:00Z'});page.draft('Il prossimo turno.');
    page.beginPlayerEdit();page.changePlayerEdit('Risposta corretta.');await page.savePlayerEdit();expect(fetchMock).not.toHaveBeenCalled();
    page.previewPlayerEdit();await page.savePlayerEdit();
    expect(fetchMock.mock.calls[0][1].method).toBe('PUT');expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({id:8,adventure:'il-prezzo-della-verita',expectedBody:'Prima risposta.',body:'Risposta corretta.'});
    expect(page.state().turns).toHaveLength(1);expect(page.state().turns[0].body).toBe('Risposta corretta.');expect(page.state().turns[0].createdAt).toBe('2026-11-01T12:00:00Z');
    expect(page.editingPlayerState().turn).toBeNull();expect(page.state().local.draft).toBe('Il prossimo turno.');
  });
  it('un errore conserva la modifica player; Annulla ripristina la lettura del testo pubblicato',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(reply({error:'Il turno è cambiato.'},409)));
    const page=create(true,true);page.seedTurn({id:8,author:'Desy',isMine:true,isMaster:false,body:'Testo pubblicato.',createdAt:'2026-11-01T12:00:00Z'});
    page.beginPlayerEdit();page.changePlayerEdit('Da conservare.');page.previewPlayerEdit();await page.savePlayerEdit();
    expect(page.editingPlayerState().draft).toBe('Da conservare.');expect(page.editingPlayerState().error).toContain('Il turno è cambiato.');expect(page.state().turns[0].body).toBe('Testo pubblicato.');
    page.cancelPlayerEdit();expect(page.editingPlayerState().turn).toBeNull();expect(page.editingPlayerState().id).toBeNull();expect(page.state().turns[0].body).toBe('Testo pubblicato.');
  });
  it('i comandi di modifica restano personali e l’impersonificazione resta in sola lettura',()=>{
    const page=create(true,true);page.seedTurn({id:8,author:'Rory',isMine:false,isMaster:true,body:'Racconto.',createdAt:'2026-11-01T12:00:00Z'});expect(page.canChange()).toBe(false);
    page.seedTurn({id:9,author:'Desy',isMine:true,isMaster:false,body:'Risposta.',createdAt:'2026-11-01T12:00:00Z'});expect(page.canChange()).toBe(true);
    TestBed.inject(AuthService).impersonation.set({actorId:1,actorNickname:'Rory',readOnly:true});expect(page.canChange()).toBe(false);
  });
  it('la giocatrice conserva gli strumenti semplici e i propri appunti modificabili',()=>{
    const page=create(true,true);expect(page.tools()).toEqual({master:false,notesReadOnly:false});
  });
  it('mantiene professori e PNG nella raccolta anche senza immagini nel racconto o personaggi già creati',()=>{
    const page=create();expect(page.imageNames()).toEqual(expect.arrayContaining(['Valin Fajar','Maerath Solven','Sorenne Caldri','Shivay Lorenne','Lefira Marsan','Pyron Feddott','Dravon Tassyr']));
  });
  it('usa la foto completa nella storia anche quando il PNG ha un nuovo avatar',()=>{
    const page=create();page.seedStory();
    const workspace=TestBed.inject(GdrWorkspaceService);
    const npc={sourceKey:'npc:9:0',deleted:false,name:'Shivay',photo:'/assets/intera.webp',portrait:'/assets/ritaglio.webp',description:'Compagna'};
    workspace.storyCharacters.set([npc]);expect(page.storyPhoto()).toBe('/assets/intera.webp');
    workspace.storyCharacters.set([{...npc,portrait:'/assets/altro-ritaglio.webp'}]);expect(page.storyPhoto()).toBe('/assets/intera.webp');
    workspace.storyCharacters.set([{...npc,photo:''}]);expect(page.storyPhoto()).toBe('/assets/originale.webp');
  });
  it('il master ha gli strumenti della storia; impersonare Desy lascia gli appunti in sola lettura',()=>{
    const page=create();expect(page.tools()).toEqual({master:true,notesReadOnly:false});
    TestBed.inject(AuthService).impersonation.set({actorId:1,actorNickname:'Rory',readOnly:true});
    expect(page.tools().notesReadOnly).toBe(true);
  });
  it('rende disponibili alla giocatrice anche i personaggi che il master le ha assegnato',()=>{
    const page=create(true,true);
    assignedVoices.set([{id:'npc',name:'Shivay',profile:{surname:'Lorenne'},portrait:'',kind:'png'}]);
    expect(page.voices().map(c=>c.name)).toEqual(['Shivay Lorenne']);
  });
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
    expect(page.state().turns[0].isMaster).toBe(true);
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
