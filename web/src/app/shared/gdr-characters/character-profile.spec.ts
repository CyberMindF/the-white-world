import { describe, expect, it } from 'vitest';
import { emptyProfile, parseCharacterBundle, portraitCropRect } from './character-profile';
const file = () => ({
  format: 'mondobianco.character',
  version: 1,
  kind: 'png',
  name: 'Ada',
  profile: { ...emptyProfile(), surname: 'Neri', history: 'Una storia' },
  sheet: 'Dettagli',
  inventory: [{ id: 'old', name: 'Chiave', quantity: 2, notes: 'Ferro' }],
  images: { photo: '', avatar: '' },
});
describe('file personaggio portabile', () => {
  it('conserva il flag pet senza importare il collegamento a un PG di un’altra copia',()=>{
    const result=parseCharacterBundle(JSON.stringify({...file(),isPet:true,petOwnerId:'pg-originale'}));
    expect(result.isPet).toBe(true);expect(result).not.toHaveProperty('petOwnerId');
    expect(()=>parseCharacterBundle(JSON.stringify({...file(),kind:'pg',isPet:true}))).toThrow();
  });
  it('conserva statistiche e compagno nel file del personaggio',()=>{const result=parseCharacterBundle(JSON.stringify({...file(),characterFields:{catName:'Luna',statMente:'4'}}));expect(result.characterFields).toEqual({catName:'Luna',statMente:'4'});});

  it('mantiene profilo e inventario e genera nuovi identificativi per gli oggetti', () => {
    const result = parseCharacterBundle(
      JSON.stringify({
        ...file(),
        grants: [{ userId: 99, canEditSheet: true }],
        id: 'record-esistente',
      }),
    );
    expect(result.profile.surname).toBe('Neri');
    expect(result.inventory[0].quantity).toBe(2);
    expect(result.inventory[0].id).not.toBe('old');
    expect(result).not.toHaveProperty('grants');
    expect(result).not.toHaveProperty('id');
  });
  it('rifiuta formati sconosciuti, immagini esterne e quantità non valide', () => {
    expect(() => parseCharacterBundle('{')).toThrow();
    expect(() => parseCharacterBundle(JSON.stringify({ ...file(), version: 99 }))).toThrow();
    expect(() =>
      parseCharacterBundle(
        JSON.stringify({ ...file(), images: { photo: 'https://example.com/p.png', avatar: '' } }),
      ),
    ).toThrow();
    expect(() =>
      parseCharacterBundle(
        JSON.stringify({ ...file(), inventory: [{ name: 'Chiave', quantity: -1 }] }),
      ),
    ).toThrow();
  });
});

describe('inquadratura del ritratto',()=>{
 it('centra un’immagine orizzontale e mantiene il ritaglio quadrato entro la foto',()=>{
  expect(portraitCropRect(1200,800,1,.5,.5)).toEqual({x:200,y:0,size:800});
  expect(portraitCropRect(800,1200,1,.5,.5)).toEqual({x:0,y:200,size:800});
 });
 it('permette zoom e spostamento fino ai bordi senza introdurre zone vuote',()=>{
  expect(portraitCropRect(1200,800,2,.5,.5)).toEqual({x:400,y:200,size:400});
  const crop=portraitCropRect(1200,800,2,2,-1);expect(crop).toEqual({x:800,y:0,size:400});
  expect(crop.x+crop.size).toBeLessThanOrEqual(1200);expect(crop.y+crop.size).toBeLessThanOrEqual(800);
 });
});
