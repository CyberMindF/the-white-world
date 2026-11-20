import {describe,it,expect} from 'vitest';
import {readCharacterDraft,writeCharacterDraft} from './gdr-character-draft';
import {parseNarrative} from './gdr-turn.parser';

describe('modifica del testo separata dal collegamento al personaggio',()=>{
  it('mantiene le parole multilinea e usa il riferimento anche dopo una rinomina',()=>{
    const draft=readCharacterDraft('::: dialogo Vecchio | /assets/old.webp | character-1\nCiao.\nSeconda riga.\n:::')!;
    expect(draft.body).toBe('Ciao.\nSeconda riga.');
    const source=writeCharacterDraft(draft,[{id:'character-1',name:'Nuovo nome',portrait:'/assets/new.webp'}]);
    expect(source).not.toContain('/assets/');
    expect(parseNarrative(source).sections[0]).toMatchObject({characterId:'character-1',speaker:'Nuovo nome',text:draft.body});
  });
  it('conserva una descrizione di scena con righe vuote senza copiarne la foto',()=>{
    const draft=readCharacterDraft('::: npc full\n- characterId: npc-1\n  name: Ada\n:::')!;
    draft.body='Prima riga.\n\nSeconda riga.';
    const source=writeCharacterDraft(draft,[{id:'npc-1',name:'Ada',portrait:'',photo:'/assets/ada.webp'}]);
    expect(source).not.toContain('/assets/');expect(readCharacterDraft(source)?.body).toBe(draft.body);
    expect(parseNarrative(source).errors).toEqual([]);
  });
  it('non interpreta documenti misti come una sola battuta',()=>{
    expect(readCharacterDraft('Prima.\n\n::: dialogo Ada\nCiao.\n:::')).toBeNull();
  });
});
