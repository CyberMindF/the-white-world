import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CartaTilt } from './carta-tilt';

describe('aggiornamenti grafici delle carte', () => {
  afterEach(() => { TestBed.resetTestingModule(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it('accorpa il movimento del puntatore e annulla quello pendente uscendo dalla carta', () => {
    const frames = new Map<number, FrameRequestCallback>(); let id = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
    vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key));
    TestBed.configureTestingModule({ imports: [CartaTilt] });
    const fixture = TestBed.createComponent(CartaTilt);
    fixture.componentRef.setInput('finitura', 'flat'); fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
    const component = fixture.componentInstance as unknown as { pointerFrame: number | undefined; applyPointerMove(event: PointerEvent): void };
    const update = vi.spyOn(component, 'applyPointerMove');
    for (const x of [10, 25, 75]) host.dispatchEvent(new MouseEvent('pointermove', {clientX:x,clientY:50}));
    expect(update).not.toHaveBeenCalled();
    const key = component.pointerFrame!; const frame = frames.get(key)!; frames.delete(key); frame(16);
    expect(update).toHaveBeenCalledTimes(1);
    const visual = host.querySelector('.carta-tilt-frame') as HTMLElement;
    expect(visual.style.getPropertyValue('--mx')).toBe('75%');
    host.dispatchEvent(new MouseEvent('pointermove', {clientX:90,clientY:50}));
    const pending = component.pointerFrame!;
    host.dispatchEvent(new MouseEvent('pointerleave'));
    expect(frames.has(pending)).toBe(false); expect(visual.style.getPropertyValue('--mx')).toBe('35%');
    fixture.destroy();
  });
});
