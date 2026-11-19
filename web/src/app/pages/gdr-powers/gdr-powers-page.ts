import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { GdrManagementShell } from '../../shared/gdr-management/gdr-management-shell';
import { AuthService } from '../../core/auth.service';
import { SafeModeService } from '../../core/safe-mode.service';
import { GdrBlocks } from '../../shared/gdr-blocks/gdr-blocks';
import { GdrSpellComponents, SPELL_COMPONENTS } from '../../shared/gdr-spell-components';
import { GdrReferenceBlock, referenceRows } from '../../shared/gdr-blocks/gdr-block.types';
import { parseGdrMarkdown } from '../../shared/gdr-blocks/gdr-markdown.parser';
import { serializeGdrBlocks } from '../../shared/gdr-blocks/gdr-markdown.serializer';

export interface CatalogPower {
  id: string;
  kind: 'ability' | 'spell';
  name: string;
  description: string;
  components?: string;
  effects: GdrReferenceBlock[];
  revision: number | null;
  systemIds: string[];
  characterIds: string[];
}
interface CatalogSystem {
  id: string;
  name: string;
}
const empty = (): CatalogPower => ({
  id: crypto.randomUUID(),
  kind: 'ability',
  name: '',
  description: '',
  components: '',
  effects: [],
  revision: null,
  systemIds: [],
  characterIds: [],
});

@Component({
  selector: 'app-gdr-powers-page',
  standalone: true,
  imports: [FormsModule, GdrManagementShell, GdrBlocks, GdrSpellComponents],
  templateUrl: './gdr-powers-page.html',
  styleUrl: './gdr-powers-page.css',
})
export class GdrPowersPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  private readonly safe = inject(SafeModeService);
  protected readonly canManage = computed(
    () =>
      this.auth.isAdmin() &&
      this.auth.adminModeEnabled() &&
      !this.auth.currentUser()?.isTest &&
      !this.safe.enabled(),
  );
  protected readonly powers = signal<CatalogPower[]>([]);
  protected readonly systems = signal<CatalogSystem[]>([]);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly dirty = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly search = signal('');
  protected readonly systemFilter = signal(
    this.route.snapshot.queryParamMap.get('system') ?? '',
  );
  protected readonly kindFilter = signal('');
  protected readonly filtered = computed(() =>
    this.powers().filter(
      (p) =>
        (!this.systemFilter() || p.systemIds.includes(this.systemFilter())) &&
        (!this.kindFilter() || p.kind === this.kindFilter()) &&
        (p.name + ' ' + p.description)
          .toLocaleLowerCase('it')
          .includes(this.search().trim().toLocaleLowerCase('it')),
    ),
  );
  protected draft: CatalogPower = empty();
  protected effectsSource = '';
  protected readonly parseGdrMarkdown = parseGdrMarkdown;
  protected readonly referenceRows = referenceRows;
  protected readonly spellComponents = SPELL_COMPONENTS;

  canLeave(): boolean { return !this.dirty() && !this.saving(); }

  async ngOnInit(): Promise<void> {
    await this.load();
  }
  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const response = await fetch('/api/gdr-powers', { credentials: 'same-origin' }),
        data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Catalogo non disponibile.');
      this.powers.set(data.powers);
      this.systems.set(data.systems);
      const selected =
        data.powers.find((p: CatalogPower) => p.id === this.draft.id) ?? data.powers.find((p: CatalogPower) => p.id === this.route.snapshot.queryParamMap.get('power')) ?? this.filtered()[0];
      if (selected) this.edit(selected);
      else this.create();
    } catch (error) {
      this.error.set(
        error instanceof Error ? error.message : 'Non è stato possibile caricare il catalogo.',
      );
    } finally {
      this.loading.set(false);
    }
  }
  protected edit(power: CatalogPower): void {
    if (this.saving() || this.dirty()) return;
    this.draft = structuredClone(power);
    this.effectsSource = serializeGdrBlocks(referenceRows(power.effects));
    this.error.set('');
  }
  protected create(): void {
    if (this.saving() || this.dirty()) return;
    this.draft = empty();
    this.effectsSource = '';
    this.error.set('');
    this.notice.set('');
  }
  protected change(): void {
    this.dirty.set(true);
    this.notice.set('');
  }
  protected changeKind(): void {
    if(this.draft.kind!=='spell')this.draft.components='';
    this.change();
  }
  protected toggleComponent(code:string,checked:boolean): void {
    const selected=this.draft.components??'';
    this.draft.components=SPELL_COMPONENTS.filter(c=>c.code===code?checked:selected.includes(c.code)).map(c=>c.code).join('');
    this.change();
  }
  protected async cancel(): Promise<void> {
    this.dirty.set(false);
    this.notice.set('');
    await this.load();
  }
  protected async save(): Promise<void> {
    if (!this.canManage() || this.saving() || !this.dirty()) return;
    const parsed = parseGdrMarkdown(this.effectsSource);
    if (!this.draft.name.trim()) {
      this.error.set('Inserisci il nome.');
      return;
    }
    if (parsed.errors.length) {
      this.error.set(parsed.errors.map((e) => e.message).join(' '));
      return;
    }
    const creating=this.draft.revision===null;
    this.saving.set(true);
    this.error.set('');
    try {
      const { characterIds, ...voice } = this.draft;
      const response = await fetch('/api/gdr-powers', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...voice,
          name: this.draft.name.trim(),
          effects: parsed.blocks,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Salvataggio non riuscito.');
      this.dirty.set(false);
      this.saving.set(false);
      if(creating)this.systemFilter.set('');
      await this.load();
      this.notice.set(creating?'Voce salvata. Puoi includerla nei sistemi dalla sezione «Sistemi».':'Voce salvata.');
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Non è stato possibile salvare.');
    } finally {
      this.saving.set(false);
    }
  }
}
