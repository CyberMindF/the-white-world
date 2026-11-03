import { Component, computed, effect, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AppShell } from '../../shell/app-shell';
import { SafeModeService, isSafeRoute } from '../../core/safe-mode.service';
import { AuthService } from '../../core/auth.service';

type UpdateKind = 'contenuto' | 'mondo';
type PromoLabel = 'commerciale' | 'consiglia' | 'sponsor' | 'promozionale';
type PromoPlacement = 'automatico' | 'lato' | 'alto' | 'basso';
type PromoTarget = 'tutti' | 'lui' | 'lei';

interface WorldUpdate {
  id: string; kind: UpdateKind; emoji: string; title: string; body: string; route: string | null;
  ctaLabel: string | null; publishedAt: string; active: boolean; announce: boolean; safe: boolean; seen: boolean;
}
interface WorldPromo {
  id: string; label: PromoLabel; emoji: string; title: string; body: string; route: string | null;
  ctaLabel: string | null; placement: PromoPlacement; targetIdentity: PromoTarget; cooldownDays: number; active: boolean;
}

@Component({
  selector: 'app-novita',
  standalone: true,
  imports: [AppShell, FormsModule, RouterLink, DatePipe],
  templateUrl: './novita.html',
  styleUrl: './novita.css'
})
export class Novita {
  protected readonly safe = inject(SafeModeService);
  private readonly auth = inject(AuthService);
  protected readonly canEdit = computed(() => !this.safe.enabled() && this.auth.isAdmin() && this.auth.adminModeEnabled() && !this.auth.currentUser()?.isTest);
  protected readonly updates = signal<WorldUpdate[]>([]);
  protected readonly campaigns = signal<WorldPromo[]>([]);
  protected readonly promosEnabled = signal(true);
  protected readonly tab = signal<UpdateKind>('contenuto');
  protected readonly visibleUpdates = computed(() => this.updates().filter(update => update.active && (!this.safe.enabled() || update.safe)));
  protected readonly filteredUpdates = computed(() => this.visibleUpdates().filter(update => update.kind === this.tab()));
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');

  protected readonly editingUpdateId = signal<string | null>(null);
  updateKind: UpdateKind = 'contenuto';
  updateEmoji = '✨';
  updateTitle = '';
  updateBody = '';
  updateRoute = '';
  updateCta = '';
  updateDate = '';
  updateActive = true;
  updateAnnounce = true;
  updateSafe = false;

  protected readonly editingPromoId = signal<string | null>(null);
  promoLabel: PromoLabel = 'consiglia';
  promoEmoji = '📣';
  promoTitle = '';
  promoBody = '';
  promoRoute = '';
  promoCta = '';
  promoPlacement: PromoPlacement = 'automatico';
  promoTarget: PromoTarget = 'lei';
  promoCooldownDays = 7;
  promoActive = true;

  constructor() {
    this.editUpdate(null);
    this.editPromo(null);
    effect(() => { this.safe.enabled(); void this.load(); });
  }

  protected readonly isAllowed = isSafeRoute;

  protected hasUpdates(kind: UpdateKind): boolean {
    return this.visibleUpdates().some(update => update.kind === kind);
  }

