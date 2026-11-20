import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GdrSourceEditor } from './gdr-source-editor';
import { GdrTurn } from '../gdr-turn/gdr-turn';
import { AppSelect } from '../app-select/app-select';
import { parseNarrative } from '../gdr-turn/gdr-turn.parser';

describe('anteprima prima della pubblicazione', () => {
  afterEach(() => TestBed.resetTestingModule());
  function setup(source: string) {
    TestBed.configureTestingModule({imports:[GdrSourceEditor]});
    const fixture=TestBed.createComponent(GdrSourceEditor);
    fixture.componentRef.setInput('source',source);
    fixture.detectChanges();
    const button=(label:string) => Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(b=>!b.matches('[role=combobox], [role=option]') && b.textContent?.trim()===label)!;
    const select=(name:string)=>fixture.debugElement.queryAll(By.directive(AppSelect)).find(element=>element.componentInstance.ariaLabel===name)!;
    const option=(label:string)=>(select('Tipo di blocco').componentInstance as AppSelect).options.find(option=>option.label===label);
    const chooseSelect=(name:string,label:string)=>{
      const element=select(name).nativeElement as HTMLElement;
      (element.querySelector('[role=combobox]') as HTMLButtonElement).click();fixture.detectChanges();
      (Array.from(element.querySelectorAll<HTMLButtonElement>('[role=option]')).find(option=>option.textContent?.trim()===label)!).click();fixture.detectChanges();
    };
    const choose=(label:string)=>chooseSelect('Tipo di blocco',label);
    const choosePerson=(label:string)=>chooseSelect('Personaggio',label);
    const add=(label:string)=>{choose(label);button('Aggiungi').click();fixture.detectChanges();};
    return {fixture,button,option,choose,choosePerson,select,add};
  }
  it('richiede del testo e mostra l’anteprima senza emettere un invio', () => {
    const {fixture,button,option,choose,add}=setup('   ');
    expect(button('Solo anteprima').disabled).toBe(true);
    fixture.componentRef.setInput('source','Mi avvicino alla porta.'); fixture.detectChanges();
    expect(button('Solo anteprima').disabled).toBe(false);
    fixture.componentInstance.openPreview(); fixture.detectChanges();
    expect(fixture.debugElement.query(By.directive(GdrTurn)).componentInstance.editable()).toBe(false);
    button('Torna al testo').click(); fixture.detectChanges();
    expect(fixture.debugElement.query(By.directive(GdrTurn))).toBeNull();
  });
  it('lascia l’anteprima affiancata in sola lettura e torna al testo dopo aver svuotato la bozza', () => {
    const {fixture,button,option,choose,add}=setup('La storia continua.');
    button('Testo e anteprima').click(); fixture.detectChanges();
    expect(fixture.debugElement.query(By.directive(GdrTurn)).componentInstance.editable()).toBe(false);
    fixture.componentInstance.openPreview(); fixture.detectChanges();
    fixture.componentRef.setInput('source',''); fixture.detectChanges();
    expect(fixture.debugElement.query(By.directive(GdrTurn))).toBeNull();
    expect(button('Solo anteprima').disabled).toBe(true);
  });
  it('mostra strumenti brevi senza immagini o comandi di sintassi nella vista giocatrice', () => {
    const {fixture,button,option,choose,add}=setup('Ciao');
    expect(option('Dialogo')).toBeTruthy();expect(button('Dialogo')).toBeUndefined();expect(button('Aggiungi')).toBeTruthy();
    expect(option('Azione')).toBeTruthy();
    expect(option('Nota')).toBeTruthy();
    expect(option('Immagine')).toBeUndefined();
    expect(option('PNG a tutta pagina')).toBeUndefined();
    expect(button('Cambia voce nel dialogo')).toBeUndefined();
    expect(fixture.nativeElement.querySelector('pre, code')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Personaggio');
    fixture.componentRef.setInput('allowImages',true); fixture.detectChanges();
    expect(option('Immagine')).toBeTruthy();
  });
  it('trasforma la frase selezionata in un dialogo del personaggio scelto', async () => {
    const {fixture,button,option,choose,add}=setup('Ciao');
    fixture.componentRef.setInput('characters',[{name:'Ada',portrait:''}]); fixture.detectChanges();
    await fixture.whenStable();
    let updated='';
    fixture.componentInstance.sourceChange.subscribe(value=>updated=value);
    const area=fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    area.setSelectionRange(0,4);
    add('Dialogo'); fixture.detectChanges();
    expect(updated).toContain('::: dialogo Ada\nCiao\n:::');
  });
  it.each([
    ['Lettera', 'lettera', false], ['Messaggio', 'messaggio', false],
    ['Lettera', 'lettera', true], ['Messaggio', 'messaggio', true],
  ] as const)('inserisce %s (%s, master: %s) con codici modificabili nella textbox', async (label,kind,masterTools) => {
    const {fixture,button,choose,choosePerson}=setup('Un saluto.');
    fixture.componentRef.setInput('masterTools',masterTools);
    fixture.componentRef.setInput('characters',[{id:'pg',name:'Daisy',portrait:''}]);
    fixture.componentRef.setInput('characterRoster',[{id:'npc',name:'Ada',portrait:'/assets/a.webp',kind:'png'}]);
    let saved='';fixture.componentInstance.sourceChange.subscribe(source=>{saved=source;fixture.componentRef.setInput('source',source);});
    fixture.detectChanges();await fixture.whenStable();choose(label);await fixture.whenStable();
    if(kind==='messaggio'){choosePerson('Ada · PNG');await fixture.whenStable();}
    expect(saved).toBe('');expect(fixture.nativeElement.querySelector('.insertion-details')).toBeNull();
    const area=fixture.nativeElement.querySelector('.source-pane textarea') as HTMLTextAreaElement;
    area.setSelectionRange(0,10);button('Aggiungi').click();fixture.detectChanges();
    await vi.waitFor(()=>{fixture.detectChanges();expect(document.activeElement).toBe(area);expect(area.value.slice(area.selectionStart,area.selectionEnd)).toBe('Un saluto.');});
    expect(area.value).toContain('DATA: (Elimina se non ti serve)');
    expect(area.value).not.toContain('characterId');expect(area.value).not.toContain('"signature"');
    expect(fixture.nativeElement.querySelector('.source-pane').hidden).toBe(false);
    expect(fixture.nativeElement.querySelector('.inline-editor')).toBeNull();
    area.value=area.value.replace('DATA: (Elimina se non ti serve)','DATA: Terza luna');
    if(kind==='lettera') area.value=area.value.replace(/^FIRMA:.*\n/m,'');
    else area.value=area.value.replace('ORA: (Elimina se non ti serve)','ORA: Dopo cena');
    area.dispatchEvent(new Event('input'));fixture.detectChanges();await fixture.whenStable();
    const section=parseNarrative(saved).sections[0];expect(section.kind).toBe(kind);
    expect(section.correspondence?.date).toBe('Terza luna');expect(section.text).toBe('Un saluto.');
    if(kind==='lettera')expect(section.correspondence?.signature).toBe('');
    else {expect(section.characterId).toBe('npc');expect(section.correspondence?.time).toBe('Dopo cena');}
    button('Solo anteprima').click();fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.inline-editor, button.edit-start, button.edit-speaker')).toBeNull();
    expect(fixture.debugElement.query(By.directive(GdrTurn)).componentInstance.editable()).toBe(false);

  });
  it.each([
    ['Azione', 'azione', false], ['Azione', 'azione', true],
    ['Dialogo', 'dialogo', false], ['Pensiero', 'pensiero', false],
    ['Dialogo', 'dialogo', true], ['Pensiero', 'pensiero', true],
  ] as const)('inserisce %s (%s) nella textbox senza modifica rapida (anteprima affiancata: %s)', async (label, kind, split) => {
    const original = 'Prima.\n\nCiao\n\nDopo.';
    const {fixture,button,option,choose,add}=setup(original);
    fixture.componentRef.setInput('characters',[{id:'ada-1',name:'Ada',portrait:'/assets/ada.webp'}]);
    let saved='';fixture.componentInstance.sourceChange.subscribe(value=>{saved=value;fixture.componentRef.setInput('source',value);});
    const editing=vi.fn();fixture.componentInstance.editingChange.subscribe(editing);
    fixture.detectChanges();await fixture.whenStable();
    if(split) { button('Testo e anteprima').click();fixture.detectChanges(); }
    const area=fixture.nativeElement.querySelector('.source-pane textarea') as HTMLTextAreaElement;
    const start=original.indexOf('Ciao');area.setSelectionRange(start,start+4);
    add(label);fixture.detectChanges();
    await vi.waitFor(()=>{
      fixture.detectChanges();
      expect(document.activeElement).toBe(area);
      expect(area.value.slice(area.selectionStart,area.selectionEnd)).toBe('Ciao');
    });
    expect(saved).toBe(`Prima.\n\n::: ${kind} Ada |  | ada-1\nCiao\n:::\n\nDopo.`);
    expect(area.value).toBe(`Prima.\n\n::: ${kind} Ada\nCiao\n:::\n\nDopo.`);
    expect(fixture.nativeElement.querySelector('.source-pane').hidden).toBe(false);
    expect(fixture.nativeElement.querySelector('.inline-editor')).toBeNull();
    expect(editing).not.toHaveBeenCalledWith(true);
    expect(fixture.debugElement.query(By.directive(GdrTurn))?.componentInstance.editable() ?? false).toBe(false);
    expect(parseNarrative(saved).sections[1]).toMatchObject({kind,characterId:'ada-1',speaker:'Ada',text:'Ciao'});
  });
  it('mantiene il personaggio scelto cambiando tipo e permette un contatto libero nel messaggio', async () => {
    const {fixture,button,choose,choosePerson}=setup('Ciao.');
    fixture.componentRef.setInput('characters',[{id:'pg',name:'Daisy',portrait:''}]);
    fixture.componentRef.setInput('characterRoster',[{id:'npc',name:'Ada',portrait:''},{id:'pg',name:'Daisy',portrait:''}]);
    let saved='';fixture.componentInstance.sourceChange.subscribe(value=>{saved=value;fixture.componentRef.setInput('source',value);});
    fixture.detectChanges();await fixture.whenStable();choose('Messaggio');await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[role=combobox][aria-label="Personaggio"]').textContent).toContain('Daisy');
    choosePerson('Nome o numero libero');await fixture.whenStable();
    const area=fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;area.setSelectionRange(0,5);
    button('Aggiungi').click();fixture.detectChanges();await fixture.whenStable();
    area.value=area.value.replace('CONTATTO: (Elimina se non ti serve)','CONTATTO: +39 123');area.dispatchEvent(new Event('input'));fixture.detectChanges();
    expect(parseNarrative(saved).sections[0]).toMatchObject({kind:'messaggio',speaker:'+39 123',characterId:'',text:'Ciao.'});
    expect(area.value).not.toContain('characterId');

  });
  it('offre l’impaginazione solo al master e converte la selezione in titoli o riquadri validi', async () => {
    const {fixture,button,option,choose,add}=setup('Un incontro');
    expect(option('Titolo')).toBeUndefined();expect(option('Tabella')).toBeUndefined();
    fixture.componentRef.setInput('masterTools',true);fixture.detectChanges();
    await fixture.whenStable();
    for(const label of ['Titolo','Sottotitolo','Riquadro','Elenco','Tabella','Corsivo','Grassetto','Sottolineato']) expect(option(label)).toBeTruthy();
    const area=fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    area.setSelectionRange(0,11);let result='';fixture.componentInstance.sourceChange.subscribe(value=>result=value);
    add('Sottotitolo');expect(result.trim()).toBe('### Un incontro');expect(parseNarrative(result).errors).toEqual([]);
    add('Riquadro');expect(result).toContain('::: callout\nUn incontro\n:::');expect(parseNarrative(result).errors).toEqual([]);
    fixture.componentRef.setInput('masterTools',false);fixture.detectChanges();expect(option('Titolo')).toBeUndefined();
  });
  it.each([['Grassetto','**','strong'],['Sottolineato','__','u'],['Corsivo','*','em']])('applica %s solo alla frase selezionata e lo mostra in anteprima', async (label,marker,tag) => {
    const {fixture,option,add,button}=setup('Prima parola dopo.');
    expect(option(label)).toBeUndefined();
    fixture.componentRef.setInput('masterTools',true);
    let saved='';fixture.componentInstance.sourceChange.subscribe(value=>{saved=value;fixture.componentRef.setInput('source',value);});
    fixture.detectChanges();await fixture.whenStable();
    const area=fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;area.setSelectionRange(6,12);
    add(label);
    await vi.waitFor(()=>{fixture.detectChanges();expect(document.activeElement).toBe(area);expect(area.value.slice(area.selectionStart,area.selectionEnd)).toBe('parola');});
    expect(saved).toBe(`Prima ${marker}parola${marker} dopo.`);
    expect(fixture.nativeElement.querySelector('.inline-editor')).toBeNull();
    button('Solo anteprima').click();fixture.detectChanges();
    expect(fixture.nativeElement.querySelector(`.preview-pane app-gdr-blocks p ${tag}`)?.textContent).toBe('parola');
    fixture.componentRef.setInput('masterTools',false);fixture.detectChanges();expect(option(label)).toBeUndefined();
  });
  it('inserisce un’immagine scelta dalle miniature senza richiedere un percorso', () => {
    const {fixture,button,option,choose,add}=setup('');
    fixture.componentRef.setInput('allowImages',true);
    fixture.componentRef.setInput('images',[{src:'/assets/castello.webp',label:'Il castello'}]);fixture.detectChanges();
    let result='';fixture.componentInstance.sourceChange.subscribe(value=>result=value);
    add('Immagine');fixture.detectChanges();
    expect(result).toBe('');expect(fixture.nativeElement.querySelector('.library-tools')).toBeNull();
    (fixture.nativeElement.querySelector('button[aria-label="Inserisci Il castello"]') as HTMLButtonElement).click();fixture.detectChanges();
    expect(result.trim()).toBe('![Il castello](/assets/castello.webp)');expect(parseNarrative(result).errors).toEqual([]);
    expect(fixture.nativeElement.querySelector('.image-picker')).toBeNull();
  });
  it('inserisce il PNG selezionato a tutta pagina senza passare dalla libreria immagini',async()=>{
    const {fixture,button,option,choose,add}=setup('');fixture.componentRef.setInput('masterTools',true);
    fixture.componentRef.setInput('characters',[{name:'Shivay',kind:'png',portrait:'/assets/avatar.webp',photo:'/assets/intera.webp',description:'Una compagna.'}]);fixture.detectChanges();await fixture.whenStable();
    let updated='';fixture.componentInstance.sourceChange.subscribe(value=>updated=value);
    add('PNG a tutta pagina');
    const parsed=parseNarrative(updated);expect(parsed.errors).toEqual([]);expect(parsed.sections[0].blocks[0]).toMatchObject({type:'npc_grid',data:{layout:'full',entries:[{name:'Shivay',image:'/assets/intera.webp',description:'Una compagna.'}]}});
    expect(fixture.nativeElement.querySelector('.image-picker')).toBeNull();
  });
  it('non aggiunge righe vuote in fondo e riusa quelle attorno alla selezione', async()=>{
    const {fixture,button,option,choose,add}=setup('');await fixture.whenStable();
    let updated='';fixture.componentInstance.sourceChange.subscribe(value=>updated=value);
    const area=fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    add('Azione');expect(updated).toBe('::: azione\nDescrivi cosa fa il personaggio.\n:::');
    const source='Prima.\r\n\r\nCiao.\r\n\r\nDopo.';
    fixture.componentRef.setInput('source',source);fixture.detectChanges();await fixture.whenStable();
    const start=area.value.indexOf('Ciao.');area.setSelectionRange(start,start+5);
    add('Nota');expect(updated).toBe('Prima.\r\n\r\n::: nota\nCiao.\n:::\r\n\r\nDopo.');
  });
  it('conserva ID diversi nascosti durante scrittura, nuovi inserimenti e apertura dei campi della lettera', async () => {
    const {fixture,button,option,choose,add}=setup('::: dialogo Ada | | ada-2\nCiao.\n:::');
    fixture.componentRef.setInput('characters',[{id:'ada-1',name:'Ada',portrait:'/assets/a.webp'},{id:'ada-2',name:'Ada',portrait:'/assets/b.webp'}]);
    let saved='';fixture.componentInstance.sourceChange.subscribe(value=>{saved=value;fixture.componentRef.setInput('source',value);});
    fixture.detectChanges();await fixture.whenStable();
    const area=fixture.nativeElement.querySelector('.source-pane textarea') as HTMLTextAreaElement;
    expect(area.value).toBe('::: dialogo Ada\nCiao.\n:::');
    area.value=area.value.replace('Ciao.','Una nuova battuta.');area.dispatchEvent(new Event('input'));fixture.detectChanges();await fixture.whenStable();
    expect(parseNarrative(saved).sections[0].characterId).toBe('ada-2');
    area.setSelectionRange(area.value.length,area.value.length);add('Pensiero');fixture.detectChanges();
    await vi.waitFor(()=>{fixture.detectChanges();expect(area.value).toContain('::: pensiero Ada');});
    expect(area.value).not.toContain('ada-');expect(area.value).not.toContain('|');
    expect(parseNarrative(saved).sections.map(s=>s.characterId)).toEqual(['ada-2','ada-1']);
    await fixture.whenStable();area.setSelectionRange(area.value.length,area.value.length);add('Lettera');fixture.detectChanges();await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.inline-editor')).toBeNull();
    expect(area.value).toContain('::: lettera');expect(area.value).toContain('Scrivi qui la lettera.');
    expect(parseNarrative(saved).sections.map(s=>s.characterId)).toEqual(['ada-2','ada-1','']);
  });
  it('offre gli stessi strumenti per il testo iniziale e per il seguito del master',()=>{
    const {fixture,select}=setup('');fixture.componentRef.setInput('allowImages',true);fixture.componentRef.setInput('document',true);fixture.detectChanges();
    const labels=()=>(select('Tipo di blocco').componentInstance as AppSelect).options.map(option=>option.label);
    const documentTools=labels();fixture.componentRef.setInput('document',false);fixture.componentRef.setInput('masterTools',true);fixture.detectChanges();
    expect(labels()).toEqual(documentTools);expect(labels()).toContain('Scheda PNG');
  });
  it('inserisce la scheda di un PNG con la foto intera e usa il ritratto per il dialogo', async()=>{
    const {fixture,button,option,choose,add}=setup('');fixture.componentRef.setInput('masterTools',true);
    fixture.componentRef.setInput('characters',[{name:'Shivay',kind:'png',portrait:'/assets/ritaglio.webp',photo:'/assets/intera.webp',description:'Una compagna'}]);fixture.detectChanges();await fixture.whenStable();
    let updated='';fixture.componentInstance.sourceChange.subscribe(value=>updated=value);
    add('Scheda PNG');expect(updated).toContain('image: /assets/intera.webp');expect(updated).not.toContain('/assets/ritaglio.webp');expect(parseNarrative(updated).errors).toEqual([]);
    add('Dialogo');expect(updated).toContain('| /assets/ritaglio.webp');
  });

});
