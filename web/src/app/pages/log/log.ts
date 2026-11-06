import { RouterLink } from '@angular/router';
import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AppShell } from '../../shell/app-shell';
import { ApiService } from '../../core/api.service';

interface LogEvent {
  id: number;
  userId: number;
  nickname: string;
  identity: 'lui' | 'lei';
  section: string;
  eventType: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface EventsResponse {
  events?: LogEvent[];
  page?: number;
  pageSize?: number;
  total?: number;
}

const PAGE_SIZE = 25;
const LOG_DATE_FORMATTER = new Intl.DateTimeFormat('it-IT', {
  timeZone: 'Europe/Rome',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

// SQLite CURRENT_TIMESTAMP restituisce UTC come "YYYY-MM-DD HH:mm:ss", senza indicare il
// fuso. Aggiungiamo esplicitamente Z prima del parsing, poi mostriamo l'ora italiana.
export function formatLogDate(value: string): string {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? value : LOG_DATE_FORMATTER.format(date);
}

// Pagina amministrativa dei log (documentazione/cms/planning-editor-contenuti.md, Fase 6). Protetta da
// authGuard + adminGuard sulla rotta; l'endpoint /api/events verifica comunque events.view a
// ogni chiamata, questa pagina non ha nessun dato precaricato nel bundle.
@Component({
  selector: 'app-log',
  standalone: true,
  imports: [AppShell, CommonModule, FormsModule, RouterLink],
  styleUrls: ['../../../styles/pages/log.css'],
  templateUrl: './log.html'
})
export class Log {
  private readonly api = inject(ApiService);

  protected readonly events = signal<LogEvent[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly loading = signal(false);
  protected readonly error = signal('');

  protected readonly identity = signal<'' | 'lui' | 'lei'>('');
  protected readonly section = signal('');
  protected readonly eventType = signal('');
  protected readonly from = signal('');
  protected readonly to = signal('');

  protected readonly pageCount = computed(() => Math.max(1, Math.ceil(this.total() / PAGE_SIZE)));
  protected readonly formatDate = formatLogDate;

  constructor() {
    void this.load();
  }

  protected applyFilters(): void {
    this.page.set(1);
    void this.load();
  }

  protected resetFilters(): void {
    this.identity.set('');
    this.section.set('');
    this.eventType.set('');
    this.from.set('');
    this.to.set('');
    this.applyFilters();
  }

  protected goToPage(page: number): void {
    if (page < 1 || page > this.pageCount()) {
      return;
    }
    this.page.set(page);
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const params = new URLSearchParams();
      if (this.identity()) params.set('identity', this.identity());
      if (this.section().trim()) params.set('section', this.section().trim());
      if (this.eventType().trim()) params.set('eventType', this.eventType().trim());
      if (this.from()) params.set('from', this.from());
      if (this.to()) params.set('to', this.to());
      params.set('page', String(this.page()));
      params.set('pageSize', String(PAGE_SIZE));

      const response = await fetch(`/api/events?${params.toString()}`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });

      if (!response.ok) {
        this.error.set(response.status === 403 ? 'Non sei autorizzata a vedere questa pagina.' : 'Errore nel caricamento dei log.');
        this.events.set([]);
        this.total.set(0);
        return;
      }

      const result = await this.api.readApiResponse<EventsResponse>(response);
      this.events.set(result.events ?? []);
      this.total.set(result.total ?? 0);
    } catch (error) {
      console.error('Errore nel caricamento dei log:', error);
      this.error.set('Errore nel caricamento dei log.');
    } finally {
      this.loading.set(false);
    }
  }
}
