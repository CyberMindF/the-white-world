import { afterEach, describe, expect, it, vi } from 'vitest';

describe('raccolta diagnostica browser', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); localStorage.clear(); });
  it('invia subito, deduplica e non intercetta le proprie richieste', async () => {
    vi.resetModules();
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 202 }));
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(window, 'addEventListener').mockImplementation(() => {});
    vi.spyOn(document, 'addEventListener').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { initDiagnostics, reportDiagnostic, diagnosticAction } = await import('./diagnostics');
    initDiagnostics();
    diagnosticAction('gdr_editor_mode', { mode: 'preview', characters: 42 });
    reportDiagnostic('javascript_error', new Error('Failure at https://test.test/api?token=secret'));
    reportDiagnostic('javascript_error', new Error('Failure at https://test.test/api?token=secret'));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const payload = JSON.parse(fetch.mock.calls[0][1].body);
    expect(payload.message).not.toContain('secret'); expect(payload.stack).toContain('Error');
    expect(payload.context.breadcrumbs.at(-1).action).toBe('gdr_editor_mode');
    await vi.waitFor(() => expect(JSON.parse(localStorage.getItem('mondo-diagnostic-pending-v1') || '[]')).toEqual([]));
  });
  it('conserva gli errori falliti e li ritenta alla riapertura con lo stesso ID', async () => {
    vi.resetModules();
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const fetch = vi.fn().mockRejectedValue(new TypeError('offline'));
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(window, 'addEventListener').mockImplementation(() => {});
    vi.spyOn(document, 'addEventListener').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let diagnostics = await import('./diagnostics'); diagnostics.initDiagnostics();
    diagnostics.reportDiagnostic('test_error', new Error('pending'));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const before = JSON.parse(localStorage.getItem('mondo-diagnostic-pending-v1')!);
    expect(before).toHaveLength(1);
    fetch.mockResolvedValue(new Response('{}', {status:202}));
    vi.resetModules(); diagnostics = await import('./diagnostics'); diagnostics.initDiagnostics();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetch.mock.calls[1][1].body).id).toBe(before[0].id);
  });
});
