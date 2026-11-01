import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { afterEach, describe, expect, it } from 'vitest';
import { GdrSourceEditor } from './gdr-source-editor';
import { GdrTurn } from '../gdr-turn/gdr-turn';

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
});
