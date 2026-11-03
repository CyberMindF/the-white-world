import { Injectable, inject } from '@angular/core';
import { ApiService } from './api.service';

// Porting fedele di assets/js/shared/telemetry.js.
@Injectable({ providedIn: 'root' })
export class TelemetryService {
  private readonly api = inject(ApiService);

  // Invia un evento di telemetria senza mai interrompere l'esperienza in caso di errore.
  trackEvent(section: string, eventType: string, metadata: Record<string, unknown> = {}): Promise<boolean> {
    return this.api.sendAuthenticatedJson('/api/telemetry/events', { section, eventType, metadata });
  }

  // Deriva la sezione dal primo segmento del percorso, così ogni pagina nuova viene già
  // tracciata senza dover toccare di nuovo questo file.
  sectionFromPath(pathname: string = window.location.pathname): string {
    const segment = pathname.split('/').find(Boolean);
    return segment ? segment.toLowerCase() : 'root';
  }
}
