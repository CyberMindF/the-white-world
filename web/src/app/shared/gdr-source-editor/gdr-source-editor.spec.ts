import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { afterEach, describe, expect, it } from 'vitest';
import { GdrSourceEditor } from './gdr-source-editor';
import { GdrTurn } from '../gdr-turn/gdr-turn';
import { parseNarrative } from '../gdr-turn/gdr-turn.parser';

describe('anteprima prima della pubblicazione', () => {
  afterEach(() => TestBed.resetTestingModule());
  function setup(source: string) {
    TestBed.configureTestingModule({imports:[GdrSourceEditor]});
    const fixture=TestBed.createComponent(GdrSourceEditor);
    fixture.componentRef.setInput('source',source);
    fixture.detectChanges();
    const button=(label:string) => Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(b=>b.textContent?.trim()===label)!;
    return {fixture,button};
  }
  it('richiede del testo e mostra l’anteprima senza emettere un invio', () => {
    const {fixture,button}=setup('   ');
    expect(button('Solo anteprima').disabled).toBe(true);
    fixture.componentRef.setInput('source','Mi avvicino alla porta.'); fixture.detectChanges();
    expect(button('Solo anteprima').disabled).toBe(false);
    fixture.componentInstance.openPreview(); fixture.detectChanges();
    expect(fixture.debugElement.query(By.directive(GdrTurn)).componentInstance.editable()).toBe(true);
    button('Torna al testo').click(); fixture.detectChanges();
    expect(fixture.debugElement.query(By.directive(GdrTurn))).toBeNull();
  });
  it('lascia l’anteprima affiancata in sola lettura e torna al testo dopo aver svuotato la bozza', () => {
    const {fixture,button}=setup('La storia continua.');
    button('Testo e anteprima').click(); fixture.detectChanges();
    expect(fixture.debugElement.query(By.directive(GdrTurn)).componentInstance.editable()).toBe(false);
    fixture.componentInstance.openPreview(); fixture.detectChanges();
    fixture.componentRef.setInput('source',''); fixture.detectChanges();
    expect(fixture.debugElement.query(By.directive(GdrTurn))).toBeNull();
    expect(button('Solo anteprima').disabled).toBe(true);
  });
  it('mostra strumenti brevi senza immagini o comandi di sintassi nella vista giocatrice', () => {
    const {fixture,button}=setup('Ciao');
    expect(button('Dialogo')).toBeTruthy();
    expect(button('Azione')).toBeTruthy();
    expect(button('Nota')).toBeTruthy();
    expect(button('Immagine')).toBeUndefined();
    expect(button('Cambia voce nel dialogo')).toBeUndefined();
    expect(fixture.nativeElement.querySelector('pre, code')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Personaggio');
    fixture.componentRef.setInput('allowImages',true); fixture.detectChanges();
    expect(button('Immagine')).toBeTruthy();
  });
  it('trasforma la frase selezionata in un dialogo del personaggio scelto', async () => {
    const {fixture,button}=setup('Ciao');
    fixture.componentRef.setInput('characters',[{name:'Ada',portrait:''}]); fixture.detectChanges();
    await fixture.whenStable();
    let updated='';
    fixture.componentInstance.sourceChange.subscribe(value=>updated=value);
    const area=fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    area.setSelectionRange(0,4);
    button('Dialogo').click(); fixture.detectChanges();
    expect(updated).toContain('::: dialogo Ada\nCiao\n:::');
  });
  it('offre l’impaginazione solo al master e converte la selezione in titoli o riquadri validi', async () => {
    const {fixture,button}=setup('Un incontro');
    expect(button('Titolo')).toBeUndefined();expect(button('Tabella')).toBeUndefined();
    fixture.componentRef.setInput('masterTools',true);fixture.detectChanges();
    await fixture.whenStable();
    for(const label of ['Titolo','Sottotitolo','Riquadro','Elenco','Tabella','Corsivo']) expect(button(label)).toBeTruthy();
    const area=fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    area.setSelectionRange(0,11);let result='';fixture.componentInstance.sourceChange.subscribe(value=>result=value);
    button('Sottotitolo').click();expect(result.trim()).toBe('### Un incontro');expect(parseNarrative(result).errors).toEqual([]);
    button('Riquadro').click();expect(result).toContain('::: callout\nUn incontro\n:::');expect(parseNarrative(result).errors).toEqual([]);
    fixture.componentRef.setInput('masterTools',false);fixture.detectChanges();expect(button('Titolo')).toBeUndefined();
  });
  it('inserisce un’immagine scelta dalle miniature senza richiedere un percorso', () => {
    const {fixture,button}=setup('');
    fixture.componentRef.setInput('allowImages',true);
    fixture.componentRef.setInput('images',[{src:'/assets/castello.webp',label:'Il castello'}]);fixture.detectChanges();
    let result='';fixture.componentInstance.sourceChange.subscribe(value=>result=value);
    button('Immagine').click();fixture.detectChanges();
    expect(result).toBe('');expect(fixture.nativeElement.querySelector('.library-tools')).toBeNull();
    (fixture.nativeElement.querySelector('button[aria-label="Inserisci Il castello"]') as HTMLButtonElement).click();fixture.detectChanges();
    expect(result.trim()).toBe('![Il castello](/assets/castello.webp)');expect(parseNarrative(result).errors).toEqual([]);
    expect(fixture.nativeElement.querySelector('.image-picker')).toBeNull();
  });

});
