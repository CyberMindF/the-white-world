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
  it('mostra anche un personaggio archiviato se non rimangono attivi', () => {
    const { workspace, fixture } = setup();
    workspace.characters.set([character('old', 'Vecchio', true)]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.identity').textContent).toContain('Vecchio');
  });
});
