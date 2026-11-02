import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GdrCharacters } from './gdr-characters';
import { GdrWorkspaceService, WorkspaceCharacter } from '../../core/gdr-workspace.service';
const character = (id: string, name: string, archived = false): WorkspaceCharacter => ({
  id,
  name,
  archived,
  adventureId: 'story',
  kind: 'pg',
  portrait: '',
  photo: '',
  profile: { surname: '', appearance: '', personality: '', history: '', goal: '', abilities: '' },
  sheet: '',
  inventory: [],
  revision: 1,
  canSpeak: true,
  canEditSheet: true,
  canInventory: true,
});
function setup() {
  TestBed.configureTestingModule({ imports: [GdrCharacters], providers: [GdrWorkspaceService] });
  const workspace = TestBed.inject(GdrWorkspaceService);
  workspace.available.set(true);
  workspace.isMaster.set(true);
  workspace.selectedId.set('story');
  workspace.characters.set([
    character('ada', 'Ada'),
    character('bea', 'Bea'),
    character('old', 'Vecchio', true),
  ]);
  workspace.users.set([{ id: 2, nickname: 'Desy' }]);
  workspace.grants.set([
    { characterId: 'ada', userId: 2, canSpeak: true, canEditSheet: false, canInventory: true },
  ]);
  const fixture = TestBed.createComponent(GdrCharacters);
  fixture.componentRef.setInput('managementMode', true);
  fixture.detectChanges();
  const button = (text: string) =>
    Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).find((b) => b.textContent?.trim() === text)!;
  return { workspace, fixture, button };
}
describe('gestione personaggi del master', () => {
  afterEach(() => TestBed.resetTestingModule());
  it('mostra assegnatari nell’elenco e separa la scheda dalle assegnazioni', () => {
    const { fixture, button } = setup();
    const roster = fixture.nativeElement.querySelector('.roster');
    expect(roster.textContent).toContain('Desy');
    expect(roster.textContent).toContain('Non assegnato');
    expect(roster.textContent).not.toContain('Vecchio');
    expect(fixture.nativeElement.querySelector('.permissions')).toBeNull();
    button('Assegnazioni · 1').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.assignment-card').textContent).toContain('Desy');
    expect(fixture.nativeElement.querySelector('.assignment-card').textContent).toContain(
      'Gestisce zaino',
    );
    expect(fixture.nativeElement.querySelector('.profile-details')).toBeNull();
  });
  it('mantiene le modifiche ai permessi e blocca il cambio sezione finché non vengono annullate', async () => {
    const { workspace, fixture, button } = setup();
    button('Assegnazioni · 1').click();
    fixture.detectChanges();
    button('Modifica permessi').click();
    fixture.detectChanges();
    await fixture.whenStable();
    const checkbox = fixture.nativeElement.querySelector('.check input') as HTMLInputElement;
    checkbox.click();
    fixture.detectChanges();
    expect(workspace.pendingChanges()).toBe(true);
    expect(button('Gestione').disabled).toBe(true);
    button('Annulla').click();
    fixture.detectChanges();
    expect(workspace.pendingChanges()).toBe(false);
    expect(button('Gestione').disabled).toBe(false);
  });
  it('richiede il nome esatto prima di abilitare l’eliminazione', async () => {
    const { workspace, fixture, button } = setup();
    const save = vi.spyOn(workspace, 'save').mockResolvedValue(false);
    button('Gestione').click();
    fixture.detectChanges();
    button('Elimina…').click();
    fixture.detectChanges();
    expect(button('Elimina definitivamente').disabled).toBe(true);
    const input = fixture.nativeElement.querySelector('#delete-character-name') as HTMLInputElement;
    input.value = 'altro';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(button('Elimina definitivamente').disabled).toBe(true);
    input.value = 'Ada';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(button('Elimina definitivamente').disabled).toBe(false);
    button('Elimina definitivamente').click();
    await fixture.whenStable();
    expect(save).toHaveBeenCalledWith({
      action: 'deleteCharacter',
      characterId: 'ada',
      revision: 1,
    });
  });
  it('permette un PG con nome provvisorio senza obbligare il master a scegliere l’identità', async () => {
    const { workspace, fixture, button } = setup();
    const save = vi.spyOn(workspace, 'save').mockResolvedValue(false);
    button('+ PG').click();
    fixture.detectChanges();
    expect(button('Crea PG').disabled).toBe(false);
    button('Crea PG').click();
    await fixture.whenStable();
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'createCharacter',
        kind: 'pg',
        name: 'Personaggio da completare',
      }),
    );
  });
  it('richiede il totale dei punti e nasconde la modifica quando le caratteristiche sono confermate',async()=>{
    const {workspace,fixture,button}=setup();
    const fields=['statMente','statCuore','statCorpo','statMagia'].map(key=>({key,label:key,type:'number',min:1,max:5}));
    workspace.characters.set([{...character('ada','Ada'),revision:2,statsEditable:true,statsBudget:12,canEditStats:true,characterFields:Object.fromEntries(fields.map(f=>[f.key,'1']))}]);
    fixture.componentRef.setInput('managementMode',false);fixture.componentRef.setInput('fields',fields);fixture.detectChanges();await fixture.whenStable();
    expect(button('Conferma caratteristiche').disabled).toBe(true);
    for (const label of ['🧠 Mente', '💛 Cuore', '⚡ Corpo', '✨ Magia']) expect(fixture.nativeElement.textContent).toContain(label);
    for(const field of fields){const input=fixture.nativeElement.querySelector('#base-'+field.key) as HTMLInputElement;input.value='3';input.dispatchEvent(new Event('input'));}
    fixture.detectChanges();await fixture.whenStable();expect(button('Conferma caratteristiche').disabled).toBe(false);expect(button('Modifica personaggio').disabled).toBe(true);
    button('Annulla distribuzione').click();fixture.detectChanges();
    workspace.characters.update(cs=>cs.map(c=>({...c,revision:3,statsEditable:false,canEditStats:false,characterFields:Object.fromEntries(fields.map(f=>[f.key,'3']))})));fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#base-statMente')).toBeNull();expect(button('Conferma caratteristiche')).toBeUndefined();expect(button('Modifica personaggio').disabled).toBe(false);
  });
  it('offre i comandi immediati delle risorse anche senza entrare nella modifica del personaggio',async()=>{
    const {workspace,fixture}=setup();workspace.characters.set([{...character('ada','Ada'),revision:2,canAdjustResources:true,characterFields:{stressCurrent:'10',spellSlotsCurrent:'3'}}]);
    fixture.componentRef.setInput('managementMode',false);fixture.componentRef.setInput('fields',[{key:'stressCurrent',label:'Stress',type:'number',min:0,max:10},{key:'spellSlotsCurrent',label:'Spell slot',type:'number',min:0,max:3}]);fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.player-edit-form')).toBeNull();
    const minus=fixture.nativeElement.querySelector('button[aria-label="Riduci Spell slot"]') as HTMLButtonElement;
    expect(minus.disabled).toBe(false);expect((fixture.nativeElement.querySelector('button[aria-label="Aumenta Stress"]') as HTMLButtonElement).disabled).toBe(true);
    const save=vi.spyOn(workspace,'save').mockResolvedValue(false);minus.click();await fixture.whenStable();
    expect(save).toHaveBeenCalledWith({action:'adjustResource',characterId:'ada',revision:2,fieldKey:'spellSlotsCurrent',delta:-1});
  });
  it('mostra anche un personaggio archiviato se non rimangono attivi', () => {
    const { workspace, fixture } = setup();
    workspace.characters.set([character('old', 'Vecchio', true)]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.identity').textContent).toContain('Vecchio');
  });
});

