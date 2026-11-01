import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { GdrWorkspaceService, WorkspaceCharacter } from '../../core/gdr-workspace.service';
import { GdrBlockRow } from '../gdr-blocks/gdr-block.types';
import { emptyProfile } from './character-profile';
import { splitCharacterPowers } from './character-powers';
import { GdrPowers } from './gdr-powers';

const block = (id: string, type: GdrBlockRow['type'], data: GdrBlockRow['data']): GdrBlockRow =>
  ({ id, type, data, documentKey: 'maga-regole', position: Number(id) });
const source = [
  block('1', 'heading', { level: 3, text: 'Tiri e stress' }),
  block('2', 'paragraph', { text: 'Tre slot per scena' }),
  block('3', 'heading', { level: 3, text: 'Abilità speciali' }),
  block('4', 'list', { items: ['Lettura dell’eco: percepisci un ricordo', 'Magia selvaggia: tira il D20'] }),
  block('5', 'table', { header: ['Dado', 'Effetto'], rows: [['1', 'Esplosione']] }),
  block('6', 'heading', { level: 3, text: 'Incantesimi' }),
  block('7', 'list', { items: ['Dardo magico: attacco silenzioso'] }),
  block('8', 'heading', { level: 3, text: 'Combattimento' }),
  block('9', 'paragraph', { text: 'Una regola generale successiva' }),
];
const character = (id: string, legacyProtagonist: boolean): WorkspaceCharacter => ({
  id, legacyProtagonist, name: id, kind: 'pg', adventureId: 'story', portrait: '', photo: '',
  sheet: '', profile: { ...emptyProfile(), abilities: 'Un potere personale di ' + id }, inventory: [],
  archived: false, revision: 1, canSpeak: true, canEditSheet: false, canInventory: false,
});

describe('consultazione delle abilità del personaggio', () => {
  afterEach(() => TestBed.resetTestingModule());
  it('separa i poteri dalle regole generali conservando i blocchi originali e le sezioni successive', () => {
    const { rules, powers } = splitCharacterPowers(source);
    expect(rules.map(b => b.id)).toEqual(['1', '2', '8', '9']);
    expect(powers.map(b => b.id)).toEqual(['3', '4', '5', '6', '7']);
    expect(powers[1]).toBe(source[3]);
    expect(splitCharacterPowers(source.slice(0, 2))).toEqual({ rules: source.slice(0, 2), powers: [] });
  });
  it('mostra i poteri del PG collegato e non li attribuisce agli altri personaggi', () => {
    TestBed.configureTestingModule({ imports: [GdrPowers], providers: [GdrWorkspaceService] });
    const workspace = TestBed.inject(GdrWorkspaceService);
    workspace.available.set(true);
    workspace.characters.set([character('Desy', true), character('Altro PG', false)]);
    const fixture = TestBed.createComponent(GdrPowers);
    fixture.componentRef.setInput('legacyBlocks', splitCharacterPowers(source).powers);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Dardo magico');
    expect(fixture.nativeElement.textContent).toContain('Un potere personale di Desy');
    expect(fixture.nativeElement.querySelector('details').open).toBe(false);
    workspace.activeId.set('Altro PG'); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Dardo magico');
    expect(fixture.nativeElement.textContent).toContain('Un potere personale di Altro PG');
    workspace.characters.update(cs => cs.map(c => c.id === 'Altro PG' ? { ...c, profile: { ...c.profile, abilities: 'Potere aggiornato dal master' } } : c));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Potere aggiornato dal master');
  });
});
