import { gdrAdventureIcon } from '../../core/gdr-adventure-icons';
import { Component, DestroyRef, HostListener, Input, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter } from 'rxjs';
import { SafeModeService, isSafeRoute } from '../../core/safe-mode.service';
import { HOME_AREAS, HomeAreaId, WORLD_PLACES, WorldPlace, WorldPlaceGroup } from '../../core/world-places';

const FALLBACK_AREA_BY_GROUP: Record<WorldPlaceGroup, HomeAreaId> = {
  ricordi: 'valle',
  insieme: 'prato',
  giochi: 'prato',
  mondo: 'osservatorio'
};

@Component({
  selector: 'app-world-navigation',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './world-navigation.html',
  styleUrl: './world-navigation.css'
})
export class WorldNavigation {
  protected readonly adventureIcon = gdrAdventureIcon;
  @Input() parentHref = '/';
  @Input() parentLabel = 'Torna indietro';
  @Input() showBack = true;

  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly adventures = signal<{id: string; title: string}[]>([]);
  protected readonly navigationOpen = signal(false);
  protected readonly currentPath = signal(this.pathFromUrl(this.router.url));
  protected readonly safe = inject(SafeModeService);
  protected readonly groups = computed(() => HOME_AREAS.map((area) => {
    const areaPlaces = WORLD_PLACES.filter((place) =>
      place.id !== 'profilo' && place.route && (!this.safe.enabled() || isSafeRoute(place.route)) && this.areaFor(place) === area.id
    );
    const primaryPlaces = areaPlaces.filter((place) => place.primary);

    return {
      ...area,
      label: this.safe.enabled() ? (area.id === 'prato' ? 'Studio e giochi' : 'Il mondo') : area.label,
      entries: primaryPlaces.map((place) => ({
        place,
        children: areaPlaces.filter((candidate) => !candidate.primary && candidate.parentId === place.id)
      })),
      secondaryPlaces: areaPlaces.filter((place) => !place.primary && !place.parentId)
    };
  }).filter(group => group.entries.length || group.secondaryPlaces.length));

  constructor() {
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((event) => {
        this.currentPath.set(this.pathFromUrl(event.urlAfterRedirects));
        this.close();
      });
  }

  protected isCurrent(route: string | null): boolean {
    return route === this.currentPath();
  }

  private async loadAdventures(): Promise<void> {
    try {
      const response = await fetch('/api/gdr-workspace', { credentials: 'same-origin' });
      if (!response.ok) return;
      const data = await response.json();
      this.adventures.set(data.adventures ?? []);
    } catch { /* La navigazione generale resta disponibile. */ }
  }

  protected open(): void {
    this.navigationOpen.set(true);
    void this.loadAdventures();
  }

  protected close(): void {
    this.navigationOpen.set(false);
  }

  protected toggle(): void {
    if (this.navigationOpen()) this.close();
    else this.open();
  }

  @HostListener('document:keydown.escape')
  protected closeOnEscape(): void {
    this.close();
  }

  protected scrollToTop(): void {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  protected scrollToBottom(): void {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
  }

  private areaFor(place: WorldPlace): HomeAreaId {
    if (place.homeArea) return place.homeArea;

    if (place.parentId) {
      const parent = WORLD_PLACES.find((candidate) => candidate.id === place.parentId);
      if (parent?.homeArea) return parent.homeArea;
    }

    return FALLBACK_AREA_BY_GROUP[place.group];
  }

  private pathFromUrl(url: string): string {
    return url.split(/[?#]/, 1)[0] || '/';
  }
}
