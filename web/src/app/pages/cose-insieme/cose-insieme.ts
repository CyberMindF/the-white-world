import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AppShell } from '../../shell/app-shell';
import { AppSelect, AppSelectOption } from '../../shared/app-select/app-select';
import { EditorialText } from '../../shared/editorial-text/editorial-text';
import { ConfirmationDialog } from '../../shared/confirmation-dialog/confirmation-dialog';
import { AuthService } from '../../core/auth.service';
import { ApiService } from '../../core/api.service';
import { TelemetryService } from '../../core/telemetry.service';

type ActivityStatus = 'todo' | 'done' | 'repeat' | 'unavailable';
type ActivityFilter = 'all' | ActivityStatus;

interface TogetherActivity {
  id: number;
  number: number;
  text: string | null;
  category: string;
  link: string | null;
  approximateDate: string | null;
  hasPrivatePart: boolean;
  privateOnly: boolean;
  status: ActivityStatus;
}

// Vista completa, con privateText: arriva solo da GET /api/together/activities (content.edit),
// mai dalla lista pubblica — usata solo per precompilare il form di modifica in modalità admin.
interface FullActivity {
  id: number;
  text: string | null;
  category: string;
  privateText: string | null;
  link: string | null;
  approximateDate: string;
}

interface ActivityDraft {
  text: string;
  category: string;
  privateText: string;
  link: string;
  approximateDate: string;
}

function emptyDraft(): ActivityDraft {
  return { text: '', category: '', privateText: '', link: '', approximateDate: '' };
}

function toDraft(activity: FullActivity): ActivityDraft {
  return {
    text: activity.text ?? '',
    category: activity.category,
    privateText: activity.privateText ?? '',
    link: activity.link ?? '',
    approximateDate: activity.approximateDate
  };
}

interface PrivatePart {
  id: number;
  text: string;
}

const STATUS_LABEL: Record<ActivityStatus, string> = {
  todo: 'Da fare',
  done: 'Fatto',
  repeat: 'Da rifare',
  unavailable: 'Non più possibile'
};

const CATEGORY_LABEL: Record<string, string> = {
  giochi: 'Giochi',
  ricordi: 'Foto e ricordi',
  uscite: 'Posti e uscite',
  cibo: 'Cose buone',
  gesti: 'Piccoli gesti',
  'da-vedere': 'Da vedere',
  momenti: 'Momenti insieme',
  trend: 'Idee viste online',
  intimita: 'Intimità'
};

@Component({
  selector: 'app-cose-insieme',
  standalone: true,
  imports: [AppShell, AppSelect, RouterLink, EditorialText, ConfirmationDialog, FormsModule],
  styleUrls: ['../../../styles/pages/cose-insieme.css'],
  templateUrl: './cose-insieme.html'
})
export class CoseInsieme {
  private readonly api = inject(ApiService);
  protected readonly authService = inject(AuthService);
  private readonly telemetry = inject(TelemetryService);

  protected readonly canEdit = computed(() => this.authService.isAdmin() && this.authService.adminModeEnabled());

  protected readonly activities = signal<TogetherActivity[]>([]);
  protected readonly filter = signal<ActivityFilter>('all');
  protected readonly categoryFilter = signal('all');
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly savingId = signal<number | null>(null);
  protected readonly unlockOpen = signal(false);
  protected readonly unlocking = signal(false);
  protected readonly unlockError = signal('');
  protected readonly privateParts = signal(new Map<number, string>());
  protected readonly unlocked = computed(() => this.privateParts().size > 0);
  protected readonly visibleActivities = computed(() => {
    const status = this.filter();
    const category = this.categoryFilter();
    return this.activities().filter((item) =>
      (status === 'all' || item.status === status) &&
      (category === 'all' || item.category === category)
    );
  });
  protected readonly categories = computed(() =>
    [...new Set(this.activities().map((item) => item.category))]
  );
  protected readonly statusLabel = STATUS_LABEL;
  protected readonly categoryLabel = CATEGORY_LABEL;
  protected readonly categoryOptions = computed<AppSelectOption[]>(() =>
    [...new Set([...Object.keys(CATEGORY_LABEL), ...this.categories()])].map((value) => ({
      value,
      label: CATEGORY_LABEL[value] || value
    }))
  );
  protected readonly statusOptions: readonly AppSelectOption[] = [
    { value: 'todo', label: '○ Da fare' },
    { value: 'done', label: '✓ Fatto' },
    { value: 'repeat', label: '↻ Da rifare' },
    { value: 'unavailable', label: '— Non più possibile' }
  ];

  protected readonly editingId = signal<number | 'new' | null>(null);
  protected readonly draft = signal<ActivityDraft>(emptyDraft());
  protected readonly formError = signal('');
  protected readonly savingActivity = signal(false);
  protected readonly deleteTargetId = signal<number | null>(null);

  constructor() {
    void this.load();
  }

  protected setFilter(filter: ActivityFilter): void {
    this.filter.set(filter);
  }

