import { Component, ElementRef, OnDestroy, afterNextRender, inject, signal } from '@angular/core';

/** One outline and one translucent fill, including when the text wraps or grows. */
@Component({
  selector: 'span[gdrThoughtCloud]',
  standalone: true,
  template: `<svg [attr.viewBox]="viewBox()" preserveAspectRatio="none" focusable="false"><path [attr.d]="outline()" vector-effect="non-scaling-stroke" /></svg>`,
  styles: `
    :host { position: absolute; inset: 0; z-index: -1; pointer-events: none; }
    svg { display: block; width: 100%; height: 100%; overflow: visible; }
    path { fill: var(--thought-fill); stroke: var(--border-color); stroke-width: 1; stroke-linejoin: round; }
  `,
})
export class GdrThoughtCloud implements OnDestroy {
  private readonly element = inject(ElementRef<HTMLElement>);
  private observer?: ResizeObserver;
  readonly viewBox = signal('0 0 160 96');
  readonly outline = signal(cloudOutline(160, 96));

  constructor() {
    afterNextRender(() => {
      const update = () => {
        const { width, height } = this.element.nativeElement.getBoundingClientRect();
        if (!width || !height) return;
        this.viewBox.set(`0 0 ${width} ${height}`);
        this.outline.set(cloudOutline(width, height));
      };
      if (typeof ResizeObserver !== 'undefined') {
        this.observer = new ResizeObserver(update);
        this.observer.observe(this.element.nativeElement);
      }
      update();
    });
  }

  ngOnDestroy(): void { this.observer?.disconnect(); }
}

function cloudOutline(width: number, height: number): string {
  const w = Math.max(64, width), h = Math.max(64, height);
  const horizontal = Math.max(2, Math.round((w - 64) / 52));
  const vertical = Math.max(1, Math.round((h - 64) / 44));
  const dx = (w - 64) / horizontal, dy = (h - 64) / vertical;
  const path = ['M32 14'];
  for (let i = 0; i < horizontal; i++) path.push(`Q${32 + dx * (i + .5)} -8 ${32 + dx * (i + 1)} 14`);
  path.push(`C${w - 6} 0 ${w} 20 ${w - 14} 32`);
  for (let i = 0; i < vertical; i++) path.push(`Q${w + 8} ${32 + dy * (i + .5)} ${w - 14} ${32 + dy * (i + 1)}`);
  path.push(`C${w} ${h - 20} ${w - 6} ${h} ${w - 32} ${h - 14}`);
  for (let i = 0; i < horizontal; i++) path.push(`Q${w - 32 - dx * (i + .5)} ${h + 8} ${w - 32 - dx * (i + 1)} ${h - 14}`);
  path.push(`C6 ${h} 0 ${h - 20} 14 ${h - 32}`);
  for (let i = 0; i < vertical; i++) path.push(`Q-8 ${h - 32 - dy * (i + .5)} 14 ${h - 32 - dy * (i + 1)}`);
  path.push('C0 20 6 0 32 14Z');
  return path.join(' ');
}
