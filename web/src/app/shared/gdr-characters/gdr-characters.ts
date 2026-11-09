import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  GdrWorkspaceService,
  InventoryItem,
  WorkspaceCharacter,
  CharacterProfile,
} from '../../core/gdr-workspace.service';
import {
  PROFILE_FIELDS,
  emptyProfile,
  parseCharacterBundle,
  exportCharacter,
  prepareCharacterImage,
  cropCharacterPortrait,
  portraitCropRect,
} from './character-profile';
import { GdrTurn } from '../gdr-turn/gdr-turn';
import { GdrImageLibrary, GdrLibraryImage } from './gdr-image-library';
import { gdrImagePath } from './gdr-image-catalog';

@Component({
  selector: 'app-gdr-characters',
  standalone: true,
  imports: [FormsModule, GdrTurn, GdrImageLibrary],
  templateUrl: './gdr-characters.html',
  styleUrl: './gdr-characters.css',
})
export class GdrCharacters {
  protected readonly workspace = inject(GdrWorkspaceService);
  readonly inventoryOnly = input(false);
  readonly fields = input<
    { key: string; label: string; type: string; min?: number; max?: number; long?: boolean }[]
  >([]);
  protected readonly resourceKeys = ['stressCurrent', 'spellSlotsCurrent'];
  protected readonly resources = computed(() =>
    this.extraFields().filter((f) => this.resourceKeys.includes(f.key)),
  );
  protected async adjustResource(fieldKey: string, delta: number): Promise<void> {
    const c = this.workspace.active();
    if (!c || this.hasChanges()) return;
    await this.workspace.save({
      action: 'adjustResource',
      characterId: c.id,
      revision: c.revision,
      fieldKey,
      delta,
    });
  }
  protected readonly statKeys = ['statMente', 'statCuore', 'statCorpo', 'statMagia'];
  private readonly statLabels: Record<string, string> = {
    statMente: '🧠 Mente',
    statCuore: '💛 Cuore',
    statCorpo: '⚡ Corpo',
    statMagia: '✨ Magia',
  };
  protected readonly statDraft = signal<Record<string, string>>({});
  protected readonly statsDirty = signal(false);
  protected readonly statsBudget = signal(12);
  protected readonly baseStats = computed(() =>
    this.extraFields().filter((f) => this.statKeys.includes(f.key)),
  );
  protected readonly statTotal = computed(() =>
    this.baseStats().reduce((sum, f) => sum + Number(this.statDraft()[f.key] ?? 1), 0),
  );
  protected readonly validStats = computed(
    () =>
      this.baseStats().length === 4 &&
      this.baseStats().every(
        (f) =>
          Number.isInteger(Number(this.statDraft()[f.key])) &&
          Number(this.statDraft()[f.key]) >= 1 &&
          Number(this.statDraft()[f.key]) <= 5,
      ) &&
      this.statTotal() === (this.workspace.active()?.statsBudget ?? 12),
  );
  protected changeStat(key: string, value: string): void {
    this.statDraft.update((s) => ({ ...s, [key]: String(value) }));
    this.statsDirty.set(true);
  }
  protected discardStats(): void {
    const c = this.workspace.active();
    this.statDraft.set(
      Object.fromEntries(this.statKeys.map((k) => [k, c?.characterFields?.[k] ?? '1'])),
    );
    this.statsDirty.set(false);
  }
  protected async confirmStats(): Promise<void> {
    const c = this.workspace.active();
    if (!c || !this.validStats()) return;
    if (
      await this.workspace.save({
        action: 'confirmStats',
        characterId: c.id,
        revision: c.revision,
        values: this.statDraft(),
      })
    ) {
      this.statsDirty.set(false);
      const next = this.workspace.active();
      if (next) this.populate(next);
    }
  }
  protected async setStatAccess(editable: boolean): Promise<void> {
    const c = this.workspace.active();
    if (!c || !this.canManage()) return;
    await this.workspace.save({
      action: 'setStatAccess',
      characterId: c.id,
      revision: c.revision,
      editable,
      budget: Number(this.statsBudget()),
    });
  }
  protected readonly sheetFields = signal<Record<string, string>>({});
  protected readonly extraFields = computed(() =>
    this.workspace.active()?.kind === 'pg'
      ? this.fields().filter(
          (f) =>
            !/^(name|nome|surname|cognome|nome_personaggio|character_name|inventory|catName)$/i.test(f.key),
        ).map(f => this.statLabels[f.key] ? { ...f, label: this.statLabels[f.key] } : f)
      : [],
  );
  protected changeField(key: string, value: string): void {
    this.sheetFields.update((fields) => ({ ...fields, [key]: String(value) }));
    this.dirty.set(true);
  }
  readonly managementMode = input(false);
  protected readonly canManage = computed(() => this.managementMode() && this.workspace.isMaster());
  readonly legacySheet = input('');
  readonly legacyName = input('Il mio personaggio');
  readonly legacyPortrait = input('');
  readonly siteImages = input<GdrLibraryImage[]>([]);
  protected readonly libraryImages = computed<GdrLibraryImage[]>(() => [
    ...this.workspace.characters().flatMap(c => [
      { src: c.photo, label: c.name + ' · foto' },
      { src: c.portrait, label: c.name + ' · ritratto' },
    ]),
    ...this.siteImages(),
    { src: this.photo(), label: 'Foto attuale' },
    { src: this.portrait(), label: 'Ritratto attuale' },
    { src: this.legacyPortrait(), label: 'Foto dell’avventura' },
  ]);
  protected async chooseLibraryImage(image: { src: string; slot: 'photo' | 'avatar' }): Promise<void> {
    if (this.mediaBusy() || this.workspace.saving()) return;
    if (image.slot === 'photo') {
      this.photo.set(image.src);
      this.dirty.set(true);
    } else {
      await this.cropExistingImage(image.src);
    }
  }
  readonly legacyNpcs = input<{ name: string; portrait: string; description: string }[]>([]);
  protected knownHistory(profile: CharacterProfile): string { return [profile.history, profile.personality].filter(Boolean).join('\n\n'); }
  protected readonly profileFields = PROFILE_FIELDS.filter(field => !['surname', 'personality', 'goal', 'abilities'].includes(field.key));
  protected readonly playerProfileFields = computed(() =>
    PROFILE_FIELDS.filter(
      (f) =>
        f.key !== 'surname' &&
        !['abilities', 'personality', 'goal'].includes(f.key) &&
        !(
          f.key === 'appearance' && this.extraFields().some((field) => field.key === 'description')
        ),
    ),
  );
  protected readonly numericFields = computed(() =>
    this.extraFields().filter(
      (f) =>
        f.type === 'number' && !this.statKeys.includes(f.key) && !this.resourceKeys.includes(f.key),
    ),
  );
  protected readonly textFields = computed(() =>
    this.extraFields().filter((f) => f.type !== 'number'),
  );

