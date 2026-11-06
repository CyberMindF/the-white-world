import { Component, DestroyRef, effect, inject, signal } from '@angular/core';
import { WorldSettingsService } from '../core/world-settings.service';
import { randomBetween } from './random';

interface NorthernLight {
  x: number;
  width: number;
  opacity: number;
  scaleX: number;
  scaleY: number;
  duration: number;
  delay: number;
  colorIndex: number;
}

@Component({ selector: 'app-world-pearl-shimmers', standalone: true, templateUrl: './world-pearl-shimmers.html' })
export class WorldPearlShimmers {
  protected readonly worldSettingsService = inject(WorldSettingsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly mixedBandSizes = this.createMixedBandSizes(100);
  private readonly mixedBands = signal(this.expandMixedBands(this.mixedBandSizes));
  private readonly visibleMixedBands = signal([...this.mixedBands()]);
  private mixedWalkDirection = randomBetween(0, 1) > .5 ? 1 : -1;
  protected readonly northernLights: NorthernLight[] = Array.from({ length: 100 }, (_, index) => ({
    x: 1 + index,
    width: randomBetween(28, 46),
    opacity: randomBetween(.25, .72),
    scaleX: randomBetween(.65, 1.35),
    scaleY: randomBetween(.65, 1.15),
    duration: randomBetween(3.8, 7.5),
    delay: randomBetween(-7.5, 0),
    colorIndex: index
  }));

  constructor() {
    const visible = signal(!document.hidden);
    const visibility = () => visible.set(!document.hidden);
    document.addEventListener('visibilitychange', visibility);
    this.destroyRef.onDestroy(() => document.removeEventListener('visibilitychange', visibility));
    effect(onCleanup => {
      if (!visible() || !this.worldSettingsService.settings().pearlShimmers || this.auroraColor() !== 'mix') return;
      const interval = window.setInterval(() => this.walkMixedBands(), 1400);
      onCleanup(() => window.clearInterval(interval));
    });
  }

  protected auroraColor(): string {
    const color = this.worldSettingsService.values().pearlShimmers;
    return color && color !== 'white' ? color : 'green';
  }

  protected northernGradient(index: number): string {
    const color = this.auroraColor();
    if (color !== 'mix') return `northern-${color}`;
    return `northern-${this.visibleMixedBands()[index]}`;
  }

  protected commitNorthernColor(index: number): void {
    if (this.auroraColor() !== 'mix') return;
    const desired = this.mixedBands()[index];
    const visible = this.visibleMixedBands();
    if (visible[index] === desired) return;
    const next = [...visible];
    next[index] = desired;
    this.visibleMixedBands.set(next);
  }

  private createMixedBandSizes(count: number): number[] {
    const sizes: number[] = [];
    let remaining = count;
    while (remaining > 0) {
      const size = Math.min(Math.floor(randomBetween(20, 41)), remaining);
      sizes.push(size);
      remaining -= size;
    }
    return sizes;
  }

  private expandMixedBands(sizes: number[]): Array<'green' | 'blue' | 'magenta'> {
    const colors = ['green', 'blue', 'magenta'] as const;
    return sizes.flatMap((size, index) => Array.from({ length: size }, () => colors[index % colors.length]));
  }

  private walkMixedBands(): void {
    if (randomBetween(0, 1) < .08) {
      this.mixedWalkDirection *= -1;
    }
    const bands = [...this.mixedBands()];
    if (this.mixedWalkDirection > 0) {
      const last = bands.pop();
      if (last) bands.unshift(last);
    } else {
      const first = bands.shift();
      if (first) bands.push(first);
    }
    this.mixedBands.set(bands);
  }
}
