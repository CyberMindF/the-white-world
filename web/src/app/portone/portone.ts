import { SafeModeToggle } from '../shared/safe-mode-toggle';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AccessMode, AuthService, AuthUser } from '../core/auth.service';
import { NavigationService } from '../core/navigation.service';
import { ContentMessage } from '../shared/content-message/content-message';
import { PasswordField } from '../shared/password-field/password-field';
import { SafeModeService } from '../core/safe-mode.service';
import { VisitsService } from '../core/visits.service';

// Porting di assets/js/shared/access-gate.js (createAccessGate) + assets/js/portone/main.js.
// Stessa logica (initialize/submit/setMode), stato esposto come signal invece che riletto dal
// DOM tramite getAccessElements(). CSS invariato (access-gate.css + pages/portone.css, stessi
// selettori) — la UI dovrebbe restare visivamente identica.
@Component({
  selector: 'app-portone',
  standalone: true,
  imports: [SafeModeToggle, FormsModule, PasswordField, ContentMessage],
  styleUrls: [
    '../../styles/components/access-gate.css',
    '../../styles/pages/portone.css'
  ],
  templateUrl: './portone.html'
})
export class Portone implements OnInit {
  protected readonly safe = inject(SafeModeService);
  private readonly authService = inject(AuthService);
  private readonly navigationService = inject(NavigationService);
  private readonly visitsService = inject(VisitsService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly mode = signal<AccessMode>('register');
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly unlocked = signal(false);
  protected readonly recoveryMode = signal<'none' | 'request' | 'confirm'>('none');
  protected readonly successMessage = signal('');

  protected email = '';
  protected password = '';
  protected nickname = '';
  protected notifyEmailUpdates = false;
  protected worldKey = '';
  protected resetToken = '';
  protected newPassword = '';
  protected confirmNewPassword = '';

  protected readonly isKeyOnly = computed(() => this.mode() === 'key');
  protected readonly isRegister = computed(() => this.mode() === 'register');

  protected readonly title = computed(() => {
    if (this.recoveryMode() === 'request') {
      return 'Ritrova la tua password';
    }
    if (this.recoveryMode() === 'confirm') {
      return 'Scegli una nuova password';
    }
    switch (this.mode()) {
      case 'key':
        return 'Ti ricordi della chiave?';
      case 'login':
        return 'Accedi al Mondo Bianco';
      default:
        return 'È la prima volta che sei qui?';
    }
  });

  protected readonly text = computed(() => {
    if (this.recoveryMode() === 'request') {
      return 'Inserisci la tua email e ti invieremo un link per rientrare.';
    }
    if (this.recoveryMode() === 'confirm') {
      return 'Il link ti permette di sostituire la password dimenticata.';
    }
    switch (this.mode()) {
      case 'key':
        return 'Inserisci la chiave per completare l’accesso.';
      case 'login':
        return 'Inserisci le credenziali per entrare.';
      default:
        return 'Crea il tuo account per entrare nel Mondo Bianco.';
    }
  });

  protected readonly submitLabel = computed(() => {
    if (this.loading()) {
      return 'Attendi…';
    }
    if (this.recoveryMode() === 'request') {
      return 'Invia il link';
    }
    if (this.recoveryMode() === 'confirm') {
      return 'Salva la nuova password';
    }
    if (this.mode() === 'key') {
      return 'Entra';
    }
    if (this.mode() === 'login') {
      return 'Accedi ed entra';
    }
    return 'Registrati ed entra';
  });

  ngOnInit(): void {
    this.safe.entryAuthenticated.set(false);
    this.safe.apply(this.safe.entryChoice() ?? true);
    const token = this.route.snapshot.queryParamMap.get('resetToken');
    if (token) {
      this.resetToken = token;
      this.recoveryMode.set('confirm');
    }
    void this.initialize();
  }

  // Registra la visita, verifica la sessione e decide quale passaggio di accesso mostrare.
  private async initialize(): Promise<void> {
    this.navigationService.rememberRequestedDestination();
    await this.visitsService.captureAnonymousVisit();

    if (this.recoveryMode() !== 'none') {
      return;
    }

    const session = await this.authService.loadAuthSession(true);
    // Finché il cookie impersona un altro utente, le preferenze d'ingresso
    // restano locali e vengono salvate dopo la conferma della chiave.
    this.safe.entryAuthenticated.set(session.authenticated && Boolean(session.user) && !session.accessImpersonationActive);
    if (session.user) {
      const choice = this.safe.entryChoice();
      if (choice === null) this.safe.apply(session.user.safeMode === true);
      else this.safe.apply(choice);
    }
    if (!session.authenticated) {
      this.mode.set(this.authService.getInitialAccessMode());
      return;
    }
    if (!session.user || !this.authService.isAccessUnlocked(session.user.id)) {
      this.mode.set('key');
      return;
    }

    this.mode.set('key');
  }

  protected setMode(mode: AccessMode): void {
    this.recoveryMode.set('none');
    this.mode.set(mode);
    this.errorMessage.set('');
    this.successMessage.set('');
  }

  protected showPasswordRecovery(): void {
    this.recoveryMode.set('request');
    this.errorMessage.set('');
    this.successMessage.set('');
  }

  protected cancelPasswordRecovery(): void {
    this.recoveryMode.set('none');
    this.mode.set('login');
    this.errorMessage.set('');
    this.successMessage.set('');
    void this.router.navigate(['/login'], { replaceUrl: true });
  }

  protected async submitPasswordRecovery(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');

    try {
      if (this.recoveryMode() === 'request') {
        const { response, result } = await this.authService.requestPasswordReset(this.email.trim());
        if (!response.ok) {
          throw new Error(result.error || 'Impossibile inviare il link.');
        }
        this.successMessage.set(result.message || 'Se l’indirizzo è registrato, riceverai un’email.');
        return;
      }

      const newPassword = this.newPassword.trim();
      const confirmNewPassword = this.confirmNewPassword.trim();
      if (newPassword !== confirmNewPassword) {
        throw new Error('Le due password non coincidono.');
      }

      const { response, result } = await this.authService.resetPassword(this.resetToken, newPassword);
      if (!response.ok) {
        throw new Error(result.error || 'Impossibile reimpostare la password.');
      }

      this.password = newPassword;
      this.recoveryMode.set('none');
      this.mode.set('login');
      this.successMessage.set(result.message || 'Password aggiornata. Ora puoi accedere.');
      await this.router.navigate(['/login'], { replaceUrl: true });
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : 'Impossibile reimpostare la password.');
    } finally {
      this.loading.set(false);
    }
  }

