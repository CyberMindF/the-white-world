import { Component, signal } from '@angular/core';
import { JsonPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AppShell } from '../../shell/app-shell';
import { formatLogDate } from '../log/log';

interface DiagnosticRow {
  id: string; source: string; kind: string; message: string; stack: string;
  occurred_at: string; received_at: string; actor_user_id: number | null;
  effective_user_id: number | null; session_id: number | null; request_id: string;
  path: string; user_agent: string; context: Record<string, unknown>;
}
@Component({
  selector: 'app-diagnostics', standalone: true, imports: [AppShell, JsonPipe, FormsModule, RouterLink],
  styleUrls: ['../../../styles/pages/log.css'],
  template: `
    <app-shell [showSuggestLink]="false">
      <section class="log-hero"><p class="log-eyebrow">Modalità admin</p><h1>Registro degli errori</h1><a routerLink="/log">Log degli eventi</a></section>
      <form class="log-filters card glass-surface" (ngSubmit)="load(true)">
        <label class="form-field"><span>Tipo</span><input name="kind" [(ngModel)]="kind" placeholder="es. webgl_context_lost" /></label>
        <label class="form-field"><span>ID utente reale</span><input name="actor" type="number" min="1" [(ngModel)]="actor" /></label>
        <button type="submit" class="btn" [disabled]="loading()">Aggiorna</button>
      </form>
      @if (error()) { <p role="alert">{{ error() }}</p> }
      @for (row of rows(); track row.id) {
        <details class="card"><summary>{{ formatDate(row.occurred_at) }} · {{ row.source }} · {{ row.kind }} · {{ row.message }}</summary>
          <p>Pagina: {{ row.path }} · Utente reale: {{ row.actor_user_id ?? 'anonimo' }} · Utente effettivo: {{ row.effective_user_id ?? 'anonimo' }} · Sessione: {{ row.session_id }}</p>
          <p>Ricevuto: {{ formatDate(row.received_at) }} · Richiesta: {{ row.request_id || '—' }}</p>
          <p>{{ row.user_agent }}</p>
          <pre style="white-space:pre-wrap;overflow-wrap:anywhere">{{ row.stack }}</pre>
          <pre style="white-space:pre-wrap;overflow-wrap:anywhere">{{ row.context | json }}</pre>
        </details>
      } @empty { <p>{{ loading() ? 'Caricamento…' : 'Nessun errore registrato.' }}</p> }
      @if (nextBefore()) { <button type="button" class="btn" [disabled]="loading()" (click)="load(false)">Carica precedenti</button> }
    </app-shell>
  `,
})
export class Diagnostics {
  protected readonly rows = signal<DiagnosticRow[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly nextBefore = signal<string | null>(null);
  protected readonly formatDate = formatLogDate;
  protected kind = '';
  protected actor = '';
  private version = 0;
  constructor() { void this.load(true); }
  protected async load(reset: boolean): Promise<void> {
    const version = ++this.version;
    this.loading.set(true); this.error.set('');
    try {
      const params = new URLSearchParams();
      if (!reset && this.nextBefore()) params.set('before', this.nextBefore()!);
      if (this.kind.trim()) params.set('kind', this.kind.trim());
      if (this.actor) params.set('actor', String(this.actor));
      const response = await fetch('/api/diagnostics?' + params, { credentials: 'same-origin' });
      if (!response.ok) throw new Error(response.status === 403 ? 'Non sei autorizzato a leggere gli errori.' : 'Registro temporaneamente non disponibile.');
      const result = await response.json() as { errors: DiagnosticRow[]; nextBefore: string | null };
      if (version !== this.version) return;
      this.rows.set(reset ? result.errors : [...this.rows(), ...result.errors]);
      this.nextBefore.set(result.nextBefore);
    } catch (error) { if (version === this.version) this.error.set(error instanceof Error ? error.message : 'Caricamento non riuscito.'); }
    finally { if (version === this.version) this.loading.set(false); }
  }
}
