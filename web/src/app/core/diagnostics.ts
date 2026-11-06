// Collettore indipendente da Angular: disponibile anche se il bootstrap fallisce.
const ENDPOINT = '/api/diagnostics';
const STORAGE_KEY = 'mondo-diagnostic-pending-v1';
interface DiagnosticEvent {
  id: string; kind: string; message: string; stack: string; occurredAt: string;
  path: string; requestId?: string; context: Record<string, unknown>;
}
let initialized = false;
let transport: typeof fetch | undefined;
let sending = false;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let sentThisPage = 0;
let pending: DiagnosticEvent[] = [];
let identity: Record<string, unknown> = {};
let device: Record<string, unknown> = {};
let graphics: Record<string, unknown> = {};
const breadcrumbs: Array<Record<string, unknown>> = [];
const recent = new Map<string, number>();
const longTasks: Array<{ durationMs: number; startedAtMs: number }> = [];
const pageId = globalThis.crypto?.randomUUID?.() || String(Date.now());

export function diagnosticText(value: unknown, limit = 2000): string {
  return String(value ?? '').slice(0, limit)
    .replace(/https?:\/\/[^\s"'<>]+/gi, value => { try { const u = new URL(value); return u.origin + u.pathname; } catch { return '[url]'; } })
    .replace(/\b(Bearer\s+)\S+/gi, '$1[redacted]')
    .replace(/((?:password|token|authorization|cookie|worldKey)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]');
}
export function diagnosticAction(action: string, details: Record<string, number | string | boolean> = {}): void {
  // I chiamanti passano nomi di azione e dimensioni, mai testo di bozze o campi del form.
  breadcrumbs.push({ action, at: new Date().toISOString(), ...details });
  if (breadcrumbs.length > 15) breadcrumbs.shift();
}
export function setDiagnosticIdentity(value: Record<string, unknown>): void { identity = value; }
export function setDiagnosticGraphics(value: Record<string, unknown>): void { graphics = { ...graphics, ...value }; }

function persist(): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(pending)); } catch { /* Restano in memoria. */ }
}
function snapshot(): Record<string, unknown> {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { effectiveType?: string; saveData?: boolean } };
  return {
    version: document.querySelector<HTMLMetaElement>('meta[name="app-version"]')?.content || 'unknown',
    pageId, uptimeMs: Math.round(performance.now()), visibility: document.visibilityState,
    online: navigator.onLine, language: navigator.language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    userAgent: navigator.userAgent, platform: navigator.platform, ...device,
    deviceMemory: nav.deviceMemory, hardwareConcurrency: nav.hardwareConcurrency, maxTouchPoints: nav.maxTouchPoints,
    screen: { width: screen.width, height: screen.height, colorDepth: screen.colorDepth },
    viewport: { width: innerWidth, height: innerHeight, scale: window.visualViewport?.scale }, dpr: devicePixelRatio,
    connection: { effectiveType: nav.connection?.effectiveType, saveData: nav.connection?.saveData },
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    theme: document.body?.dataset['theme'], effects: ['silk','stars','shooting-stars','lanterns','moon','sparkles','leaves','waves','fish','petals','bubbles','hearts','pearl-shimmers','stickers','balloons','fireworks'].filter(name => { const el = document.querySelector('.world-' + name); return !!el && getComputedStyle(el).display !== 'none'; }),
    graphics: { ...graphics, longTasks: [...longTasks] }, observedIdentity: { ...identity }, breadcrumbs: breadcrumbs.map(item => ({ ...item })),
  };
}
export function reportDiagnostic(kind: string, error: unknown, details: Record<string, unknown> = {}): void {
  if (!initialized || sentThisPage >= 60) return;
  try {
    const message = diagnosticText(error instanceof Error ? error.message : typeof error === 'string' ? error : 'Errore senza messaggio testuale');
    const fingerprint = kind + ':' + message;
    if (Date.now() - (recent.get(fingerprint) || 0) < 10000) return;
    recent.set(fingerprint, Date.now());
    if (recent.size > 60) recent.delete(recent.keys().next().value!);
    sentThisPage++;
    pending.push({ id: crypto.randomUUID(), kind, message, stack: diagnosticText(error instanceof Error ? error.stack : '', 6000), occurredAt: new Date().toISOString(), path: location.pathname, requestId: typeof details['requestId'] === 'string' ? details['requestId'] : undefined, context: { ...snapshot(), ...details } });
    pending = pending.slice(-10);
    persist();
    void flush();
  } catch { /* La diagnostica non deve generare altri errori. */ }
}
async function flush(): Promise<void> {
  if (sending || !transport || !pending.length || !navigator.onLine) return;
  sending = true;
  try {
    while (pending.length) {
      const event = pending[0];
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      let response: Response;
      try {
        response = await transport(ENDPOINT, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event), keepalive: true, signal: controller.signal });
      } finally { clearTimeout(timeout); }
      if (!response.ok && response.status !== 400 && response.status !== 413) break;
      pending = pending.filter(item => item.id !== event.id); persist();
    }
  } catch { /* Ritenta senza passare dal fetch monitorato. */ }
  finally {
    sending = false;
    if (pending.length && !retryTimer) retryTimer = setTimeout(() => { retryTimer = undefined; void flush(); }, 30000);
  }
}

