import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { SafeModeService, isSafeRoute } from '../../core/safe-mode.service';
import { AuthService } from '../../core/auth.service';
import { CarteBustineService, CarteBustineState } from '../../core/carte-bustine.service';
import { CartaPack } from '../carta-pack/carta-pack';

type UpdateKind = 'contenuto' | 'mondo';
type PromoPlacement = 'automatico' | 'lato' | 'alto' | 'basso';

interface WorldUpdate {
  id: string;
  kind: UpdateKind;
  emoji: string;
  title: string;
  body: string;
  route: string | null;
  ctaLabel: string | null;
  publishedAt: string;
  seen: boolean;
  safe: boolean;
}

interface WorldPromo {
  id: string;
  label: 'commerciale' | 'consiglia' | 'sponsor' | 'promozionale';
  emoji: string;
  title: string;
  body: string;
  route: string | null;
  ctaLabel: string | null;
  placement: PromoPlacement;
}

@Component({
  selector: 'app-world-discovery',
  standalone: true,
  imports: [RouterLink, CartaPack],
  templateUrl: './world-discovery.html',
  styleUrl: './world-discovery.css'
})
export class WorldDiscovery {
  protected readonly safe = inject(SafeModeService);
  protected readonly isAllowed = isSafeRoute;
  private readonly auth = inject(AuthService);
  private readonly cards = inject(CarteBustineService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly updates = signal<WorldUpdate[]>([]);
  protected readonly unseen = computed(() => this.updates().filter((update) => !update.seen && (!this.safe.enabled() || update.safe)));
  protected readonly updateTab = signal<UpdateKind>('contenuto');
  protected readonly visibleUpdates = computed(() => this.unseen().filter((update) => update.kind === this.updateTab()));
  protected readonly updateModalOpen = signal(false);
  protected readonly rewardModalOpen = signal(false);
  protected readonly reward = signal<CarteBustineState | null>(null);
  protected readonly promo = signal<WorldPromo | null>(null);
  protected readonly promoVisible = signal(false);
  private activeSafeMode: boolean | null = null;
  private activeUserId: number | null = null;
  private run = 0;
  private promoTimer: number | null = null;

  protected readonly promoLabel = computed(() => {
    const labels = {
      commerciale: 'Messaggio commerciale',
      consiglia: 'Il Mondo Bianco consiglia',
      sponsor: 'Lo sponsor di oggi',
      promozionale: 'Spazio promozionale'
    };
    return this.promo() ? labels[this.promo()!.label] : '';
  });

  constructor() {
    effect(() => {
      const userId = this.auth.currentUser()?.id ?? null;
      const safeMode = this.safe.enabled();
      if (userId === this.activeUserId && safeMode === this.activeSafeMode) return;
      this.activeSafeMode = safeMode;
      this.activeUserId = userId;
      this.reset();
      if (userId !== null) void this.initialize(userId, ++this.run);
    });
    this.destroyRef.onDestroy(() => this.clearPromoTimer());
  }

  protected hasKind(kind: UpdateKind): boolean {
    return this.unseen().some((update) => update.kind === kind);
  }

  protected selectTab(kind: UpdateKind): void {
    this.updateTab.set(kind);
  }

  protected closeUpdates(): void {
    const ids = this.unseen().map((update) => update.id);
    this.updateModalOpen.set(false);
    this.updates.update((updates) => updates.map((update) => ids.includes(update.id) ? { ...update, seen: true } : update));
    if (ids.length > 0 && !this.auth.impersonation()) {
      void fetch('/api/world-updates/seen', {
        method: 'POST', credentials: 'same-origin', keepalive: true,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids })
      });
    }
    this.openRewardOrSchedulePromo();
  }

  protected closeReward(): void {
    this.rewardModalOpen.set(false);
    this.schedulePromo();
  }

  protected closePromo(): void {
    this.promoVisible.set(false);
  }

  protected promoClass(): string {
    return `world-promo world-promo--${this.promo()?.placement ?? 'automatico'}`;
  }

  private async initialize(userId: number, run: number): Promise<void> {
    try {
      const path = this.router.url.split(/[?#]/, 1)[0] || '/';
      const [updatesResponse, promoResponse, reward] = await Promise.all([
        fetch('/api/world-updates', { credentials: 'same-origin', headers: { Accept: 'application/json' } }),
        this.safe.enabled() ? Promise.resolve(Response.json({}))
          : fetch(`/api/world-promos?path=${encodeURIComponent(path)}`, { credentials: 'same-origin', headers: { Accept: 'application/json' } }),
        this.safe.enabled() ? Promise.resolve(null) : this.cards.load(userId)
      ]);
      if (run !== this.run || this.activeUserId !== userId) return;
      if (updatesResponse.ok) {
        const data = await updatesResponse.json() as { updates?: WorldUpdate[] };
        this.updates.set(data.updates ?? []);
      }
      if (promoResponse.ok) {
        const data = await promoResponse.json() as { promo?: WorldPromo | null };
        this.promo.set(data.promo ?? null);
      }
      this.reward.set(reward);

      // Nella pagina archivio le novità vengono lette direttamente lì; niente modale sopra.
      if (path !== '/novita' && this.unseen().length > 0) {
        this.updateTab.set(this.hasKind('contenuto') ? 'contenuto' : 'mondo');
        this.updateModalOpen.set(true);
      } else {
        this.openRewardOrSchedulePromo();
      }
    } catch {
      // Gli elementi di scoperta non devono mai impedire l'uso del resto del sito.
    }
  }

  private openRewardOrSchedulePromo(): void {
    if (this.safe.enabled()) return;
    const reward = this.reward();
    if (reward?.streakPrimaVisitaOggi) {
      this.rewardModalOpen.set(true);
      return;
    }
    this.schedulePromo();
  }

  private schedulePromo(): void {
    if (this.safe.enabled()) return;
    const promo = this.promo();
    if (!promo || this.promoVisible()) return;
    this.clearPromoTimer();
    this.promoTimer = window.setTimeout(() => {
      this.promoTimer = null;
      if (this.updateModalOpen() || this.rewardModalOpen() || !this.auth.currentUser()) return;
      this.promoVisible.set(true);
      if (!this.auth.impersonation()) void fetch('/api/world-promos/view', {
        method: 'POST', credentials: 'same-origin', keepalive: true,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ promoId: promo.id })
      });
    }, 7000);
  }

  private reset(): void {
    this.run++;
    this.clearPromoTimer();
    this.updates.set([]);
    this.updateModalOpen.set(false);
    this.rewardModalOpen.set(false);
    this.reward.set(null);
    this.promo.set(null);
    this.promoVisible.set(false);
  }

  private clearPromoTimer(): void {
    if (this.promoTimer !== null) window.clearTimeout(this.promoTimer);
    this.promoTimer = null;
  }
}
