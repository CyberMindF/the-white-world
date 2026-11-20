import { Component, ElementRef, EventEmitter, HostListener, Input, Output, signal, viewChild } from '@angular/core';

export interface AppSelectOption {
  value: string;
  label: string;
  group?: string;
}

let nextSelectId = 0;

@Component({
  selector: 'app-select',
  standalone: true,
  host: {
    '[class.is-open]': 'open()'
  },
  styleUrls: ['../../../styles/components/app-select.css'],
  templateUrl: './app-select.html'
})
export class AppSelect {
  @Input() options: readonly AppSelectOption[] = [];
  @Input() value = '';
  @Output() readonly valueChange = new EventEmitter<string>();
  @Input() variant: 'field' | 'pill' = 'field';
  @Input() placeholder = 'Scegli…';
  @Input() name = '';
  @Input() ariaLabel = 'Scegli un’opzione';
  @Input() inputId = '';
  @Input() disabled = false;
  @Input() required = false;

  protected readonly open = signal(false);
  protected readonly dropUp = signal(false);
  protected readonly listboxId = `app-select-${++nextSelectId}`;
  private readonly root = viewChild<ElementRef<HTMLElement>>('root');

  protected get selectedLabel(): string {
    return this.options.find((option) => option.value === this.value)?.label ?? this.placeholder;
  }

  protected toggle(): void {
    if (this.disabled) return;
    const willOpen = !this.open();
    this.open.set(willOpen);
    if (willOpen) requestAnimationFrame(() => this.updateDirection());
  }

  protected choose(option: AppSelectOption): void {
    if (this.disabled) return;
    this.value = option.value;
    this.valueChange.emit(option.value);
    this.open.set(false);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (this.disabled) return;
    if (event.key === 'Escape') {
      this.open.set(false);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.toggle();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !this.options.length) return;

    event.preventDefault();
    const current = this.options.findIndex((option) => option.value === this.value);
    let next = current;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = this.options.length - 1;
    else if (event.key === 'ArrowDown') next = Math.min(current + 1, this.options.length - 1);
    else next = Math.max(current < 0 ? 0 : current - 1, 0);
    this.choose(this.options[next]);
  }

  @HostListener('document:pointerdown', ['$event'])
  protected closeOutside(event: PointerEvent): void {
    if (!this.open() || this.root()?.nativeElement.contains(event.target as Node)) return;
    this.open.set(false);
  }

  private updateDirection(): void {
    const element = this.root()?.nativeElement;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const estimatedMenuHeight = Math.min(this.options.length * 44 + 12, 280);
    this.dropUp.set(window.innerHeight - rect.bottom < estimatedMenuHeight && rect.top > estimatedMenuHeight);
  }
}