export function initDiagnostics(): void {
  if (initialized) return;
  initialized = true;
  transport = window.fetch.bind(window);
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (Array.isArray(stored)) pending = stored.filter((e): e is DiagnosticEvent => !!e && typeof e.id === 'string' && typeof e.message === 'string' && typeof e.kind === 'string' && typeof e.occurredAt === 'string' && typeof e.context === 'object' && Date.now() - Date.parse(e.occurredAt) < 7 * 86400000).slice(-10);
  } catch { /* Storage non disponibile o corrotto. */ }
  const ua = navigator as Navigator & { userAgentData?: { getHighEntropyValues(hints: string[]): Promise<Record<string, unknown>> } };
  try { void ua.userAgentData?.getHighEntropyValues(['model','platformVersion','fullVersionList']).then(value => { device = value; }).catch(() => {}); } catch { /* Informazioni opzionali. */ }
  window.addEventListener('error', (event: Event) => {
    if (event instanceof ErrorEvent) reportDiagnostic('javascript_error', event.error || event.message, { resource: diagnosticText(event.filename), line: event.lineno, column: event.colno });
    else {
      const target = event.target;
      if (target instanceof HTMLScriptElement || target instanceof HTMLLinkElement || target instanceof HTMLImageElement) reportDiagnostic('resource_error', 'Risorsa non caricata', { resource: diagnosticText(target instanceof HTMLLinkElement ? target.href : target.src) });
    }
  }, true);
  window.addEventListener('unhandledrejection', event => reportDiagnostic('unhandled_rejection', event.reason));
  if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
    try {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          longTasks.push({ durationMs: Math.round(entry.duration), startedAtMs: Math.round(entry.startTime) });
          if (longTasks.length > 5) longTasks.shift();
        }
      }).observe({ type: 'longtask', buffered: true });
    } catch { /* Non tutti i browser espongono i long task. */ }
  }
  const originalWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    originalWarn(...args);
    const error = args.find(arg => arg instanceof Error);
    if (error) reportDiagnostic('handled_error', error);
  };
  const originalError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    originalError(...args);
    const error = args.find(arg => arg instanceof Error);
    reportDiagnostic('console_error', error || args.filter(arg => typeof arg === 'string').join(' '));
  };
  window.fetch = async (input, init) => {
    let url: URL | undefined;
    try { url = new URL(input instanceof Request ? input.url : String(input), location.href); } catch { /* fetch gestisce gli URL non validi. */ }
    const monitored = url?.origin === location.origin && url.pathname.startsWith('/api/') && !url.pathname.startsWith(ENDPOINT);
    const started = performance.now();
    const method = init?.method || (input instanceof Request ? input.method : 'GET');
    try {
      const response = await transport!(input, init);
      if (monitored && !response.ok) reportDiagnostic('http_error', `HTTP ${response.status} ${method} ${url!.pathname}`, { requestPath: url!.pathname, method, status: response.status, requestId: response.headers.get('X-Request-Id') || '', durationMs: Math.round(performance.now() - started) });
      return response;
    } catch (error) {
      if (monitored && !(error instanceof DOMException && error.name === 'AbortError')) reportDiagnostic('network_error', error, { requestPath: url!.pathname, method, durationMs: Math.round(performance.now() - started) });
      throw error;
    }
  };
  window.addEventListener('online', () => void flush());
  document.addEventListener('visibilitychange', () => {
    diagnosticAction('visibility', { state: document.visibilityState });
    if (!document.hidden) void flush();
  });
  document.addEventListener('webglcontextlost', () => reportDiagnostic('webgl_context_lost', 'Contesto grafico WebGL perso'), true);
  diagnosticAction('page_started');
  void flush();
}
