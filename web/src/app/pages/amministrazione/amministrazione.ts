import { Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AppShell } from '../../shell/app-shell';
import { AuthService } from '../../core/auth.service';
import { ApiService } from '../../core/api.service';
import { NotifyService } from '../../core/notify.service';
import { FormStatus } from '../../shared/form-status/form-status';
import { SubmissionStatus } from '../../shared/form-submission/form-submission';
import { PasswordField } from '../../shared/password-field/password-field';
import { ConfirmationDialog } from '../../shared/confirmation-dialog/confirmation-dialog';

interface TestAccount {
  id: number;
  email: string;
  nickname: string;
  identity: 'lui' | 'lei';
  is_activated: number;
  created_at: string;
}

interface ActivityLoggingUser {
  id: number;
  email: string;
  nickname: string;
  identity: 'lui' | 'lei';
  is_test: number;
  activity_logging_enabled: number;
  admin_email_updates: number;
  notify_email_updates: number;
}

@Component({
  selector: 'app-amministrazione',
  standalone: true,
  imports: [AppShell, FormsModule, RouterLink, FormStatus, PasswordField, ConfirmationDialog],
  styleUrls: ['../../../styles/pages/amministrazione.css'],
  templateUrl: './amministrazione.html'
})
export class Amministrazione {
  protected readonly authService = inject(AuthService);
  private readonly notifyService = inject(NotifyService);
  private readonly api = inject(ApiService);

  protected notifyMessage = '';
  protected notifyForce = false;
  protected readonly notifyLoading = signal(false);
  protected readonly notifyStatus = signal<SubmissionStatus>('');
  protected readonly notifyResultMessage = signal('');

  protected readonly testAccounts = signal<TestAccount[]>([]);
  protected readonly testAccountsLoading = signal(false);
  protected readonly testAccountMessage = signal('');
  protected testNickname = 'Test Rory';
  protected testEmail = '';
  protected testPassword = '';
  protected testIdentity: 'lui' | 'lei' = 'lui';
  protected readonly testActionTarget = signal<TestAccount | null>(null);
  protected readonly testAction = signal<'reset' | 'delete' | null>(null);
  protected readonly activityLoggingUsers = signal<ActivityLoggingUser[]>([]);
  protected readonly activityLoggingLoading = signal(false);
  protected readonly activityLoggingError = signal('');
  protected readonly activityLoggingMessage = signal('');
  protected readonly automaticEmailMessage = signal('');
  private testAccountsLoaded = false;
  private activityLoggingLoaded = false;

  constructor() {
    effect(() => {
      if (!this.authService.isAdmin() || !this.authService.adminModeEnabled()) {
        this.cancelTestAction();
        return;
      }
      if (!this.testAccountsLoaded) void this.loadTestAccounts();
      if (!this.activityLoggingLoaded) void this.loadActivityLoggingUsers();
    });
  }

  protected async submitNotify(): Promise<void> {
    this.notifyLoading.set(true);
    this.notifyStatus.set('');
    this.notifyResultMessage.set('');

    try {
      const force = this.notifyForce;
      const sent = await this.notifyService.notifyUpdate(this.notifyMessage.trim() || undefined, force);
      this.notifyStatus.set('success');
      this.notifyResultMessage.set(
        sent
          ? force ? 'Avviso forzato e inviato.' : 'Avviso inviato.'
          : force ? 'Invio forzato non riuscito.' : "Nessuna email inviata: l'altra persona non ha attivato le notifiche."
      );
      this.notifyMessage = '';
      this.notifyForce = false;
    } catch {
      this.notifyStatus.set('error');
      this.notifyResultMessage.set("Non è stato possibile inviare l'avviso.");
    } finally {
      this.notifyLoading.set(false);
    }
  }

  protected onTestIdentityChange(identity: 'lui' | 'lei'): void {
    this.testIdentity = identity;
    this.testNickname = identity === 'lui' ? 'Test Rory' : 'Test Desy';
  }

