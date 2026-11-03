import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiService } from './api.service';

export type UserIdentity = 'lui' | 'lei';
export type UserRole = 'member' | 'admin';

export interface AuthUser {
  id: number;
  email: string;
  nickname: string;
  identity: UserIdentity;
  role: UserRole;
  isTest: boolean;
  safeMode?: boolean;
}

export interface Impersonation {
  actorId: number;
  actorNickname: string;
  readOnly: false;
}
export interface AuthSessionResponse {
  impersonation?: Impersonation | null;
  authenticated: boolean;
  user?: AuthUser;
  expiresAt?: string;
  adminModeEnabled?: boolean;
  error?: string;
}

export interface AdminModeResponse {
  adminModeEnabled?: boolean;
  error?: string;
}

export type AccessMode = 'login' | 'register' | 'key';

export interface ProfileNicknameResponse {
  user?: AuthUser;
  error?: string;
}

export interface ProfilePasswordResponse {
  success?: boolean;
  error?: string;
}

export interface PasswordResetResponse {
  success?: boolean;
  message?: string;
  error?: string;
}

const ACCESS_SESSION_KEY = 'noi-crossword-access-session-v1';
const ACCESS_SESSION_TOUCHED_AT_KEY = 'noi-crossword-access-session-touched-at-v1';
const KNOWN_ACCOUNT_STORAGE_KEY = 'noi-crossword-known-account-v1';
// Quanto resta valida la conferma della Chiave senza attività, non da quando è stata data:
// ogni interazione la rinnova (vedi touchAccessUnlock), scade solo restando inattivi.
const ACCESS_UNLOCK_IDLE_TIMEOUT_MS = 60 * 60 * 1000;

