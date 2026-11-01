import { Injectable, computed, signal } from '@angular/core';
export interface WorkspaceAdventure {
  id: string;
  title: string;
  source: string;
  legacy: boolean;
  published: boolean;
  revision: number;
}
export interface InventoryItem {
  id: string;
  name: string;
  quantity: number;
  notes: string;
}
export interface CharacterProfile {
  surname: string;
  appearance: string;
  personality: string;
  history: string;
  goal: string;
  abilities: string;
}
export interface WorkspaceCharacter {
  id: string;
  adventureId: string;
  kind: 'pg' | 'png';
  name: string;
  portrait: string;
  photo: string;
  profile: CharacterProfile;
  sheet: string;
  characterFields?: Record<string, string>;
  inventory: InventoryItem[];
  archived: boolean;
  revision: number;
  canSpeak: boolean;
  canEditSheet: boolean;
  canInventory: boolean;
  statsEditable?: boolean;
  statsBudget?: number;
  canEditStats?: boolean;
}
export interface CharacterGrant {
  characterId: string;
  userId: number;
  canSpeak: boolean;
  canEditSheet: boolean;
  canInventory: boolean;
}
interface WorkspaceResponse {
  adventures: WorkspaceAdventure[];
  characters: WorkspaceCharacter[];
  grants: CharacterGrant[];
  users: { id: number; nickname: string }[];
  isMaster: boolean;
  storyCharacters?: {
    sourceKey: string;
    deleted: boolean;
    name: string;
    portrait: string;
    description: string;
  }[];
}
@Injectable()
export class GdrWorkspaceService {
  readonly adventures = signal<WorkspaceAdventure[]>([]);
  readonly storyCharacters = signal<NonNullable<WorkspaceResponse['storyCharacters']>>([]);
  readonly characters = signal<WorkspaceCharacter[]>([]);
  readonly grants = signal<CharacterGrant[]>([]);
  readonly users = signal<{ id: number; nickname: string }[]>([]);
  readonly isMaster = signal(false);
  readonly available = signal(false);
  readonly saving = signal(false);
  readonly pendingChanges = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  readonly selectedId = signal('');
  readonly activeId = signal('');
  readonly active = computed(
    () =>
      this.characters().find((c) => c.id === this.activeId()) ??
      this.characters().find((c) => c.kind === 'pg' && !c.archived) ??
      this.characters().find((c) => !c.archived) ??
      this.characters()[0] ??
      null,
  );
  readonly voices = computed(() => this.characters().filter((c) => c.canSpeak && !c.archived));
  private version = 0;
  private initialized = new Set<string>();
  async load(adventureId: string): Promise<void> {
    const version = ++this.version;
    this.selectedId.set(adventureId);
    this.error.set('');
    try {
      let response = await fetch(
        '/api/gdr-workspace?adventure=' + encodeURIComponent(adventureId),
        { credentials: 'same-origin' },
      );
      let data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Gestione personaggi non disponibile.');
      if (!Array.isArray(data.adventures) || !Array.isArray(data.characters))
        throw new Error('Gestione personaggi non disponibile in questo ambiente.');
      if (
        data.isMaster &&
        data.adventures.some((a: WorkspaceAdventure) => a.id === adventureId && a.legacy) &&
        !this.initialized.has(adventureId)
      ) {
        const sync = await fetch('/api/gdr-workspace/mutate', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'syncLegacy', adventureId }),
        });
        if (!sync.ok)
          throw new Error('Non è stato possibile collegare le schede esistenti. Riprova.');
        this.initialized.add(adventureId);
        response = await fetch('/api/gdr-workspace?adventure=' + encodeURIComponent(adventureId), {
          credentials: 'same-origin',
        });
        data = await response.json();
        if (!response.ok) throw new Error('Impossibile rileggere i personaggi collegati.');
      }
      if (version !== this.version) return;
      const state = data as WorkspaceResponse;
      this.adventures.set(state.adventures ?? []);
      this.characters.set(state.characters ?? []);
      this.storyCharacters.set(state.storyCharacters ?? []);
      this.grants.set(state.grants ?? []);
      this.users.set(state.users ?? []);
      this.isMaster.set(state.isMaster === true);
      this.available.set(true);
    } catch (error) {
      if (version === this.version) {
        this.available.set(false);
        this.characters.set([]);
        this.error.set(
          error instanceof Error ? error.message : 'Impossibile caricare i personaggi.',
        );
      }
    }
  }
  async upload(characterId: string, slot: 'photo' | 'avatar', blob: Blob): Promise<string> {
    const response = await fetch(
      `/api/gdr-workspace/media?character=${encodeURIComponent(characterId)}&slot=${slot}`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'image/webp' },
        body: blob,
      },
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Caricamento immagine non riuscito.');
    return data.path;
  }
  async save(payload: Record<string, unknown>): Promise<boolean> {
    if (this.saving()) return false;
    this.saving.set(true);
    this.error.set('');
    this.message.set('Salvataggio…');
    try {
      const response = await fetch('/api/gdr-workspace/mutate', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Salvataggio non riuscito.');
      await this.load(this.selectedId());
      if (!this.available())
        throw new Error(
          'Il salvataggio è riuscito, ma non è stato possibile rileggere i dati. Ricarica prima di modificarli ancora.',
        );
      this.message.set('Modifiche salvate.');
      return true;
    } catch (error) {
      this.message.set('');
      this.error.set(error instanceof Error ? error.message : 'Salvataggio non riuscito.');
      return false;
    } finally {
      this.saving.set(false);
    }
  }
}