  protected async setStatus(activity: TogetherActivity, next: ActivityStatus): Promise<void> {
    if (this.savingId() !== null || next === activity.status || !STATUS_LABEL[next]) return;
    const previous = activity.status;
    this.updateLocalStatus(activity.id, next);
    this.savingId.set(activity.id);

    try {
      const response = await fetch('/api/together/status', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activityId: activity.id, status: next })
      });
      if (!response.ok) throw new Error();
    } catch {
      this.updateLocalStatus(activity.id, previous);
      this.error.set('Non sono riuscito a salvare la modifica. Riprova.');
    } finally {
      this.savingId.set(null);
    }
  }

  // Logga l'apertura del pannello NSFW anche se poi non viene inviata nessuna risposta
  // (annullata o abbandonata): il tentativo di sblocco vero e proprio resta loggato a parte
  // da together/unlock.js con l'esito (together_nsfw_attempt).
  protected openUnlockPanel(): void {
    const willOpen = !this.unlockOpen();
    this.unlockOpen.set(willOpen);
    if (willOpen) {
      void this.telemetry.trackEvent('cose-insieme', 'together_nsfw_panel_opened');
    }
  }

  protected async unlock(answerInput: HTMLInputElement): Promise<void> {
    const answer = answerInput.value.trim();
    if (!answer || this.unlocking()) return;
    this.unlocking.set(true);
    this.unlockError.set('');

    try {
      const response = await fetch('/api/together/unlock', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer })
      });
      const data = (await response.json()) as { unlocked?: boolean; privateParts?: PrivatePart[]; error?: string };
      if (!response.ok) throw new Error(data.error);
      if (!data.unlocked) {
        this.unlockError.set('Se non si è sbloccato vuol dire che pensavo fosse una cosa diversa ahaha');
        return;
      }
      this.privateParts.set(new Map((data.privateParts ?? []).map((part) => [part.id, part.text])));
      this.unlockOpen.set(false);
      answerInput.value = '';
    } catch (error) {
      this.unlockError.set(error instanceof Error && error.message ? error.message : 'Non sono riuscito a controllare la risposta.');
    } finally {
      this.unlocking.set(false);
    }
  }

  private async load(): Promise<void> {
    try {
      const response = await fetch('/api/together', { credentials: 'same-origin' });
      if (!response.ok) throw new Error();
      const data = (await response.json()) as { activities: TogetherActivity[] };
      this.activities.set(data.activities);
    } catch {
      this.error.set('Non sono riuscito a caricare la lista.');
    } finally {
      this.loading.set(false);
    }
  }

  private updateLocalStatus(id: number, status: ActivityStatus): void {
    this.activities.update((items) => items.map((item) => item.id === id ? { ...item, status } : item));
  }

  protected startCreate(): void {
    this.draft.set(emptyDraft());
    this.formError.set('');
    this.editingId.set('new');
  }

  // Il testo privato non arriva mai dalla lista pubblica (this.activities): va richiesto qui,
  // con permesso content.edit, solo nel momento in cui l'admin apre davvero la modifica.
  protected async startEdit(activityId: number): Promise<void> {
    this.formError.set('');
    try {
      const response = await fetch('/api/together/activities', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error();
      const result = await this.api.readApiResponse<{ activities?: FullActivity[] }>(response);
      const full = (result.activities ?? []).find((item) => item.id === activityId);
      if (!full) {
        this.formError.set('Non sono riuscito a trovare l\'attività.');
        return;
      }
      this.draft.set(toDraft(full));
      this.editingId.set(activityId);
    } catch {
      this.formError.set('Non sono riuscito a caricare l\'attività per la modifica.');
    }
  }

  protected cancelEdit(): void {
    this.editingId.set(null);
  }

  protected updateDraft(patch: Partial<ActivityDraft>): void {
    this.draft.set({ ...this.draft(), ...patch });
  }

  protected async submitEdit(): Promise<void> {
    if (this.savingActivity()) return;
    this.formError.set('');
    const d = this.draft();
    if (!d.text.trim() && !d.privateText.trim()) {
      this.formError.set('Serve almeno un testo pubblico o privato.');
      return;
    }
    if (!d.category.trim() || !d.approximateDate.trim()) {
      this.formError.set('Categoria e data indicativa sono obbligatorie.');
      return;
    }

    const payload = {
      text: d.text.trim() || null,
      category: d.category.trim(),
      privateText: d.privateText.trim() || null,
      link: d.link.trim() || null,
      approximateDate: d.approximateDate.trim()
    };

    const isNew = this.editingId() === 'new';
    const endpoint = isNew ? '/api/together/activities' : `/api/together/activities/${this.editingId()}`;
    this.savingActivity.set(true);
    try {
      const response = await fetch(endpoint, {
        method: isNew ? 'POST' : 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await this.api.readApiResponse<{ error?: string }>(response);
      if (!response.ok) {
        this.formError.set(result.error || 'Non è stato possibile salvare l\'attività.');
        return;
      }
      this.editingId.set(null);
      await this.load();
    } catch {
      this.formError.set('Non è stato possibile contattare il server. Controlla la connessione e riprova.');
    } finally {
      this.savingActivity.set(false);
    }
  }

  protected requestDelete(id: number): void {
    this.deleteTargetId.set(id);
  }

  protected cancelDelete(): void {
    this.deleteTargetId.set(null);
  }

  protected async confirmDelete(): Promise<void> {
    const id = this.deleteTargetId();
    if (id === null) return;
    await this.api.sendAuthenticatedJson(`/api/together/activities/${id}`, {}, 'DELETE');
    this.deleteTargetId.set(null);
    await this.load();
  }
}