// Porting fedele di assets/js/shared/auth.js. In più: currentUser come signal, così la shell
// (saluto/logout) e la guardia di rotta possono reagire senza dover rileggere il DOM.
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiService);
  readonly currentUser = signal<AuthUser | null>(null);
  // Dura per la sessione (documentazione/cms/planning-editor-contenuti.md, Fase 2): la sorgente di verità resta
  // il backend, questo signal riflette solo l'ultima risposta nota per pilotare la UI.
  readonly adminModeEnabled = signal(false);
  readonly impersonation = signal<Impersonation | null>(null);
  readonly isAdmin = computed(() => this.currentUser()?.role === 'admin');

  // Chiede al backend se il cookie HttpOnly identifica ancora una sessione valida.
  async loadAuthSession(): Promise<AuthSessionResponse> {
    try {
      const response = await fetch('/api/auth/session', {
        method: 'GET',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        this.impersonation.set(null);
        return { authenticated: false };
      }

      const data = (await this.api.readApiResponse<AuthSessionResponse>(
        response,
      )) as AuthSessionResponse;
      this.impersonation.set(data.impersonation ?? null);
      return data;
    } catch (error) {
      console.warn('Impossibile verificare la sessione:', error);
      return { authenticated: false };
    }
  }

  // Invia registrazione, login o conferma della sola Chiave all'endpoint corretto.
  async submitAuthRequest(
    mode: AccessMode,
    payload: Record<string, unknown>,
  ): Promise<{ response: Response; result: AuthSessionResponse }> {
    const endpoint = mode === 'key' ? '/api/auth/session' : `/api/auth/${mode}`;
    const normalizedPayload = {
      ...payload,
      ...(typeof payload['email'] === 'string' ? { email: payload['email'].trim() } : {}),
      ...(typeof payload['password'] === 'string' ? { password: payload['password'].trim() } : {}),
      ...(typeof payload['worldKey'] === 'string' ? { worldKey: payload['worldKey'].trim() } : {}),
    };
    const response = await fetch(endpoint, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(normalizedPayload),
    });

    return {
      response,
      result: (await this.api.readApiResponse<AuthSessionResponse>(
        response,
      )) as AuthSessionResponse,
    };
  }

  // Aggiorna il nickname dell'utente autenticato.
  async updateNickname(
    nickname: string,
  ): Promise<{ response: Response; result: ProfileNicknameResponse }> {
    const response = await fetch('/api/auth/profile/nickname', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname }),
    });

    return {
      response,
      result: (await this.api.readApiResponse<ProfileNicknameResponse>(
        response,
      )) as ProfileNicknameResponse,
    };
  }

  // Cambia la password dell'utente autenticato, confermando quella attuale.
  async updatePassword(
    currentPassword: string,
    newPassword: string,
  ): Promise<{ response: Response; result: ProfilePasswordResponse }> {
    const response = await fetch('/api/auth/profile/password', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: currentPassword.trim(),
        newPassword: newPassword.trim(),
      }),
    });

    return {
      response,
      result: (await this.api.readApiResponse<ProfilePasswordResponse>(
        response,
      )) as ProfilePasswordResponse,
    };
  }

  async requestPasswordReset(
    email: string,
  ): Promise<{ response: Response; result: PasswordResetResponse }> {
    const response = await fetch('/api/auth/password-reset/request', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim() }),
    });

    return {
      response,
      result: (await this.api.readApiResponse<PasswordResetResponse>(
        response,
      )) as PasswordResetResponse,
    };
  }

  async resetPassword(
    token: string,
    newPassword: string,
  ): Promise<{ response: Response; result: PasswordResetResponse }> {
    const response = await fetch('/api/auth/password-reset/confirm', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, newPassword: newPassword.trim() }),
    });

    return {
      response,
      result: (await this.api.readApiResponse<PasswordResetResponse>(
        response,
      )) as PasswordResetResponse,
    };
  }

  // Accende/spegne la Modalità admin per la sessione corrente. Solo chi ha già role "admin"
  // ottiene un 200 dal backend — qui ci limitiamo a riflettere l'esito, il controllo vero
  // resta lato server.
  async setAdminMode(enabled: boolean): Promise<boolean> {
    const response = await fetch('/api/auth/admin-mode', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    const result = (await this.api.readApiResponse<AdminModeResponse>(
      response,
    )) as AdminModeResponse;
    if (!response.ok || result.adminModeEnabled === undefined) {
      return false;
    }
    this.adminModeEnabled.set(result.adminModeEnabled);
    return true;
  }

  // Revoca la sessione corrente sul backend.
  async revokeAuthSession(): Promise<Response> {
    return fetch('/api/auth/session', {
      method: 'DELETE',
      credentials: 'same-origin',
    });
  }

  async setImpersonation(userId: number | null): Promise<boolean> {
    try {
      const response = await fetch('/api/auth/impersonation', {
        method: userId === null ? 'DELETE' : 'POST',
        credentials: 'same-origin',
        ...(userId === null
          ? {}
          : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }) }),
      });
      if (response.ok) localStorage.setItem('world-impersonation-changed', String(Date.now()));
      return response.ok;
    } catch {
      return false;
    }
  }
  // Restituisce la modalità iniziale più adatta in base alla presenza di un account già usato.
  getInitialAccessMode(): 'login' | 'register' {
    return localStorage.getItem(KNOWN_ACCOUNT_STORAGE_KEY) === 'true' ? 'login' : 'register';
  }

  // Verifica se la Chiave è ancora valida per l'utente corrente: stesso utente e attività
  // recente. Usare sessionStorage da solo (scheda aperta) non basta — su mobile, o riscrivendo
  // sempre l'indirizzo nella stessa scheda, la scheda spesso non si "chiude" mai davvero,
  // quindi senza un limite di tempo la Chiave non verrebbe più richiesta (bug segnalato il
  // 09/08/2026).
  isAccessUnlocked(userId: number | string): boolean {
    userId = this.impersonation()?.actorId ?? userId;
    if (sessionStorage.getItem(ACCESS_SESSION_KEY) !== String(userId)) {
      return false;
    }
    const touchedAt = Number(sessionStorage.getItem(ACCESS_SESSION_TOUCHED_AT_KEY));
    return Number.isFinite(touchedAt) && Date.now() - touchedAt < ACCESS_UNLOCK_IDLE_TIMEOUT_MS;
  }

  // Memorizza lo sblocco della scheda e, dopo login o registrazione, la presenza dell'account.
  rememberAccessUnlock(userId: number | string, rememberAccount = false): void {
    sessionStorage.setItem(ACCESS_SESSION_KEY, String(userId));
    sessionStorage.setItem(ACCESS_SESSION_TOUCHED_AT_KEY, String(Date.now()));
    if (rememberAccount) {
      localStorage.setItem(KNOWN_ACCOUNT_STORAGE_KEY, 'true');
    }
  }

  // Rinnova la finestra di inattività senza richiedere di nuovo la Chiave: va chiamato durante
  // l'uso normale (navigazione, interazione), mai per sbloccare un utente non ancora confermato.
  touchAccessUnlock(userId: number | string): void {
    userId = this.impersonation()?.actorId ?? userId;
    if (sessionStorage.getItem(ACCESS_SESSION_KEY) === String(userId)) {
      sessionStorage.setItem(ACCESS_SESSION_TOUCHED_AT_KEY, String(Date.now()));
    }
  }

  // Rimuove soltanto lo sblocco locale della scheda, senza cancellare progresso o preferenze.
  clearAccessUnlock(): void {
    sessionStorage.removeItem(ACCESS_SESSION_KEY);
    sessionStorage.removeItem(ACCESS_SESSION_TOUCHED_AT_KEY);
  }
}