  protected async createTestAccount(): Promise<void> {
    this.testAccountMessage.set('');
    const response = await fetch('/api/auth/test-account', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: this.testEmail, password: this.testPassword, nickname: this.testNickname, identity: this.testIdentity })
    });
    const result = await this.api.readApiResponse<{ user?: TestAccount; error?: string }>(response);
    if (!response.ok || !('user' in result) || !result.user) {
      this.testAccountMessage.set(('error' in result && result.error) || 'Non è stato possibile creare l’account test.');
      return;
    }
    this.testEmail = '';
    this.testPassword = '';
    this.testAccountMessage.set(`${result.user.nickname} creato. Puoi usarlo subito in un altro browser.`);
    await this.loadTestAccounts();
  }

  protected requestTestAction(account: TestAccount, action: 'reset' | 'delete'): void {
    this.testActionTarget.set(account);
    this.testAction.set(action);
  }

  protected cancelTestAction(): void {
    this.testActionTarget.set(null);
    this.testAction.set(null);
  }

  protected async confirmTestAction(): Promise<void> {
    const account = this.testActionTarget();
    const action = this.testAction();
    if (!account || !action) return;
    const endpoint = action === 'reset' ? `/api/auth/test-account/${account.id}/reset` : `/api/auth/test-account/${account.id}`;
    const response = await fetch(endpoint, { method: action === 'reset' ? 'POST' : 'DELETE', credentials: 'same-origin' });
    const result = await this.api.readApiResponse<{ error?: string; deletedMedia?: number }>(response);
    this.cancelTestAction();
    if (!response.ok) {
      this.testAccountMessage.set(('error' in result && result.error) || 'Operazione non riuscita.');
      return;
    }
    this.testAccountMessage.set(action === 'reset'
      ? `${account.nickname} ripulito: account e credenziali sono rimasti attivi.`
      : `${account.nickname} eliminato definitivamente.`);
    await this.loadTestAccounts();
  }

  protected async setActivityLogging(user: ActivityLoggingUser, input: HTMLInputElement): Promise<void> {
    const enabled = input.checked;
    input.disabled = true;
    this.activityLoggingMessage.set('');
    try {
      const response = await fetch('/api/auth/activity-logging', {
        method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, enabled })
      });
      if (!response.ok) throw new Error('Aggiornamento non riuscito');
      this.activityLoggingUsers.update((users) => users.map((item) => item.id === user.id
        ? { ...item, activity_logging_enabled: enabled ? 1 : 0 }
        : item));
      this.activityLoggingMessage.set(enabled
        ? `Da ora registriamo le attività di ${user.nickname}.`
        : `Le attività di ${user.nickname} non verranno più registrate né notificate via email.`);
    } catch {
      input.checked = !enabled;
      this.activityLoggingMessage.set('Non è stato possibile aggiornare il logging.');
    } finally {
      input.disabled = false;
    }
  }

  protected async setAutomaticEmails(user: ActivityLoggingUser, input: HTMLInputElement): Promise<void> {
    const enabled = input.checked;
    input.disabled = true;
    this.automaticEmailMessage.set('');
    try {
      const response = await fetch('/api/auth/automatic-emails', {
        method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, enabled })
      });
      if (!response.ok) throw new Error('Aggiornamento non riuscito');
      this.activityLoggingUsers.update((users) => users.map((item) => item.id === user.id
        ? { ...item, admin_email_updates: enabled ? 1 : 0 } : item));
      this.automaticEmailMessage.set(enabled
        ? `Invii automatici abilitati per ${user.nickname}.`
        : `Abilitazione admin rimossa per ${user.nickname}: vale la preferenza personale.`);
    } catch {
      input.checked = !enabled;
      this.automaticEmailMessage.set('Non è stato possibile aggiornare gli invii automatici.');
    } finally {
      input.disabled = false;
    }
  }

  private async loadTestAccounts(): Promise<void> {
    this.testAccountsLoading.set(true);
    try {
      const response = await fetch('/api/auth/test-account', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      const result = await this.api.readApiResponse<{ users?: TestAccount[] }>(response);
      if (response.ok && 'users' in result) {
        this.testAccounts.set(result.users ?? []);
        this.testAccountsLoaded = true;
      } else {
        this.testAccountMessage.set('Non è stato possibile caricare gli account di collaudo.');
      }
    } catch {
      this.testAccountMessage.set('Non è stato possibile caricare gli account di collaudo.');
    } finally {
      this.testAccountsLoading.set(false);
    }
  }

  protected async loadActivityLoggingUsers(): Promise<void> {
    this.activityLoggingLoading.set(true);
    this.activityLoggingError.set('');
    try {
      const response = await fetch('/api/auth/activity-logging', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      const result = await this.api.readApiResponse<{ users?: ActivityLoggingUser[] }>(response);
      if (!response.ok || !result.users) throw new Error('Caricamento non riuscito');
      this.activityLoggingUsers.set(result.users ?? []);
      this.activityLoggingLoaded = true;
    } catch {
      this.activityLoggingError.set('Non è stato possibile caricare gli account. Riprova.');
    } finally {
      this.activityLoggingLoading.set(false);
    }
  }

}