  protected async load(): Promise<void> {
    this.loading.set(true); this.error.set('');
    try {
      const [updatesResponse, promosResponse] = await Promise.all([
        fetch('/api/world-updates', { credentials: 'same-origin', headers: { Accept: 'application/json' } }),
        this.safe.enabled() ? Promise.resolve(Response.json({}))
          : fetch('/api/world-promos?path=/novita', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      ]);
      if (!updatesResponse.ok) throw new Error('Non è stato possibile caricare le novità.');
      const updateData = await updatesResponse.json() as { updates?: WorldUpdate[] };
      this.updates.set(updateData.updates ?? []);
      if (!this.hasUpdates(this.tab())) {
        this.tab.set(this.hasUpdates('contenuto') ? 'contenuto' : 'mondo');
      }
      if (promosResponse.ok) {
        const promoData = await promosResponse.json() as { campaigns?: WorldPromo[]; promosEnabled?: boolean };
        this.campaigns.set(promoData.campaigns ?? []);
        if (typeof promoData.promosEnabled === 'boolean') this.promosEnabled.set(promoData.promosEnabled);
      }
      const unseenIds = this.updates().filter((update) => !update.seen && update.active && (!this.safe.enabled() || update.safe)).map((update) => update.id);
      if (unseenIds.length > 0 && !this.auth.impersonation()) {
        void fetch('/api/world-updates/seen', {
          method: 'POST', credentials: 'same-origin', keepalive: true,
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: unseenIds })
        });
        this.updates.update((updates) => updates.map((update) => ({ ...update, seen: true })));
      }
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Non è stato possibile caricare la pagina.');
    } finally { this.loading.set(false); }
  }

  protected editUpdate(update: WorldUpdate | null): void {
    this.editingUpdateId.set(update?.id ?? null);
    this.updateKind = update?.kind ?? 'contenuto';
    this.updateEmoji = update?.emoji ?? '✨';
    this.updateTitle = update?.title ?? '';
    this.updateBody = update?.body ?? '';
    this.updateRoute = update?.route ?? '';
    this.updateCta = update?.ctaLabel ?? '';
    this.updateDate = this.localDateTime(update?.publishedAt ?? new Date().toISOString());
    this.updateActive = update?.active ?? true;
    this.updateAnnounce = update?.announce ?? true;
    this.updateSafe = update?.safe ?? false;
    document.getElementById('update-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  protected async saveUpdate(): Promise<void> {
    if (!this.canEdit() || this.saving()) return;
    const publishedAt = new Date(this.updateDate);
    if (!this.updateTitle.trim() || !Number.isFinite(publishedAt.getTime())) {
      this.error.set('Inserisci almeno un titolo e una data valida.'); return;
    }
    const id = this.editingUpdateId();
    await this.save(`/api/world-updates${id ? `/${id}` : ''}`, id ? 'PUT' : 'POST', {
      kind: this.updateKind, emoji: this.updateEmoji, title: this.updateTitle, body: this.updateBody,
      route: this.updateRoute, ctaLabel: this.updateCta, publishedAt: publishedAt.toISOString(),
      active: this.updateActive, announce: this.updateAnnounce, safe: this.updateSafe
    }, async () => { this.editUpdate(null); await this.load(); });
  }

  protected editPromo(promo: WorldPromo | null): void {
    this.editingPromoId.set(promo?.id ?? null);
    this.promoLabel = promo?.label ?? 'consiglia';
    this.promoEmoji = promo?.emoji ?? '📣';
    this.promoTitle = promo?.title ?? '';
    this.promoBody = promo?.body ?? '';
    this.promoRoute = promo?.route ?? '';
    this.promoCta = promo?.ctaLabel ?? '';
    this.promoPlacement = promo?.placement ?? 'automatico';
    this.promoTarget = promo?.targetIdentity ?? 'lei';
    this.promoCooldownDays = promo?.cooldownDays ?? 7;
    this.promoActive = promo?.active ?? true;
    document.getElementById('promo-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  protected async savePromo(): Promise<void> {
    if (!this.canEdit() || this.saving()) return;
    if (!this.promoTitle.trim() || !this.promoBody.trim()) {
      this.error.set('Inserisci titolo e testo della pubblicità.'); return;
    }
    const id = this.editingPromoId();
    await this.save(`/api/world-promos${id ? `/${id}` : ''}`, id ? 'PUT' : 'POST', {
      label: this.promoLabel, emoji: this.promoEmoji, title: this.promoTitle, body: this.promoBody,
      route: this.promoRoute, ctaLabel: this.promoCta, placement: this.promoPlacement,
      targetIdentity: this.promoTarget, cooldownDays: Number(this.promoCooldownDays), active: this.promoActive
    }, async () => { this.editPromo(null); await this.load(); });
  }

  protected async setPromosEnabled(enabled: boolean): Promise<void> {
    if (!this.canEdit() || this.saving()) return;
    const previous = this.promosEnabled();
    this.promosEnabled.set(enabled);
    this.saving.set(true); this.error.set(''); this.notice.set('');
    try {
      const response = await fetch('/api/world-promos', {
        method: 'PUT', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Salvataggio non riuscito.');
      this.notice.set(enabled ? 'Pubblicità attivate.' : 'Pubblicità disattivate.');
    } catch (error) {
      this.promosEnabled.set(previous);
      this.error.set(error instanceof Error ? error.message : 'Salvataggio non riuscito.');
    } finally { this.saving.set(false); }
  }

  protected async deleteUpdate(update: WorldUpdate): Promise<void> {
    if (!confirm(`Eliminare “${update.title}”?`)) return;
    await this.remove(`/api/world-updates/${update.id}`, () => this.load());
  }

  protected async deletePromo(promo: WorldPromo): Promise<void> {
    if (!confirm(`Eliminare la pubblicità “${promo.title}”?`)) return;
    await this.remove(`/api/world-promos/${promo.id}`, () => this.load());
  }

  protected labelForPromo(label: PromoLabel): string {
    return { commerciale: 'Messaggio commerciale', consiglia: 'Il Mondo Bianco consiglia', sponsor: 'Lo sponsor di oggi', promozionale: 'Spazio promozionale' }[label];
  }

  private async save(url: string, method: string, body: unknown, onSuccess: () => Promise<void>): Promise<void> {
    this.saving.set(true); this.error.set(''); this.notice.set('');
    try {
      const response = await fetch(url, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Salvataggio non riuscito.');
      this.notice.set('Salvato.'); await onSuccess();
    } catch (error) { this.error.set(error instanceof Error ? error.message : 'Salvataggio non riuscito.'); }
    finally { this.saving.set(false); }
  }

  private async remove(url: string, onSuccess: () => Promise<void>): Promise<void> {
    this.saving.set(true); this.error.set('');
    try {
      const response = await fetch(url, { method: 'DELETE', credentials: 'same-origin' });
      if (!response.ok) throw new Error('Eliminazione non riuscita.');
      await onSuccess();
    } catch (error) { this.error.set(error instanceof Error ? error.message : 'Eliminazione non riuscita.'); }
    finally { this.saving.set(false); }
  }

  private localDateTime(iso: string): string {
    const date = new Date(iso);
    const part = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}T${part(date.getHours())}:${part(date.getMinutes())}`;
  }
}
