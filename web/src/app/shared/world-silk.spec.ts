import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorldSilk } from './world-silk';
import { WorldSettingsService } from '../core/world-settings.service';

describe('ciclo grafico della seta', () => {
  afterEach(() => { TestBed.resetTestingModule(); vi.restoreAllMocks(); });
  it('non inizializza WebGL né riparte tornando alla scheda se è disattivata', () => {
    const state = signal({ silk: false });
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
    TestBed.configureTestingModule({ imports: [WorldSilk], providers: [{ provide: WorldSettingsService, useValue: { settings: state } }] });
    const fixture = TestBed.createComponent(WorldSilk); fixture.detectChanges();
    document.dispatchEvent(new Event('visibilitychange')); fixture.detectChanges();
    expect(context).not.toHaveBeenCalled();
    fixture.destroy(); vi.unstubAllGlobals();
  });
  it('ferma frame e disegni quando si disattiva, anche al successivo visibilitychange', () => {
    const state = signal({ silk: true });
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const frames = new Map<number, FrameRequestCallback>(); let sequence = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    const draw = vi.fn();
    const gl = new Proxy({ getShaderParameter: () => true, getProgramParameter: () => true, createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}), getExtension: () => null, drawArrays: draw, canvas: { width: 1, height: 1 } }, { get(target, key) { return key in target ? Reflect.get(target, key) : () => {}; } });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(gl as unknown as WebGLRenderingContext);
    TestBed.configureTestingModule({ imports: [WorldSilk], providers: [{ provide: WorldSettingsService, useValue: { settings: state } }] });
    const fixture = TestBed.createComponent(WorldSilk); fixture.detectChanges();
    expect(frames.size).toBe(1);
    const [id, callback] = frames.entries().next().value!; frames.delete(id); callback(16);
    expect(draw).toHaveBeenCalledTimes(1);
    state.set({ silk: false }); fixture.detectChanges();
    // Il callback stesso controlla lo stato, anche prima del microtask di arresto.
    for (const [key, frame] of frames) { frames.delete(key); frame(32); }
    document.dispatchEvent(new Event('visibilitychange'));
    expect(draw).toHaveBeenCalledTimes(1); expect(frames.size).toBe(0);
    fixture.destroy(); vi.unstubAllGlobals();
  });
});