  protected readonly profile = signal<CharacterProfile>(emptyProfile());
  protected readonly photo = signal('');
  protected readonly cropSource = signal('');
  protected readonly cropZoom = signal(1);
  protected readonly cropX = signal(0.5);
  protected readonly cropY = signal(0.5);
  protected readonly cropWidth = signal(1);
  protected readonly cropHeight = signal(1);
  protected readonly cropError = signal('');
  private readonly cropDialog = viewChild<ElementRef<HTMLDialogElement>>('portraitDialog');
  private readonly destroyRef = inject(DestroyRef);
  private cropBlob: Blob | null = null;
  private cropSlot: 'photo' | 'avatar' = 'photo';
  private drag: { x: number; y: number; startX: number; startY: number } | null = null;
  protected readonly cropPreview = computed(() => {
    const r = portraitCropRect(
        this.cropWidth(),
        this.cropHeight(),
        this.cropZoom(),
        this.cropX(),
        this.cropY(),
      ),
      scale = 240 / r.size;
    return {
      width: this.cropWidth() * scale,
      height: this.cropHeight() * scale,
      left: -r.x * scale,
      top: -r.y * scale,
    };
  });
  protected cancelCrop(): void {
    if (this.mediaBusy()) return;
    if (this.cropSource()) URL.revokeObjectURL(this.cropSource());
    this.cropSource.set('');
    this.cropBlob = null;
    this.cropError.set('');
    this.drag = null;
  }
  private async openCrop(blob: Blob, slot: 'photo' | 'avatar'): Promise<void> {
    const prepared = await prepareCharacterImage(blob, false);
    const bitmap = await createImageBitmap(prepared);
    this.cropWidth.set(bitmap.width);
    this.cropHeight.set(bitmap.height);
    bitmap.close();
    this.cropBlob = prepared;
    this.cropSlot = slot;
    this.cropZoom.set(1);
    this.cropX.set(0.5);
    this.cropY.set(0.5);
    this.cropError.set('');
    if (this.cropSource()) URL.revokeObjectURL(this.cropSource());
    this.cropSource.set(URL.createObjectURL(prepared));
  }
  protected startCropDrag(event: PointerEvent): void {
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.drag = { x: event.clientX, y: event.clientY, startX: this.cropX(), startY: this.cropY() };
  }
  protected moveCropDrag(event: PointerEvent): void {
    if (!this.drag) return;
    const side = Math.min(this.cropWidth(), this.cropHeight()) / this.cropZoom(),
      scale = 240 / side;
    this.cropX.set(
      Math.max(
        0,
        Math.min(
          1,
          this.drag.startX -
            (event.clientX - this.drag.x) / scale / Math.max(1, this.cropWidth() - side),
        ),
      ),
    );
    this.cropY.set(
      Math.max(
        0,
        Math.min(
          1,
          this.drag.startY -
            (event.clientY - this.drag.y) / scale / Math.max(1, this.cropHeight() - side),
        ),
      ),
    );
  }
  protected endCropDrag(): void {
    this.drag = null;
  }
  protected async confirmCrop(): Promise<void> {
    const c = this.workspace.active();
    if (!c || !this.cropBlob || this.mediaBusy()) return;
    this.mediaBusy.set(true);
    this.cropError.set('');
    try {
      const avatar = await cropCharacterPortrait(
        this.cropBlob,
        this.cropZoom(),
        this.cropX(),
        this.cropY(),
      );
      const photo =
        this.cropSlot === 'photo'
          ? await this.workspace.upload(c.id, 'photo', this.cropBlob)
          : this.photo();
      const portrait = await this.workspace.upload(c.id, 'avatar', avatar);
      this.photo.set(photo);
      this.portrait.set(portrait);
      this.dirty.set(true);
      this.mediaBusy.set(false);
      this.cancelCrop();
    } catch (error) {
      this.cropError.set(error instanceof Error ? error.message : 'Caricamento non riuscito.');
    } finally {
      this.mediaBusy.set(false);
    }
  }
  protected readonly mediaBusy = signal(false);
  protected readonly filter = signal<'all' | 'pg' | 'png' | 'pet'>('all');
  protected readonly search = signal('');
  protected readonly statusFilter = signal<'active' | 'archived' | 'all'>('active');
  protected readonly section = signal<'sheet' | 'assignments' | 'inventory' | 'manage'>('sheet');
  protected readonly grantDirty = signal(false);
  protected readonly deleteOpen = signal(false);
  protected readonly deleteName = signal('');
  protected readonly hasChanges = computed(
    () => this.dirty() || this.grantDirty() || this.statsDirty(),
  );
  protected readonly assignments = computed(() => {
    const id = this.workspace.active()?.id;
    return this.workspace
      .grants()
      .filter((g) => g.characterId === id && (g.canSpeak || g.canEditSheet || g.canInventory))
      .map((g) => ({
        ...g,
        nickname: this.workspace.users().find((u) => u.id === g.userId)?.nickname ?? 'Giocatore',
        permissions: [
          g.canSpeak ? 'Interpreta' : '',
          g.canEditSheet ? 'Modifica scheda' : '',
          g.canInventory ? 'Gestisce zaino' : '',
        ].filter(Boolean),
      }));
  });
  protected readonly activeCount = computed(
    () => this.workspace.characters().filter((c) => !c.archived).length,
  );
  protected assignmentLabel(id: string): string {
    const character = this.workspace.characters().find(c => c.id === id);
    if (character?.isPet) {
      const owner = this.workspace.characters().find(c => c.id === character.petOwnerId);
      return owner ? 'Pet di ' + [owner.name, owner.profile?.surname].filter(Boolean).join(' ') : 'Pet non assegnato';
    }
    const names = this.workspace
      .grants()
      .filter((g) => g.characterId === id && (g.canSpeak || g.canEditSheet || g.canInventory))
      .map((g) => this.workspace.users().find((u) => u.id === g.userId)?.nickname ?? 'Giocatore');
    return names.length ? 'Assegnato a ' + names.join(', ') : 'Non assegnato';
  }
  protected setSection(value: 'sheet' | 'assignments' | 'inventory' | 'manage'): void {
    if (this.hasChanges() || this.mediaBusy() || !!this.cropSource()) return;
    this.section.set(value);
    this.deleteOpen.set(false);
    this.deleteName.set('');
    this.localError.set('');
  }

