import { Component, DestroyRef, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { SafeModeService } from './core/safe-mode.service';
import { AuthService } from './core/auth.service';
import { CarteBustineService } from './core/carte-bustine.service';
import { RealtimeService } from './core/realtime.service';
import { ThemeService } from './core/theme.service';
import { WorldSettingsService } from './core/world-settings.service';
import { WorldFish } from './shared/world-fish';
import { WorldLanterns } from './shared/world-lanterns';
import { WorldLeaves } from './shared/world-leaves';
import { WorldMoon } from './shared/world-moon';
import { WorldPetals } from './shared/world-petals';
import { WorldSparkles } from './shared/world-sparkles';
import { WorldStars } from './shared/world-stars';
import { WorldWaves } from './shared/world-waves';
import { WorldBubbles } from './shared/world-bubbles';
import { WorldHearts } from './shared/world-hearts';
import { WorldPearlShimmers } from './shared/world-pearl-shimmers';
import { WorldSilk } from './shared/world-silk';
import { WorldShootingStars } from './shared/world-shooting-stars';
import { WorldStickers } from './shared/world-stickers';
import { WorldBalloons } from './shared/world-balloons';
import { WorldFireworks } from './shared/world-fireworks';
import { GlobalChatWidget } from './shared/global-chat-widget/global-chat-widget';
import { GlobalChatService } from './core/global-chat.service';
import { StudyFocusService } from './core/study-focus.service';
import { WorldDiscovery } from './shared/world-discovery/world-discovery';

// Eventi usati come "prova di attività" per rinnovare lo sblocco della Chiave (vedi
// AuthService.touchAccessUnlock) — non serve seguire ogni movimento del mouse, basta sapere
// che qualcuno sta ancora interagendo con la pagina.
const ACTIVITY_EVENTS = ['pointerdown', 'keydown'] as const;
// Non scrivere su sessionStorage a ogni singolo click: un tocco al minuto basta per restare
// entro la finestra di inattività di un'ora.
const ACTIVITY_TOUCH_THROTTLE_MS = 60 * 1000;
const VERSION_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const BUSTINE_PRESENCE_INTERVAL_MS = 60 * 1000;

const ROUTE_BODY_CLASSES = [
  'access-locked',
  'portone-page',
  'world-page',
  'bacheca-page',
  'calendar-page',
  'music-page',
  'lettere-page',
  'map-page',
  'globe-page',
  'ponti-page',
  'stories-page',
  'suggerimenti-page',
  'profilo-page',
  'amministrazione-page',
  'impostazioni-mondo-page',
  'novita-page',
  'sky-view-page',
  'aula-studio-page',
  'tavolo-page',
  'not-found-page'
];

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, GlobalChatWidget, WorldDiscovery, WorldStars, WorldShootingStars, WorldLanterns, WorldMoon, WorldSparkles, WorldLeaves, WorldWaves, WorldFish, WorldPetals, WorldBubbles, WorldHearts, WorldPearlShimmers, WorldSilk, WorldStickers, WorldBalloons, WorldFireworks],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  private readonly router = inject(Router);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly themeService = inject(ThemeService);
  private readonly worldSettingsService = inject(WorldSettingsService);
  protected readonly safe = inject(SafeModeService);
  protected readonly authService = inject(AuthService);
  private readonly carteBustineService = inject(CarteBustineService);
  private readonly realtimeService = inject(RealtimeService);
  private readonly globalChat = inject(GlobalChatService);
  protected readonly studyFocus = inject(StudyFocusService);
  private lastActivityTouchAt = 0;
  private readonly currentAssetSignature = this.assetSignature(document);
  private readonly currentDeploymentVersion = document.querySelector<HTMLMetaElement>('meta[name="app-version"]')?.content || '';
  private checkingBuildVersion = false;
  private worldSettingsLoadedForUserId: number | null = null;
  private bustinePresenceTimer: number | null = null;
  private bustinePresenceUserId: number | null = null;
  protected readonly updateAvailable = signal(false);
  protected readonly stoppingImpersonation = signal(false);
  protected readonly impersonationError = signal('');
  protected async stopImpersonation():Promise<void>{
    this.stoppingImpersonation.set(true);this.impersonationError.set('');
    if(await this.authService.setImpersonation(null)){window.location.reload();return;}
    this.stoppingImpersonation.set(false);this.impersonationError.set('Impossibile uscire dall’impersonazione. Riprova.');
  }
  protected readonly showGlobalChat = signal(!['/ponti-chat', '/login'].includes(this.router.url.split('?')[0]));

  constructor() {
    const refreshIdentity=(event:StorageEvent)=>{if(event.key==='world-impersonation-changed')window.location.reload();};
    window.addEventListener('storage',refreshIdentity);
    this.destroyRef.onDestroy(()=>window.removeEventListener('storage',refreshIdentity));
    this.safe.apply(true);
    document.body.classList.add('world-atmosphere');
    this.themeService.applySavedTheme();
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((event) => {
        this.applyRouteBodyClasses();
        this.restartBustinePresenceTimer();
        const showChat = !['/ponti-chat', '/login'].includes(event.urlAfterRedirects.split('?')[0]);
        this.showGlobalChat.set(showChat);
        if (!showChat) this.globalChat.panelOpen.set(false);
      });

    const onActivity = () => this.touchAccessUnlockThrottled();
    ACTIVITY_EVENTS.forEach((eventName) => document.addEventListener(eventName, onActivity, { passive: true }));
    this.destroyRef.onDestroy(() => {
      ACTIVITY_EVENTS.forEach((eventName) => document.removeEventListener(eventName, onActivity));
    });

    const checkBuildVersion = () => void this.checkBuildVersion();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') checkBuildVersion();
      this.restartBustinePresenceTimer();
    };
    const versionTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') checkBuildVersion();
    }, VERSION_CHECK_INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisibilityChange);
    this.destroyRef.onDestroy(() => {
      window.clearInterval(versionTimer);
      this.stopBustinePresenceTimer();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    });
    checkBuildVersion();

    this.realtimeService.on('site-version:changed')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => {
        const version = typeof event['version'] === 'string' ? event['version'] : '';
        if (!version || version === this.currentDeploymentVersion || this.updateAvailable()) return;
        if (this.currentDeploymentVersion) {
          this.updateAvailable.set(true);
        } else {
          void this.checkBuildVersion();
        }
      });

    this.realtimeService.on('world-settings:changed')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => {
        if (event['actorUserId'] === this.authService.currentUser()?.id) return;
        const userId = this.authService.currentUser()?.id;
        if (userId !== undefined) void this.loadSharedWorldSettings(userId);
      });

    effect(() => {
      const userId = this.authService.currentUser()?.id;
      if (userId === undefined) {
        this.stopBustinePresenceTimer();
        this.globalChat.clear();
        this.carteBustineService.clear();
        this.realtimeService.disconnect();
        this.worldSettingsLoadedForUserId = null;
        return;
      }
      this.restartBustinePresenceTimer();
      this.realtimeService.connect();
      void this.globalChat.startForCurrentUser();
      if (!this.safe.enabled()) void this.carteBustineService.load(userId).catch((error) => {
        console.warn('Impossibile aggiornare la streak di accesso:', error);
      });
      if (this.worldSettingsLoadedForUserId !== userId) {
        this.worldSettingsLoadedForUserId = userId;
        void this.loadSharedWorldSettings(userId);
      }
    });
  }

  // Un tick parte solo dopo un minuto intero di visibilita continua. Nascondere la pagina,
  // cambiare account o fare logout azzera il timer; la deduplicazione definitiva resta sul
  // server, cosi due schede aperte non raddoppiano le bustine.
  private restartBustinePresenceTimer(): void {
    const userId = this.authService.currentUser()?.id;
    if (this.authService.impersonation() || this.safe.enabled() || userId === undefined || document.visibilityState !== 'visible' || this.router.url.split('?')[0] === '/login') {
      this.stopBustinePresenceTimer();
      return;
    }
    // Le guardie aggiornano currentUser a ogni navigazione: conserviamo il minuto in corso.
    if (this.bustinePresenceTimer !== null && this.bustinePresenceUserId === userId) return;
    this.stopBustinePresenceTimer();
    this.bustinePresenceUserId = userId;

    this.bustinePresenceTimer = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || this.authService.currentUser()?.id !== userId) {
        return;
      }
      void this.carteBustineService.recordActiveMinute(userId).catch((error) => {
        console.warn('Impossibile aggiornare il tempo per le bustine:', error);
      });
    }, BUSTINE_PRESENCE_INTERVAL_MS);
  }

  private stopBustinePresenceTimer(): void {
    if (this.bustinePresenceTimer === null) return;
    window.clearInterval(this.bustinePresenceTimer);
    this.bustinePresenceTimer = null;
    this.bustinePresenceUserId = null;
  }

  private async loadSharedWorldSettings(userId: number): Promise<void> {
    const loaded = await this.worldSettingsService.load();
    if (!loaded) {
      if (this.worldSettingsLoadedForUserId === userId) this.worldSettingsLoadedForUserId = null;
      return;
    }
    // Se nel frattempo è avvenuto il logout o è cambiato account, non applicare alla nuova
    // sessione una risposta iniziata per quella precedente.
    if (this.authService.currentUser()?.id === userId) {
      this.themeService.applySharedTheme();
    }
  }

  protected refreshForUpdate(): void {
    const reloadUrl = new URL(window.location.href);
    reloadUrl.searchParams.set('__app_update', String(Date.now()));
    window.location.replace(reloadUrl.toString());
  }

  private async checkBuildVersion(): Promise<void> {
    if (this.checkingBuildVersion || this.updateAvailable()) return;
    this.checkingBuildVersion = true;
    try {
      const response = await fetch(`/?t=${Date.now()}`, {
        cache: 'no-store',
        headers: { Accept: 'text/html' }
      });
      if (!response.ok) return;
      const latestDocument = new DOMParser().parseFromString(await response.text(), 'text/html');
      const latestAssetSignature = this.assetSignature(latestDocument);
      if (latestAssetSignature && latestAssetSignature !== this.currentAssetSignature) {
        this.updateAvailable.set(true);
      }
    } catch (error) {
      console.warn('Impossibile controllare la versione del sito:', error);
    } finally {
      this.checkingBuildVersion = false;
    }
  }

  private assetSignature(root: Document): string {
    const assets = [
      ...Array.from(root.querySelectorAll<HTMLScriptElement>('script[src]')).map((element) => element.getAttribute('src')),
      ...Array.from(root.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]')).map((element) => element.getAttribute('href'))
    ].filter((value): value is string => {
      if (!value) return false;
      const fileName = value.split('/').pop()?.split('?')[0] || '';
      return /^(main|polyfills|styles)-[^/]+\.(js|css)$/.test(fileName);
    });
    return [...new Set(assets)].sort().join('|');
  }

  // Rinnova lo sblocco della Chiave durante l'uso attivo, anche restando sulla stessa pagina
  // (es. una lunga sessione di cruciverba), non solo quando si cambia rotta.
  private touchAccessUnlockThrottled(): void {
    const userId = this.authService.currentUser()?.id;
    if (userId === undefined) {
      return;
    }
    const now = Date.now();
    if (now - this.lastActivityTouchAt < ACTIVITY_TOUCH_THROTTLE_MS) {
      return;
    }
    this.lastActivityTouchAt = now;
    this.authService.touchAccessUnlock(userId);
  }

  private applyRouteBodyClasses(): void {
    let route = this.activatedRoute;
    while (route.firstChild) {
      route = route.firstChild;
    }

    document.body.classList.remove(...ROUTE_BODY_CLASSES);
    const bodyClasses = route.snapshot.data['bodyClasses'];
    if (Array.isArray(bodyClasses)) {
      document.body.classList.add(...bodyClasses);
    }
  }
}
