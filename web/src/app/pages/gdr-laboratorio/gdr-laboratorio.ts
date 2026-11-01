import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RealtimeService } from '../../core/realtime.service';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { AppShell } from '../../shell/app-shell';
import { SafeModeService } from '../../core/safe-mode.service';
import { AuthService } from '../../core/auth.service';
import { GdrBlocks } from '../../shared/gdr-blocks/gdr-blocks';
import {
  GdrBlockRow,
  GdrDocumentKey,
  GdrNpcGridData,
  GdrImageData,
} from '../../shared/gdr-blocks/gdr-block.types';
import { serializeGdrBlocks } from '../../shared/gdr-blocks/gdr-markdown.serializer';
import { GdrWorkspaceService } from '../../core/gdr-workspace.service';
import { GdrCharacters } from '../../shared/gdr-characters/gdr-characters';
import { GdrPowers } from '../../shared/gdr-characters/gdr-powers';
import { splitCharacterPowers } from '../../shared/gdr-characters/character-powers';
import { GdrNotesEditor } from '../../shared/gdr-notes/gdr-notes-editor';
import { GdrPanel } from '../../shared/gdr-panel/gdr-panel';
import { GdrTurn } from '../../shared/gdr-turn/gdr-turn';
import { parseNarrative } from '../../shared/gdr-turn/gdr-turn.parser';
import {
  GdrSourceEditor,
  NarrativeCharacter,
} from '../../shared/gdr-source-editor/gdr-source-editor';