  protected readonly createOpen = signal(false);
  protected readonly importPreview = signal<ReturnType<typeof parseCharacterBundle> | null>(null);
  protected readonly roster = computed(() =>
    this.workspace
      .characters()
      .filter(
        (c) =>
          (this.filter() === 'all' || c.kind === this.filter() || (this.filter() === 'pet' && c.isPet)) &&
          (this.statusFilter() === 'all' || (this.statusFilter() === 'archived') === c.archived) &&
          (c.name + ' ' + (c.profile?.surname ?? '') + ' ' + this.assignmentLabel(c.id))
            .toLocaleLowerCase('it')
            .includes(this.search().toLocaleLowerCase('it')),
      ),
  );
  protected readonly isPet = signal(false);
  protected readonly petOwnerId = signal('');
  protected readonly petOwners = computed(() => this.workspace.characters().filter(c => c.kind === 'pg'));
  protected readonly assignedPets = computed(() => this.workspace.pets().filter(p => p.ownerCharacterId === this.workspace.active()?.id));
  protected changePet(value: boolean): void {
    this.isPet.set(value);
    if (!value) this.petOwnerId.set('');
    this.dirty.set(true);
  }
  protected openPet(id: string): void {
    if (!this.canManage() || this.hasChanges()) return;
    this.choose(id);
    this.section.set('sheet');
  }
  protected readonly name = signal('');
  protected readonly portrait = signal('');
  protected readonly sheet = signal('');
  protected readonly items = signal<InventoryItem[]>([]);
  protected readonly newKind = signal<'pg' | 'png'>('pg');
  protected readonly newName = signal('');
  protected readonly userId = signal(0);
  protected readonly speak = signal(true);
  protected readonly editSheet = signal(false);
  protected readonly editInventory = signal(false);
  protected readonly editing = signal(false);
  protected readonly dirty = signal(false);
  protected readonly localError = signal('');
  private editingRevision = 0;
  private currentId = '';
  private createId = crypto.randomUUID();
  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.cropSource()) URL.revokeObjectURL(this.cropSource());
    });
    effect(() => {
      const dialog = this.cropDialog()?.nativeElement;
      if (this.cropSource() && dialog && !dialog.open) dialog.showModal();
    });

    effect(() =>
      this.workspace.pendingChanges.set(
        this.hasChanges() || this.mediaBusy() || !!this.cropSource(),
      ),
    );
    effect(() => {
      const c = this.workspace.active();
      if (
        c &&
        (c.id !== this.currentId || (!this.hasChanges() && c.revision !== this.editingRevision))
      ) {
        if (c.id !== this.currentId) {
          this.userId.set(0);
          this.grantDirty.set(false);
          this.deleteOpen.set(false);
          this.deleteName.set('');
        }
        this.currentId = c.id;
        this.populate(c);
      }
      if (!c) this.currentId = '';
    });
  }
  private populate(c: WorkspaceCharacter): void {
    this.isPet.set(c.isPet === true);
    this.petOwnerId.set(c.petOwnerId ?? '');
    this.profile.set({ ...emptyProfile(), ...c.profile, history: [c.profile?.history, c.profile?.personality].filter(Boolean).join('\n\n'), personality: '' });
    this.photo.set(gdrImagePath(c.photo ?? '') || c.photo || '');
    this.name.set([c.name, c.profile?.surname].filter(Boolean).join(' '));
    this.portrait.set(gdrImagePath(c.portrait) || c.portrait);
    this.sheet.set(c.sheet);
    this.sheetFields.set({ ...c.characterFields });
    this.statDraft.set(
      Object.fromEntries(this.statKeys.map((k) => [k, c.characterFields?.[k] ?? '1'])),
    );
    this.statsDirty.set(false);
    this.statsBudget.set(c.statsBudget ?? 12);
    this.items.set(structuredClone(c.inventory));
    this.editingRevision = c.revision;
    this.dirty.set(false);
    this.editing.set(false);
  }
  protected choose(id: string): void {
    if (this.hasChanges() || this.mediaBusy() || !!this.cropSource()) {
      this.localError.set('Salva o annulla le modifiche prima di cambiare personaggio.');
      return;
    }
    this.localError.set('');
    this.workspace.activeId.set(id);
    this.userId.set(0);
    this.grantDirty.set(false);
    this.deleteOpen.set(false);
    this.deleteName.set('');
    this.editing.set(false);
  }
  protected discard(): void {
    const c = this.workspace.active();
    if (c) this.populate(c);
    this.localError.set('');
  }
  protected changeItem(
    id: string,
    key: 'name' | 'quantity' | 'notes',
    value: string | number,
  ): void {
    this.items.update((items) => items.map((i) => (i.id === id ? { ...i, [key]: value } : i)));
    this.dirty.set(true);
  }
  protected addItem(): void {
    this.items.update((items) => [
      ...items,
      { id: crypto.randomUUID(), name: '', quantity: 1, notes: '' },
    ]);
    this.dirty.set(true);
  }
  protected removeItem(id: string): void {
    this.items.update((items) => items.filter((i) => i.id !== id));
    this.dirty.set(true);
  }
  protected async saveInventory(): Promise<void> {
    const c = this.workspace.active();
    if (!c) return;
    if (
      await this.workspace.save({
        action: 'inventory',
        characterId: c.id,
        revision: this.editingRevision,
        items: this.items(),
      })
    ) {
      const next = this.workspace.active();
      if (next) this.populate(next);
    }
  }
  protected async saveSheet(): Promise<void> {
    const c = this.workspace.active();
    if (!c) return;
    if (
      await this.workspace.save({
        action: 'saveCharacter',
        characterId: c.id,
        revision: this.editingRevision,
        name: this.name(),
        portrait: this.portrait(),
        photo: this.photo(),
        profile: { ...this.profile(), surname: '' },
        sheet: this.sheet(),
        characterFields: this.sheetFields(),
        ...(this.canManage() && c.kind === 'png' ? {isPet:this.isPet(), petOwnerId:this.petOwnerId() || null} : {}),
      })
    ) {
      const next = this.workspace.active();
      if (next) this.populate(next);
    }
  }
  protected async create(copy = false): Promise<void> {
    const id = this.createId;
    if (this.hasChanges() || this.mediaBusy() || !!this.cropSource()) return;
    if (
      await this.workspace.save({
        action: 'createCharacter',
        id,
        adventureId: this.workspace.selectedId(),
        kind: copy ? 'pg' : this.newKind(),
        name: copy
          ? this.legacyName()
          : this.newName().trim() || (this.newKind() === 'pg' ? 'Personaggio da completare' : ''),
        portrait: copy ? this.legacyPortrait() : '',
        sheet: copy ? this.legacySheet() : '',
      })
    ) {
      this.createId = crypto.randomUUID();
      this.workspace.activeId.set(id);
      this.newName.set('');
      this.createOpen.set(false);
      this.statusFilter.set('active');
      this.filter.set('all');
      this.search.set('');
      this.section.set(copy || this.newKind() === 'pg' ? 'assignments' : 'sheet');
      this.workspace.message.set(
        copy || this.newKind() === 'pg'
          ? 'PG creato. Scegli a chi assegnarlo.'
          : 'PNG creato. Puoi completare la scheda.',
      );
    }
  }
  protected changeProfile(key: keyof CharacterProfile, value: string): void {
    this.profile.update((p) => ({ ...p, [key]: value }));
    this.dirty.set(true);
  }
  protected async upload(event: Event, slot: 'photo' | 'avatar'): Promise<void> {
    const input = event.target as HTMLInputElement,
      file = input.files?.[0];
    input.value = '';
    if (!file || !this.workspace.active()) return;
    this.mediaBusy.set(true);
    this.localError.set('');
    try {
      await this.openCrop(file, slot);
    } catch (error) {
      this.localError.set(error instanceof Error ? error.message : 'Foto non valida.');
    } finally {
      this.mediaBusy.set(false);
    }
  }
  protected async avatarFromPhoto(): Promise<void> {
    if (!this.photo()) return;
    await this.cropExistingImage(this.photo());
  }
  private async cropExistingImage(src: string): Promise<void> {
    this.mediaBusy.set(true);
    this.localError.set('');
    try {
      const response = await fetch(src, { credentials: 'same-origin' });
      if (!response.ok) throw new Error('Foto non disponibile.');
      await this.openCrop(await response.blob(), 'avatar');
    } catch (error) {
      this.localError.set(error instanceof Error ? error.message : 'Foto non disponibile.');
    } finally {
      this.mediaBusy.set(false);
    }
  }
  protected async export(): Promise<void> {
    const c = this.workspace.active();
    if (!c) return;
    this.mediaBusy.set(true);
    this.localError.set('');
    try {
      const bundle = await exportCharacter(c);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = (c.name.replace(/[^a-zA-Z0-9_-]/g, '-') || 'personaggio') + '.personaggio.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      this.localError.set(error instanceof Error ? error.message : 'Esportazione non riuscita.');
    } finally {
      this.mediaBusy.set(false);
    }
  }
  protected async inspectImport(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.localError.set('');
    this.importPreview.set(null);
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error('Il file è troppo grande.');
      this.importPreview.set(parseCharacterBundle(await file.text()));
    } catch (error) {
      this.localError.set(error instanceof Error ? error.message : 'Importazione non valida.');
    }
  }
  protected async importCharacter(): Promise<void> {
    const bundle = this.importPreview();
    if (!bundle) return;
    const id = this.createId;
    if (
      !(await this.workspace.save({
        action: 'createCharacter',
        id,
        adventureId: this.workspace.selectedId(),
        kind: bundle.kind,
        isPet: bundle.isPet ?? false,
        name: bundle.name,
        profile: bundle.profile,
        sheet: bundle.sheet,
        items: bundle.inventory,
        characterFields: bundle.characterFields,
      }))
    )
      return;
    this.createId = crypto.randomUUID();
    this.workspace.activeId.set(id);
    this.statusFilter.set('active');
    this.filter.set('all');
    this.search.set('');
    this.section.set('sheet');
    this.importPreview.set(null);
    this.mediaBusy.set(true);
    this.localError.set('');
    try {
      const upload = async (value: string, slot: 'photo' | 'avatar') =>
        value
          ? this.workspace.upload(
              id,
              slot,
              await prepareCharacterImage(await (await fetch(value)).blob(), slot === 'avatar'),
            )
          : '';
      const photo = await upload(bundle.images.photo, 'photo');
      const portrait = await upload(bundle.images.avatar, 'avatar');
      const c = this.workspace.characters().find((c) => c.id === id)!;
      if (photo || portrait)
        await this.workspace.save({
          action: 'saveCharacter',
          characterId: id,
          revision: c.revision,
          name: c.name,
          sheet: c.sheet,
          profile: c.profile,
          photo,
          portrait,
        });
    } catch (error) {
      this.localError.set(
        'Personaggio importato, ma le immagini non sono state completate. Puoi ricaricarle dalla scheda. ' +
          (error instanceof Error ? error.message : ''),
      );
    } finally {
      this.mediaBusy.set(false);
    }
  }
  protected async copyNpc(npc: {
    name: string;
    portrait: string;
    description: string;
  }): Promise<void> {
    const id = this.createId;
    if (
      await this.workspace.save({
        action: 'createCharacter',
        id,
        adventureId: this.workspace.selectedId(),
        kind: 'png',
        name: npc.name,
        portrait: npc.portrait,
        photo: npc.portrait,
        profile: { ...emptyProfile(), appearance: npc.description },
        sheet: '',
      })
    ) {
      this.createId = crypto.randomUUID();
      this.workspace.activeId.set(id);
      this.statusFilter.set('active');
      this.filter.set('all');
      this.search.set('');
      this.section.set('sheet');
    }
  }
  protected setUser(id: number): void {
    this.userId.set(id);
    const c = this.workspace.active();
    const grant = this.workspace.grants().find((g) => g.characterId === c?.id && g.userId === id);
    this.speak.set(grant?.canSpeak ?? true);
    this.editSheet.set(grant?.canEditSheet ?? c?.kind === 'pg');
    this.editInventory.set(grant?.canInventory ?? c?.kind === 'pg');
    this.grantDirty.set(false);
  }
  protected async grant(): Promise<void> {
    const c = this.workspace.active();
    if (!c) return;
    if (
      await this.workspace.save({
        action: 'grant',
        characterId: c.id,
        revision: c.revision,
        userId: this.userId(),
        canSpeak: this.speak(),
        canEditSheet: c.kind === 'pg' && this.editSheet(),
        canInventory: this.editInventory(),
      })
    ) {
      const next = this.workspace.active();
      this.grantDirty.set(false);
      this.workspace.message.set('Assegnazione salvata.');
      if (next && !this.dirty()) this.populate(next);
    }
  }
  protected async revoke(userId: number): Promise<void> {
    const c = this.workspace.active();
    if (!c || !this.canManage() || this.hasChanges()) return;
    if (
      await this.workspace.save({
        action: 'grant',
        characterId: c.id,
        revision: c.revision,
        userId,
        canSpeak: false,
        canEditSheet: false,
        canInventory: false,
      })
    ) {
      this.userId.set(0);
      this.grantDirty.set(false);
      this.workspace.message.set('Assegnazione revocata.');
    }
  }
  protected async deleteCharacter(): Promise<void> {
    const c = this.workspace.active();
    if (!c || !this.canManage() || this.hasChanges() || this.deleteName() !== c.name) return;
    if (
      await this.workspace.save({
        action: 'deleteCharacter',
        characterId: c.id,
        revision: c.revision,
      })
    ) {
      this.deleteOpen.set(false);
      this.deleteName.set('');
      this.userId.set(0);
      this.workspace.activeId.set('');
      this.section.set('sheet');
      this.statusFilter.set(
        this.workspace.characters().length && this.workspace.characters().every((c) => c.archived)
          ? 'archived'
          : 'active',
      );
      this.filter.set('all');
      this.search.set('');
      this.workspace.message.set('Personaggio eliminato.');
    }
  }
  protected async archive(): Promise<void> {
    const c = this.workspace.active();
    if (!c) return;
    const saved = await this.workspace.save({
      action: 'archive',
      characterId: c.id,
      revision: c.revision,
      archived: !c.archived,
    });
    if (saved) {
      this.statusFilter.set(c.archived ? 'active' : 'archived');
      this.workspace.message.set(
        c.archived ? 'Personaggio riattivato.' : 'Personaggio archiviato.',
      );
    }
  }
}