describe('scheda unica nel pannello della giocatrice',()=>{
 afterEach(()=>TestBed.resetTestingModule());
 it.each([true,false])('unisce il nome esistente nel campo completo, senza duplicare il cognome al salvataggio (master: %s)',async management=>{
  const {workspace,fixture,button}=setup();
  const original={...character('ada','Ana María'),revision:2,profile:{...character('ada','').profile,surname:'de la Vega',history:'Storia conservata'}};
  workspace.characters.set([original]);fixture.componentRef.setInput('managementMode',management);fixture.detectChanges();
  button(management?'Modifica scheda':'Modifica personaggio').click();fixture.detectChanges();await fixture.whenStable();
  expect(fixture.nativeElement.querySelector('#profile-surname')).toBeNull();
  expect((fixture.nativeElement.querySelector('#character-name') as HTMLInputElement).value).toBe('Ana María de la Vega');
  expect(fixture.nativeElement.textContent).toContain('Nome completo');
  button('Annulla').click();fixture.detectChanges();
  expect(workspace.active()?.profile.surname).toBe('de la Vega');
  button(management?'Modifica scheda':'Modifica personaggio').click();fixture.detectChanges();await fixture.whenStable();
  const name=fixture.nativeElement.querySelector('#character-name') as HTMLInputElement;
  name.value='Ana María del Sol';name.dispatchEvent(new Event('input'));fixture.detectChanges();
  const save=vi.spyOn(workspace,'save').mockResolvedValue(false);button('Salva modifiche').click();await fixture.whenStable();
  expect(save).toHaveBeenCalledWith(expect.objectContaining({characterId:'ada',name:'Ana María del Sol',profile:expect.objectContaining({surname:'',history:'Storia conservata'})}));
 });
 it('sceglie una foto dalle miniature e la salva sul PG; annulla ripristina la foto precedente',async()=>{
  const {workspace,fixture,button}=setup();
  workspace.characters.update(cs=>cs.map(c=>c.id==='ada'?{...c,revision:2,portrait:'assets/old-avatar.webp'}:c));fixture.detectChanges();
  fixture.componentRef.setInput('siteImages',[{src:'/assets/lefira.webp',label:'Lefira'}]);
  button('Modifica scheda').click();fixture.detectChanges();
  expect(fixture.nativeElement.querySelector('#character-photo')).toBeNull();
  const thumbnail=fixture.nativeElement.querySelector('button[aria-label="Usa Lefira come foto"]') as HTMLButtonElement;
  thumbnail.click();fixture.detectChanges();
  expect(workspace.pendingChanges()).toBe(true);
  expect((fixture.nativeElement.querySelector('.image-tools .photo') as HTMLImageElement).getAttribute('src')).toBe('/assets/lefira.webp');
  const save=vi.spyOn(workspace,'save').mockResolvedValue(false);
  button('Salva modifiche').click();await fixture.whenStable();
  expect(save).toHaveBeenCalledWith(expect.objectContaining({characterId:'ada',photo:'/assets/lefira.webp',portrait:'/assets/old-avatar.webp'}));
  button('Annulla').click();fixture.detectChanges();
  expect(workspace.pendingChanges()).toBe(false);
  expect(workspace.active()?.photo).toBe('');
 });
 it('legge lo stesso nome e gli stessi campi della gestione e li salva sullo stesso ID',async()=>{
  const {workspace,fixture}=setup();
  workspace.characters.set([{...character('ada','Ada'),revision:2,characterFields:{catName:'Luna',statMente:'4'}}]);
  fixture.componentRef.setInput('managementMode',false);
  fixture.componentRef.setInput('fields',[{key:'name',label:'Nome',type:'text'},{key:'catName',label:'Nome del gatto',type:'text'},{key:'statMente',label:'Mente',type:'number',min:1,max:5}]);fixture.detectChanges();
  expect(fixture.nativeElement.textContent).not.toContain('Nome del gatto');expect(fixture.nativeElement.textContent).toContain('Ada');
  const button=(label:string)=>Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(b=>b.textContent?.trim()===label)!;
  button('Modifica personaggio').click();fixture.detectChanges();await fixture.whenStable();
  expect(fixture.nativeElement.querySelector('#character-sheet')).toBeNull();
  expect(fixture.nativeElement.querySelector('#character-photo')).toBeNull();
  expect(fixture.nativeElement.querySelector('#profile-abilities')).toBeNull();
  const name=fixture.nativeElement.querySelector('#character-name') as HTMLInputElement;name.value='Alba';name.dispatchEvent(new Event('input'));
  expect(fixture.nativeElement.querySelector('#sheet-field-catName')).toBeNull();fixture.detectChanges();
  const save=vi.spyOn(workspace,'save').mockResolvedValue(false);button('Salva modifiche').click();await fixture.whenStable();
  expect(save).toHaveBeenCalledWith(expect.objectContaining({characterId:'ada',name:'Alba',characterFields:{catName:'Luna',statMente:'4'}}));
 });
});

