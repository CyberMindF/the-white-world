import { describe, expect, it } from 'vitest';
import { emptyProfile, parseCharacterBundle } from './character-profile';
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
