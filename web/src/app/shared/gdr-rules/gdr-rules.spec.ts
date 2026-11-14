import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GdrWorkspaceService } from '../../core/gdr-workspace.service';
import { GdrRules } from './gdr-rules';

function setup(editable = true) {
  TestBed.configureTestingModule({ imports: [GdrRules], providers: [GdrWorkspaceService] });
  const fixture = TestBed.createComponent(GdrRules),
    workspace = TestBed.inject(GdrWorkspaceService);
  fixture.componentRef.setInput('adventureId', 'story');
  fixture.componentRef.setInput('editable', editable);
  fixture.componentRef.setInput('revision', 3);
  fixture.componentRef.setInput('blocks', [
    { type: 'paragraph', data: { text: 'Regola originale' } },
  ]);
  fixture.detectChanges();
  const button = (text: string) =>
    ([...fixture.nativeElement.querySelectorAll('button')] as HTMLButtonElement[]).find(
      (b) => b.textContent?.trim() === text,
    )!;
  return { fixture, workspace, button };
}
describe('regole dell’avventura', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
  });
  it('la consultazione mostra le regole senza offrire modifiche alla giocatrice', () => {
    const { fixture, button } = setup(false);
    expect(fixture.nativeElement.textContent).toContain('Regola originale');
    expect(button('Modifica regole')).toBeUndefined();
  });
  it('salva il documento dell’avventura con la revisione letta e mantiene il resto della scheda indipendente', async () => {
    const { fixture, workspace, button } = setup();
    const saved = vi.fn();
    fixture.componentInstance.saved.subscribe(saved);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json({
          saved: true,
          blocks: [{ type: 'paragraph', data: { text: 'Regola modificata' } }],
          revision: 4,
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    button('Modifica regole').click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(workspace.pendingChanges()).toBe(true);
    const input = fixture.nativeElement.querySelector('textarea');
    input.value = 'Regola modificata';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    button('Salva regole').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/gdr-rules');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      adventureId: 'story',
      revision: 3,
      blocks: [{ type: 'paragraph', data: { text: 'Regola modificata' } }],
    });
    expect(saved).toHaveBeenCalledWith({
      blocks: [{ type: 'paragraph', data: { text: 'Regola modificata' } }],
      revision: 4,
    });
    expect(workspace.pendingChanges()).toBe(false);
  });
  it('un conflitto conserva il testo in modifica; Annulla ripristina la consultazione', async () => {
    const { fixture, workspace, button } = setup();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(Response.json({ error: 'Le regole sono cambiate.' }, { status: 409 })),
    );
    button('Modifica regole').click();
    fixture.detectChanges();
    await fixture.whenStable();
    const input = fixture.nativeElement.querySelector('textarea');
    input.value = 'Bozza da conservare';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    button('Salva regole').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('textarea').value).toBe('Bozza da conservare');
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain(
      'Le regole sono cambiate',
    );
    expect(workspace.pendingChanges()).toBe(true);
    button('Annulla').click();
    fixture.detectChanges();
    expect(workspace.pendingChanges()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Regola originale');
  });
});