  // Invia i dati richiesti dalla modalità corrente e completa l'accesso quando sono validi.
  protected async submit(): Promise<void> {
    const mode = this.mode();
    const payload: Record<string, unknown> = { worldKey: this.worldKey.trim() };

    if (mode !== 'key') {
      payload['email'] = this.email.trim();
      payload['password'] = this.password.trim();
    }
    if (mode === 'register') {
      payload['nickname'] = this.nickname.trim();
      payload['notifyEmailUpdates'] = this.notifyEmailUpdates;
    }

    this.loading.set(true);
    this.errorMessage.set('');

    try {
      const { response, result } = await this.authService.submitAuthRequest(mode, payload);
      if (!response.ok) {
        if (response.status === 401 && mode === 'key') {
          this.setMode('login');
        }
        throw new Error(result.error || 'Accesso non riuscito.');
      }
      if (!result.user) {
        throw new Error('Risposta inattesa dal server.');
      }

      this.authService.rememberAccessUnlock(result.user.id, mode !== 'key');
      await this.completeAccess(result.user);
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : "Impossibile completare l'accesso.");
    } finally {
      this.loading.set(false);
    }
  }

  // Mostra l'utente sbloccato e prosegue verso la destinazione richiesta, senza reload —
  // deviazione intenzionale dall'originale (che qui faceva window.location.replace/reload):
  // qui usiamo il Router, coerente con l'obiettivo dell'intera migrazione.
  private async completeAccess(user: AuthUser): Promise<void> {
    const session = await this.authService.loadAuthSession();
    if (!session.authenticated || !session.user) throw new Error('Sessione non valida.');
    const choice = this.safe.entryChoice();
    if (choice !== null) {
      if (session.user.safeMode !== choice && !await this.safe.save(choice)) throw new Error(this.safe.error());
      this.safe.apply(choice);
      this.safe.entryChoice.set(null);
    }
    if (choice === null) this.safe.apply(session.user.safeMode === true);
    this.authService.currentUser.set(session.user);
    // Login/registrazione producono sempre una sessione nuova, quindi la Modalità admin
    // riparte spenta (vive sulla sessione, non sull'utente — vedi setAdminMode).
    this.authService.adminModeEnabled.set(false);
    this.unlocked.set(true);

    // Stesso fallback di assets/js/portone/main.js (onUnlock -> "./mondo-bianco/"): senza una
    // destinazione richiesta valida, si va all'hub, che ora vive su "/" (il Portone è "/login").
    const safeTarget = this.navigationService.consumeRequestedDestination();
    await this.router.navigateByUrl(safeTarget || '/');
  }
}