describe('pet assegnati ai PG', () => {
 afterEach(()=>TestBed.resetTestingModule());
 it('il master contrassegna un PNG come pet e salva il PG scelto sullo stesso personaggio',async()=>{
  const {workspace,fixture,button}=setup();
  workspace.characters.update(chars=>[...chars,{...character('sally','Sally'),kind:'png'}]);workspace.activeId.set('sally');fixture.detectChanges();
  button('Modifica scheda').click();fixture.detectChanges();await fixture.whenStable();
  expect(fixture.nativeElement.querySelector('#pet-owner')).toBeNull();
  fixture.nativeElement.querySelector('#character-is-pet').click();fixture.detectChanges();await fixture.whenStable();
  const owner=fixture.nativeElement.querySelector('#pet-owner') as HTMLSelectElement;
  owner.value='ada';owner.dispatchEvent(new Event('change'));fixture.detectChanges();
  const save=vi.spyOn(workspace,'save').mockResolvedValue(false);button('Salva modifiche').click();await fixture.whenStable();
  expect(save).toHaveBeenCalledWith(expect.objectContaining({action:'saveCharacter',characterId:'sally',isPet:true,petOwnerId:'ada'}));
  button('Annulla').click();fixture.detectChanges();expect(workspace.pendingChanges()).toBe(false);
 });
 it('mostra il PG assegnatario nel roster e permette di aprire il pet dalla scheda del PG',()=>{
  const {workspace,fixture,button}=setup();
  workspace.characters.update(chars=>[...chars,{...character('sally','Sally'),kind:'png',isPet:true,petOwnerId:'ada'}]);
  workspace.pets.set([{id:'sally',ownerCharacterId:'ada',name:'Sally',portrait:'/assets/sally.webp',photo:'',description:'Una gatta curiosa.'}]);fixture.detectChanges();
  expect(fixture.nativeElement.querySelector('.roster').textContent).toContain('Pet di Ada');
  expect(fixture.nativeElement.querySelector('.assigned-pets').textContent).toContain('Sally');
  button('Apri PNG').click();fixture.detectChanges();expect(workspace.active()?.id).toBe('sally');
 });
 it('la giocatrice consulta i pet del proprio PG senza ricevere comandi di assegnazione o il vecchio campo del gatto',()=>{
  const {workspace,fixture,button}=setup();workspace.isMaster.set(false);fixture.componentRef.setInput('managementMode',false);
  fixture.componentRef.setInput('fields',[{key:'catName',label:'Nome del gatto',type:'text'}]);
  workspace.pets.set([{id:'sally',ownerCharacterId:'ada',name:'Sally',portrait:'/assets/sally.webp',photo:'',description:'Una gatta curiosa.'},{id:'other',ownerCharacterId:'bea',name:'Altro pet',portrait:'',photo:'',description:''}]);fixture.detectChanges();
  const panel=fixture.nativeElement.querySelector('.assigned-pets');expect(panel.textContent).toContain('Sally');expect(panel.textContent).not.toContain('Altro pet');
  expect(panel.querySelector('img').getAttribute('src')).toBe('/assets/sally.webp');expect(panel.querySelector('button')).toBeNull();
  button('Modifica personaggio').click();fixture.detectChanges();
  expect(fixture.nativeElement.querySelector('#character-is-pet')).toBeNull();expect(fixture.nativeElement.querySelector('#sheet-field-catName')).toBeNull();
 });
});
