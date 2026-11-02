import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GdrImageLibrary, imagesFromGdrBlocks } from './gdr-image-library';

describe('scelta visiva delle immagini GDR', () => {
  afterEach(() => TestBed.resetTestingModule());
  it('mostra solo immagini del sito, senza doppioni, e sceglie foto o ritratto senza chiedere percorsi', () => {
    TestBed.configureTestingModule({ imports: [GdrImageLibrary] });
    const fixture = TestBed.createComponent(GdrImageLibrary);
    const selection = vi.fn(); fixture.componentInstance.selected.subscribe(selection);
    fixture.componentRef.setInput('images', [
      { src: '/assets/lefira.webp', label: 'Lefira' },
      { src: '/assets/lefira.webp', label: 'Duplicato' },
      { src: '/api/media/gdr-workspace/pg/photo/a.webp', label: 'Foto caricata' },
      { src: 'https://outside.example/pic.jpg', label: 'Esterna' },
      { src: '', label: 'Vuota' },
    ]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.image-choice').length).toBe(2);
    expect(fixture.nativeElement.querySelector('input')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('/assets/');
    const photo = fixture.nativeElement.querySelector('.image-choice') as HTMLButtonElement;
    photo.click(); expect(selection).toHaveBeenLastCalledWith({src:'/assets/lefira.webp',slot:'photo'});
    const target = Array.from(fixture.nativeElement.querySelectorAll('.library-tools button') as NodeListOf<HTMLButtonElement>)[1];
    target.click(); fixture.detectChanges(); photo.click();
    expect(selection).toHaveBeenLastCalledWith({src:'/assets/lefira.webp',slot:'avatar'});
  });
  it('trova le foto dell’avventura e i ritratti dei PNG usando i loro nomi', () => {
    expect(imagesFromGdrBlocks([
      {id:'1',documentKey:'avventura',position:0,type:'image',data:{src:'/assets/castello.jpg',alt:'Il castello',caption:null}},
      {id:'2',documentKey:'avventura',position:1,type:'npc_grid',data:{entries:[{image:'/assets/lefira.webp',alt:'',name:'Lefira',description:''}]}},
    ])).toEqual([{src:'/assets/castello.jpg',label:'Il castello'},{src:'/assets/lefira.webp',label:'Lefira'}]);
  });
});