interface Adventure {
  id: string;
  title: string;
  legacy: boolean;
  document?: GdrDocumentKey;
  rules?: GdrDocumentKey;
  character?: GdrDocumentKey;
  route: string;
  icon: string;
}
const ADVENTURES: Adventure[] = [
  {
    legacy: true,
    id: 'il-prezzo-della-verita',
    title: 'Il Prezzo della Verità',
    document: 'avventura',
    rules: 'maga-regole',
    character: 'maga-personaggio',
    route: '/tavolo-da-gioco/gdr/il-prezzo-della-verita/avventura',
    icon: '🪄',
  },
  {
    legacy: true,
    id: 'la-casa-che-trattiene-il-respiro',
    title: 'La casa che trattiene il respiro',
    document: 'casa-avventura',
    rules: 'casa-regole',
    character: 'casa-personaggio',
    route: '/tavolo-da-gioco/gdr/la-casa-che-trattiene-il-respiro',
    icon: '📜',
  },
];
interface ExistingTurn {
  id?: number;
  isMine: boolean;
  author: string;
  createdAt: string;
  body: string;
}
interface LocalTurn {
  id: string;
  author: string;
  createdAt: string;
  source: string;
}
interface LocalState {
  version: 2;
  draft: string;
  documentDraft: string | null;
  turns: LocalTurn[];
  notes: string;
}
interface Field {
  key: string;
  label: string;
  type: string;
  min?: number;
  max?: number;
  long?: boolean;
}
const emptyState = (): LocalState => ({
  version: 2,
  draft: '',
  documentDraft: null,
  turns: [],
  notes: '',
});
const dateFormatter = new Intl.DateTimeFormat('it-IT', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

@Component({
  selector: 'app-gdr-laboratorio',
  standalone: true,
  imports: [
    AppShell,
    NgTemplateOutlet,
    FormsModule,
    GdrBlocks,
    GdrTurn,
    GdrSourceEditor,
    GdrPanel,
    GdrCharacters,
    GdrPowers,
    GdrNotesEditor,
  ],
  providers: [GdrWorkspaceService],
  templateUrl: './gdr-laboratorio.html',
  styleUrls: ['../../../styles/pages/tavolo.css', './gdr-laboratorio.css'],
})
export class GdrLaboratorio implements OnInit {
  private readonly auth = inject(AuthService);
  protected readonly readingEdit = signal(false);
  protected readonly documentEdit = signal(false);
  protected readonly turnEdit = signal(false);
  protected readonly turnPreview = signal(false);
  protected readonly sendingTurn = signal(false);
  private readonly realtime = inject(RealtimeService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly inlineBusy = computed(
    () => this.readingEdit() || this.documentEdit() || this.turnEdit(),
  );
  protected inlineDocumentEditing(value: boolean): void {
    this.readingEdit.set(value);
    if (value) this.documentEditor.set(false);
  }
  protected readonly workspace = inject(GdrWorkspaceService);
  protected readonly panelTab = signal('personaggio');
  protected readonly masterCharactersOpen = signal(false);
  protected refreshCharacters():void { if(!this.workspace.pendingChanges() && !this.workspace.saving()) void this.workspace.load(this.selected()); }
  protected setMasterCharacters(open: boolean): void {
    if (
      !this.canPrepare() ||
      this.workspace.pendingChanges() ||
      this.workspace.saving() ||
      this.inlineBusy()
    )
      return;
    this.masterCharactersOpen.set(open);
    if(open) this.refreshCharacters();
  }

  protected readonly adventureTitle = signal('');
  protected readonly adventures = computed<Adventure[]>(() => [
    ...ADVENTURES,
    ...this.workspace
      .adventures()
      .filter((a) => !a.legacy)
      .map((a) => ({ id: a.id, title: a.title, legacy: false, icon: '📖', route: '' })),
  ]);
  protected readonly selected = signal<string>(ADVENTURES[0].id);
  protected readonly adventure = computed(() =>
    this.adventures().find((a) => a.id === this.selected())!,
  );
  protected readonly local = signal<LocalState>(emptyState());
  protected readonly blocks = signal<GdrBlockRow[]>([]);
  protected readonly turns = signal<ExistingTurn[]>([]);
  protected readonly loading = signal(true);
  protected readonly contentError = signal('');
  protected readonly turnsError = signal('');
  protected readonly status = signal('');
  protected readonly documentEditor = signal(false);
  protected readonly showOriginal = signal(false);
  protected readonly fields = signal<Field[]>([]);
  protected readonly values = signal<Record<string, string>>({});
  protected readonly toolsError = signal('');
  protected readonly toolsLoading = signal(false);
  private readonly safe = inject(SafeModeService);
  protected readonly canPrepare = computed(
    () => !this.safe.enabled() && this.auth.isAdmin() && !this.auth.currentUser()?.isTest,
  );
  protected readonly narrativeBlocks = computed(() => this.forDocument(this.adventure().document).map(block => {
    if(block.type!=='npc_grid') return block;
    const data=block.data as GdrNpcGridData;
    return {...block,data:{...data,entries:data.entries.flatMap((entry,index)=>{
      const current=this.workspace.storyCharacters().find(c=>c.sourceKey===`npc:${block.id}:${index}`);
      return current?.deleted ? [] : [{...entry,...(current ? {name:current.name,image:current.portrait,description:current.description}: {})}];
    })}};
  }));
  protected readonly rulesSearch = signal('');
  protected readonly filteredRules = computed(() => {
    const query = this.rulesSearch().trim().toLocaleLowerCase('it');
    return query
      ? this.rulesBlocks().filter((b) =>
          JSON.stringify(b.data).toLocaleLowerCase('it').includes(query),
        )
      : this.rulesBlocks();
  });
  protected readonly referenceBlocks = computed(() => splitCharacterPowers(this.forDocument(this.adventure().rules)));
  protected readonly rulesBlocks = computed(() => this.referenceBlocks().rules);
  protected readonly powersBlocks = computed(() => this.referenceBlocks().powers);
  protected readonly characterBlocks = computed(() => this.forDocument(this.adventure().character));
  protected readonly documentSource = computed(
    () =>
      this.local().documentDraft ??
      (this.adventure().legacy
        ? serializeGdrBlocks(this.narrativeBlocks())
        : (this.workspace.adventures().find((a) => a.id === this.selected())?.source ?? '')),
  );
  protected readonly invalidTurn = computed(
    () => !this.local().draft.trim() || parseNarrative(this.local().draft).errors.length > 0,
  );
  protected readonly legacyName = computed(() => {
    const field = this.fields().find(
      (f) =>
        /^(nome|name|nome_personaggio|character_name)$/i.test(f.key) ||
        /^nome(?: del personaggio)?$/i.test(f.label),
    );
    return (field && this.values()[field.key]) || 'Il mio personaggio';
  });
  protected readonly legacyPortrait = computed(() => {
    const image = this.characterBlocks().find((b) => b.type === 'image');
    return image ? (image.data as GdrImageData).src : '';
  });
  protected readonly legacyNpcs = computed(() =>
    this.narrativeBlocks()
      .filter((b) => b.type === 'npc_grid')
      .flatMap((b) =>
        (b.data as GdrNpcGridData).entries.map((e) => ({
          name: e.name,
          portrait: e.image,
          description: e.description,
        })),
      ),
  );
  protected readonly legacySheet = computed(() =>
    this.fields()
      .map((f) => `${f.label}: ${this.values()[f.key] ?? ''}`)
      .join('\n\n'),
  );
  protected readonly characters = computed<NarrativeCharacter[]>(() => this.workspace.available() ? this.workspace.voices().map(c=>({id:c.id,name:c.name + (c.profile?.surname ? ' '+c.profile.surname : ''),portrait:c.portrait,kind:c.kind})) : []);
  private readonly route = inject(ActivatedRoute);
  private requestVersion = 0;
  private turnsRequestVersion = 0;
  protected readonly liveGame = this.route.snapshot.paramMap.has('adventureId');
  async ngOnInit(): Promise<void> {
    const requested = this.route.snapshot.paramMap.get('adventureId');
    if (requested && !ADVENTURES.some((a) => a.id === requested)) {
      await this.workspace.load(requested);
    }
    this.realtime.on('gdr-turns:changed').pipe(takeUntilDestroyed(this.destroyRef)).subscribe(event => {
      if (this.liveGame && event['adventure'] === this.selected()) void this.loadTurns(this.selected());
    });
    await this.select(
      this.adventures().some((a) => a.id === requested) ? requested! : this.selected(),
    );
  }
  private forDocument(key: GdrDocumentKey | undefined): GdrBlockRow[] {
    return this.blocks()
      .filter((b) => b.documentKey === key)
      .sort((a, b) => a.position - b.position);
  }
  private get storageKey(): string {
    return `gdr-laboratorio-v2-${this.auth.currentUser()?.id ?? 'local'}-${this.selected()}`;
  }
  private restore(): LocalState {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) {
        const s = JSON.parse(raw);
        if (
          s.version === 2 &&
          typeof s.draft === 'string' &&
          (s.documentDraft === null || typeof s.documentDraft === 'string') &&
          typeof s.notes === 'string' &&
          Array.isArray(s.turns) &&
          s.turns.every(
            (t: LocalTurn) =>
              t &&
              ['id', 'author', 'createdAt', 'source'].every(
                (k) => typeof (t as unknown as Record<string, unknown>)[k] === 'string',
              ),
          )
        )
          return s;
      }
    } catch {
      this.status.set(
        'La prova salvata non è leggibile. I contenuti originali non sono coinvolti.',
      );
    }
    return emptyState();
  }
  private persist(): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.local()));
      this.status.set('Bozza salvata solo in questo browser.');
    } catch {
      this.status.set(
        'Impossibile salvare nel browser. Copia il testo prima di chiudere la pagina.',
      );
    }
  }
  protected updateNotes(value: string): void {
    this.local.update((s) => ({ ...s, notes: value }));
    this.persist();
  }
  protected updateDraft(value: string): void {
    this.local.update((s) => ({ ...s, draft: value }));
    this.persist();
  }
  protected updateDocument(value: string): void {
    this.local.update((s) => ({ ...s, documentDraft: value }));
    this.showOriginal.set(false);
    this.persist();
  }
  private async read<T>(url: string): Promise<T> {
    const response = await fetch(url, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(String(response.status));
    return response.json() as Promise<T>;
  }
  protected async select(id: string): Promise<void> {
    if (
      !this.adventures().some((a) => a.id === id) ||
      this.workspace.pendingChanges() ||
      this.workspace.saving() ||
      this.inlineBusy() || this.sendingTurn()
    )
      return;
    const version = ++this.requestVersion;
    this.selected.set(id);
    this.adventureTitle.set(this.adventure().title);
    this.status.set('');
    this.local.set(this.restore());
    this.documentEditor.set(false);
    this.showOriginal.set(false);
    this.rulesSearch.set('');
    this.loading.set(true);
    this.contentError.set('');
    this.turnsError.set('');
    this.toolsError.set('');
    this.toolsLoading.set(true);
    this.blocks.set([]);
    this.turns.set([]);
    this.fields.set([]);
    this.values.set({});
    const encoded = encodeURIComponent(id);
    await Promise.all([
      this.workspace.load(id),
      this.loadTurns(id),
      ...(this.adventure().legacy
        ? [
            this.read<{ blocks: GdrBlockRow[] }>('/api/gdr-blocks')
              .then((data) => {
                if (version === this.requestVersion) this.blocks.set(data.blocks ?? []);
              })
              .catch(() => {
                if (version === this.requestVersion)
                  this.contentError.set(
                    'Non è stato possibile caricare i contenuti esistenti. Riprova: non vengono sostituiti con esempi.',
                  );
              }),
            Promise.all([
              this.read<{ fields: Field[] }>(`/api/gdr/character-schema?adventure=${encoded}`),
              this.read<{ values: Record<string, string> }>(
                `/api/gdr/character-fields?adventure=${encoded}`,
              ),
            ])
              .then(([schema, values]) => {
                if (version !== this.requestVersion) return;
                this.fields.set(schema.fields ?? []);
                this.values.set(values.values ?? {});
              })
              .catch(() => {
                if (version === this.requestVersion)
                  this.toolsError.set(
                    'Scheda o appunti non disponibili. I contenuti e i turni restano consultabili.',
                  );
              })
              .finally(() => {
                if (version === this.requestVersion) this.toolsLoading.set(false);
              }),
          ]
        : []),
    ]);
    if (version === this.requestVersion) this.loading.set(false);
  }
  protected async publishAdventure(): Promise<void> {
    const a = this.workspace.adventures().find((a) => a.id === this.selected());
    if (a && !a.legacy)
      await this.workspace.save({
        action: 'publishAdventure',
        id: a.id,
        revision: a.revision,
        published: !a.published,
      });
  }
  protected async saveAdventure(): Promise<void> {
    const adventure = this.workspace.adventures().find((a) => a.id === this.selected());
    if (!adventure || adventure.legacy || parseNarrative(this.documentSource()).errors.length)
      return;
    const source = this.documentSource();
    if (
      await this.workspace.save({
        action: 'saveAdventure',
        id: adventure.id,
        revision: adventure.revision,
        title: this.adventureTitle(),
        source,
      })
    ) {
      if (this.local().documentDraft === source) {
        this.local.update((s) => ({ ...s, documentDraft: null }));
        this.persist();
      }
      this.status.set('Avventura salvata nel laboratorio.');
    }
  }
  private async loadTurns(id: string): Promise<void> {
    const version = ++this.turnsRequestVersion;
    try {
      const data = await this.read<{ turns: ExistingTurn[] }>(`/api/gdr/turns?adventure=${encodeURIComponent(id)}`);
      if (id !== this.selected() || version !== this.turnsRequestVersion) return;
      this.turns.set(data.turns ?? []);
      this.turnsError.set('');
    } catch {
      if (id === this.selected() && version === this.turnsRequestVersion)
        this.turnsError.set('Non è stato possibile aggiornare i turni. Riprova il caricamento.');
    }
  }
  protected async publish(): Promise<void> {
    if (this.invalidTurn() || this.sendingTurn() || this.turnEdit() || !this.turnPreview()) return;
    if (!this.liveGame) {
      this.publishLocal();
      return;
    }
    const adventure = this.selected();
    const body = this.local().draft;
    this.sendingTurn.set(true);
    this.status.set('Invio del turno…');
    try {
      const form = new FormData();
      form.set('adventure', adventure);
      form.set('body', body);
      const response = await fetch('/api/gdr/turns', {
        method: 'POST', credentials: 'same-origin', body: form,
      });
      const result = await response.json();
      if (!response.ok || !result.saved) throw new Error(result.error || 'Non è stato possibile inviare il turno.');
      // Mostra subito il turno confermato, anche se la rilettura successiva fallisce.
      if (adventure === this.selected()) {
        if (!this.turns().some(t => t.id === result.turnId)) this.turns.update(turns => [...turns, {
          id: result.turnId, author: result.author, createdAt: result.createdAt, body: body.trim(), isMine: true,
        }]);
        if (this.local().draft === body) {
          this.local.update(state => ({...state, draft: ''}));
          this.persist();
        }
        this.status.set('Turno inviato e salvato nella partita condivisa.');
      }
      await this.loadTurns(adventure);
    } catch (error) {
      this.status.set(error instanceof Error ? error.message + ' La bozza è ancora disponibile.' : 'Invio non riuscito. La bozza è ancora disponibile.');
    } finally {
      this.sendingTurn.set(false);
    }
  }
  private publishLocal(): void {
    if (this.invalidTurn()) return;
    this.local.update((s) => ({
      ...s,
      turns: [
        ...s.turns,
        {
          id: crypto.randomUUID(),
          author: this.auth.currentUser()?.nickname ?? 'Tu',
          createdAt: new Date().toISOString(),
          source: s.draft,
        },
      ],
      draft: '',
    }));
    this.persist();
    this.status.update((message) => 'Turno aggiunto soltanto alla prova locale. ' + message);
  }
  protected editTurn(turn: LocalTurn): void {
    if (this.local().draft.trim()) {
      this.status.set(
        'La bozza contiene già del testo. Completa o svuota la bozza prima di riprendere questo turno.',
      );
      return;
    }
    this.local.update((s) => ({
      ...s,
      draft: turn.source,
      turns: s.turns.filter((t) => t.id !== turn.id),
    }));
    this.persist();
  }
  protected formatDate(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : dateFormatter.format(date);
  }
}
