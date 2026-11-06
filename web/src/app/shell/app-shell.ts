import { NavigationEnd, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Component, DestroyRef, Input, OnInit, inject } from '@angular/core';
import { TelemetryService } from '../core/telemetry.service';
import { BackLink } from '../layout/back-link/back-link';
import { WorldHeader } from '../layout/world-header/world-header';
import { WorldNavigation } from '../layout/world-navigation/world-navigation';
import { PageWip } from '../shared/page-wip/page-wip';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [BackLink, WorldHeader, WorldNavigation, PageWip],
  templateUrl: './app-shell.html'
})
export class AppShell implements OnInit {
  @Input() homeHref = '/';
  @Input() homeAria = 'Torna al Mondo Bianco';
  @Input() homeIcon = '←';
  @Input() homeLabel = 'Il Mondo Bianco';
  @Input() homeLabelCollapsible = true;
  @Input() showSuggestLink = true;
  @Input() showHomeShortcut = true;
  @Input() showBackLink = true;
  @Input() showHeader = true;
  @Input() shellClass = '';
  @Input() headerExtraClass = '';
  @Input() homeLinkExtraClass = '';
  @Input() userbarExtraClass = '';
  @Input() trackPageOpened = true;
  @Input() beforeLogout: (() => Promise<void>) | null = null;

  private readonly telemetryService = inject(TelemetryService);

  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private lastPath = '';
  private trackOpening(): void {
    const path = window.location.pathname;
    if (!this.trackPageOpened || path === this.lastPath) return;
    this.lastPath = path;
    void this.telemetryService.trackEvent(this.telemetryService.sectionFromPath(path), 'world_page_opened', { path });
  }
  ngOnInit(): void {
    this.trackOpening();
    this.router.events.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(event => {
      if (event instanceof NavigationEnd) this.trackOpening();
    });
  }
}
