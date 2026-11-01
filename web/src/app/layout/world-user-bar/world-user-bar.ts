import { SafeModeToggle } from '../../shared/safe-mode-toggle';
import { Component, Input, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { SafeModeService } from '../../core/safe-mode.service';
import { NavigationService } from '../../core/navigation.service';

@Component({
  selector: 'app-world-user-bar',
  standalone: true,
  imports: [SafeModeToggle, RouterLink],
  templateUrl: './world-user-bar.html',
  styles: [
    `
      .impersonate-button,
      .impersonation-picker button {
        padding: 0.45rem 0.7rem;
        border: 1px solid var(--border-color);
        border-radius: 8px;
        background: var(--button-bg);
        color: var(--text-color);
        font: inherit;
        cursor: pointer;
      }
      .impersonation-picker {
        position: fixed;
        z-index: 500;
        top: 5rem;
        right: 1rem;
        max-width: calc(100vw - 2rem);
        box-sizing: border-box;
        padding: 1.2rem;
        border: 1px solid var(--border-color);
        border-radius: 12px;
        background: var(--bg-color);
        box-shadow: var(--shadow);
        display: grid;
        gap: 0.7rem;
      }
      .impersonation-picker p {
        margin: 0;
        font-size: 0.85rem;
      }
    `,
  ],
})
export class WorldUserBar {
  @Input() extraClass = '';
  @Input() showSuggestLink = true;
  @Input() showHomeShortcut = true;
  @Input() beforeLogout: (() => Promise<void>) | null = null;

  private readonly navigationService = inject(NavigationService);
  private readonly router = inject(Router);

  protected readonly safe = inject(SafeModeService);
  protected readonly loggingOut = signal(false);
  protected readonly changingAdminMode = signal(false);
  protected readonly impersonationUsers = signal<{ id: number; nickname: string }[] | null>(null);
  protected readonly impersonationBusy = signal(false);
  protected readonly impersonationError = signal('');
  protected async openImpersonation(): Promise<void> {
    this.impersonationBusy.set(true);
    this.impersonationError.set('');
    try {
      const response = await fetch('/api/auth/impersonation', { credentials: 'same-origin' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      this.impersonationUsers.set(data.users);
    } catch {
      this.impersonationError.set('Impossibile caricare gli account. Riprova.');
    } finally {
      this.impersonationBusy.set(false);
    }
  }
  protected async impersonate(id: number): Promise<void> {
    this.impersonationBusy.set(true);
    if (await this.authService.setImpersonation(id)) {
      window.location.reload();
      return;
    }
    this.impersonationBusy.set(false);
    this.impersonationError.set('Impossibile attivare l’impersonazione.');
  }

  protected readonly authService = inject(AuthService);

  protected userName(): string | null {
    return this.authService.currentUser()?.nickname ?? null;
  }

  protected async toggleAdminMode(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const enabled = input.checked;
    const previous = this.authService.adminModeEnabled();
    this.authService.adminModeEnabled.set(enabled);
    this.changingAdminMode.set(true);
    const saved = await this.authService.setAdminMode(enabled);
    if (!saved) {
      this.authService.adminModeEnabled.set(previous);
      input.checked = previous;
    }
    this.changingAdminMode.set(false);
  }

  protected async onLogoutClick(): Promise<void> {
    this.loggingOut.set(true);
    if (this.beforeLogout) await this.beforeLogout();
    const response = await this.authService.revokeAuthSession();
    if (response.ok) {
      this.authService.clearAccessUnlock();
      this.authService.currentUser.set(null);
      this.navigationService.clearRequestedDestination();
      await this.router.navigateByUrl('/login');
      return;
    }
    this.loggingOut.set(false);
  }
}
