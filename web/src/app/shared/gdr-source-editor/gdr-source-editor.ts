import { diagnosticAction } from '../../core/diagnostics';
import { Component, ElementRef, computed, effect, forwardRef, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AppSelect, AppSelectOption } from '../app-select/app-select';
import { updateGdrTextarea } from '../gdr-textarea';
import { GdrTurn } from '../gdr-turn/gdr-turn';
import { isCharacterNarrativeKind, parseNarrative, safeNarrativeImage } from '../gdr-turn/gdr-turn.parser';
import { BLOCK_TYPES, SNIPPET_LABELS } from '../gdr-blocks/gdr-snippets';
import { GdrImageLibrary, GdrLibraryImage } from '../gdr-characters/gdr-image-library';

import { NarrativeCharacter, NARRATIVE_TEXT_FORMATS, findNarrativeCharacter, narrativeSnippet, replaceNarrativeSelection } from '../gdr-turn/gdr-writing';
import { storedSourceOffset, updateVisibleNarrativeSource, visibleNarrativeSource, visibleSourceOffset } from '../gdr-turn/gdr-visible-source';
import { writeCorrespondence } from '../gdr-turn/gdr-correspondence';
import { readCharacterDraft, writeCharacterDraft } from '../gdr-turn/gdr-character-draft';
export type { NarrativeCharacter } from '../gdr-turn/gdr-writing';
@Component({
  selector: 'app-gdr-source-editor',
  standalone: true,
  // Il renderer ospita lo stesso editor; la sua anteprima resta in sola lettura.
  imports: [FormsModule, AppSelect, forwardRef(() => GdrTurn), GdrImageLibrary],
  templateUrl: './gdr-source-editor.html',
  styleUrl: './gdr-source-editor.css',
})
export class GdrSourceEditor {
  readonly source = input.required<string>();
  readonly sourceChange = output<string>();
  readonly editingChange = output<boolean>();
  readonly modeChange = output<'split' | 'source' | 'preview'>();
  readonly label = input('Il tuo turno');
  readonly document = input(false);
  readonly masterTools = input(false);
  readonly images = input<GdrLibraryImage[]>([]);
  readonly allowGeneric = input(true);
  readonly allowImages = input(false);
  readonly characters = input<NarrativeCharacter[]>([]);
  readonly characterRoster = input<NarrativeCharacter[]>([]);
  readonly editorId = input('gdr-source');
  readonly focusedBlock = input(false);
  protected readonly focusedCharacter = computed(() => this.focusedBlock() ? readCharacterDraft(this.source()) : null);
  protected readonly editorValue = computed(() => this.focusedCharacter()?.body ?? this.visibleSource().text);
  private focusInitialized = false;
  protected readonly mode = signal<'split' | 'source' | 'preview'>('source');
  protected readonly characterIndex = signal(0);
  protected readonly blockType = signal('dialogo');
  protected readonly contactIndex = signal(0);
  protected readonly writingTypes = [
    {type:'paragraph',label:'Testo'}, {type:'dialogo',label:'Dialogo'}, {type:'pensiero',label:'Pensiero'},
    {type:'azione',label:'Azione'}, {type:'nota',label:'Nota'}, {type:'lettera',label:'Lettera'}, {type:'messaggio',label:'Messaggio'},
  ];
  protected readonly contactCharacters = computed(() => this.characterRoster().length ? this.characterRoster() : this.characters());
  protected readonly selectionCharacters = computed(() => this.focusedCharacter()?.kind === 'npc' ? this.characters().filter(character => character.kind === 'png') : this.blockType() === 'messaggio' ? this.contactCharacters() : this.characters());
  protected readonly characterOptions = computed<AppSelectOption[]>(() => {
    const options: AppSelectOption[] = this.selectionCharacters().map((character, index) => ({
      value: String(index),
      label: character.name + (character.kind === 'pg' ? ' · PG' : character.kind === 'png' ? ' · PNG' : ''),
    }));
    if (this.blockType() === 'messaggio') options.unshift({value: '-1', label: 'Nome o numero libero'});
    else if (!options.length) options.push({value: '0', label: this.allowGeneric() ? 'Il mio personaggio' : 'Nessun personaggio disponibile'});
    const draft = this.focusedCharacter();
    if (draft && this.focusedCharacterIndex() < 0) options.unshift({value:'-1',label:draft.name});
    return options;
  });
  protected readonly blockTypeOptions = computed<AppSelectOption[]>(() => {
    const options: AppSelectOption[] = this.writingTypes.map(option => ({value: option.type, label: option.label, group: 'Scrittura'}));
    if (this.masterTools() || this.document()) {
      options.push(...this.blockTypes.filter(type => type !== 'image' || this.allowImages()).map(type => ({
        value: type, label: type === 'callout' ? 'Riquadro' : type === 'npc_grid' ? 'Scheda PNG' : this.snippetLabels[type], group: 'Storia',
      })), ...[
        {value: 'npc_full', label: 'PNG a tutta pagina'}, {value: 'subtitle', label: 'Sottotitolo'},
        {value: 'emphasis', label: 'Corsivo'}, {value: 'strong', label: 'Grassetto'}, {value: 'underline', label: 'Sottolineato'},
      ].map(option => ({...option, group: 'Storia'})));
    } else if (this.allowImages()) options.push({value: 'image', label: 'Immagine', group: 'Scrittura'});
    return options;
  });
  protected readonly focusedCharacterIndex = computed(() => {
    const draft = this.focusedCharacter();
    if (!draft) return this.characterIndex();
    const character = findNarrativeCharacter(this.selectionCharacters(), draft.characterId, draft.name);
    return character ? this.selectionCharacters().indexOf(character) : -1;
  });
  protected readonly selectedCharacter = computed(() => this.selectionCharacters()[this.focusedCharacter() ? this.focusedCharacterIndex() : this.blockType() === 'messaggio' ? this.contactIndex() : this.characterIndex()]);
  protected readonly addDisabled = computed(() => (isCharacterNarrativeKind(this.blockType()) && !this.characters().length && !this.allowGeneric()));
  protected readonly voiceMessage = signal('');
  protected readonly imagePickerOpen = signal(false);
  private readonly sourceArea = viewChild<ElementRef<HTMLTextAreaElement>>('sourceArea');
  private readonly previewPane = viewChild<ElementRef<HTMLElement>>('previewPane');
  private scrollDriver: 'source' | 'preview' = 'source';
  private readonly syncedPositions = new WeakMap<HTMLElement, number>();
  private readonly parsed = computed(() => parseNarrative(this.source()));
  protected readonly errors = computed(() => this.parsed().errors);
  protected readonly recognized = computed(() =>
    this.parsed().sections.reduce((n, s) => n + (s.kind === 'document' ? s.blocks.length : 1), 0),
  );
  protected readonly blockTypes = BLOCK_TYPES.filter(type => type !== 'paragraph');
  protected readonly snippetLabels = SNIPPET_LABELS;
  protected readonly visibleSource = computed(() => visibleNarrativeSource(this.source(), this.characterRoster().length ? this.characterRoster() : this.characters()));
  protected updateSource(value: string): void {
    const draft = this.focusedCharacter();
    if (draft) {
      this.sourceChange.emit(writeCharacterDraft({...draft,body:value},this.characterRoster().length ? this.characterRoster() : this.characters()));
      return;
    }
    this.sourceChange.emit(updateVisibleNarrativeSource(this.visibleSource(), value, this.characterRoster().length ? this.characterRoster() : this.characters()));
  }
  protected selectCharacter(index: number): void {
    const draft = this.focusedCharacter(), character = this.selectionCharacters()[index];
    if (draft) {
      if (character && (draft.kind !== 'npc' || character.kind === 'png'))
        this.sourceChange.emit(writeCharacterDraft({...draft,name:character.name,characterId:character.id,portrait:character.portrait},[character]));
      return;
    }
    if (this.blockType() === 'messaggio') this.contactIndex.set(index);
    else this.characterIndex.set(index);
  }
  protected selectBlockType(type: string): void {
    const previous = this.selectedCharacter();
    this.blockType.set(type);
    if (!previous) return;
    const index = this.selectionCharacters().findIndex(character => previous.id ? character.id === previous.id : character.name === previous.name);
    if (index >= 0) this.selectCharacter(index);
  }
  protected addBlock(area: HTMLTextAreaElement): void {
    if (this.addDisabled()) return;
    const type = this.blockType();
    let snippet: string | undefined;
    if (type === 'lettera' || type === 'messaggio') {
      const character = this.selectedCharacter();
      snippet = writeCorrespondence({ kind: type, body: area.value.slice(area.selectionStart, area.selectionEnd) || (type === 'lettera' ? 'Scrivi qui la lettera.' : 'Scrivi qui il messaggio.'),
        name: type === 'messaggio' ? character?.name ?? '' : '',
        characterId: type === 'messaggio' ? character?.id ?? '' : '',
        portrait: type === 'messaggio' && !character?.id ? safeNarrativeImage(character?.portrait ?? '') : '',
        signature: type === 'lettera' ? character?.name ?? '' : '',
        date: '', time: '',
      }, true);
    }
    this.insert(type, area, snippet);
  }

  constructor() {
    effect(() => {
      if (!this.focusedBlock() || this.focusInitialized) return;
      this.focusInitialized = true;
      const section = parseNarrative(this.source()).sections[0];
      const draft = this.focusedCharacter();
      if (section && section.kind !== 'document') this.blockType.set(section.kind);
      else if (section?.blocks.length === 1 && !draft) this.blockType.set(section.blocks[0].type);
      const character = findNarrativeCharacter(this.characters(), draft?.characterId ?? section?.characterId, draft?.name ?? (section?.speaker || section?.correspondence?.signature || ''));
      if (character) this.characterIndex.set(this.characters().indexOf(character));
      if (section?.kind === 'messaggio') {
        const contact = section.characterId ? findNarrativeCharacter(this.contactCharacters(), section.characterId, section.speaker) : undefined;
        this.contactIndex.set(contact ? this.contactCharacters().indexOf(contact) : -1);
      }
    });
    effect(() => {
      if (this.mode() === 'preview' && !this.source().trim()) this.mode.set('source');
      this.modeChange.emit(this.mode());
    });
    effect(() => {
      if (this.characterIndex() >= this.characters().length) this.characterIndex.set(0);
      if (this.contactIndex() >= this.contactCharacters().length) this.contactIndex.set(this.contactCharacters().length ? 0 : -1);
      if ((!this.masterTools() && !this.document() && !this.writingTypes.some(option => option.type === this.blockType()) && this.blockType() !== 'image') || (this.blockType() === 'image' && !this.allowImages())) this.blockType.set('dialogo');
    });
    effect(onCleanup => {
      this.source();
      if (this.mode() === 'split' && this.previewPane()) {
        const frame = requestAnimationFrame(() => this.syncScroll('source', true));
        onCleanup(() => cancelAnimationFrame(frame));
      }
    });
  }
  protected setMode(mode: 'split' | 'source' | 'preview'): void {
    diagnosticAction('gdr_editor_mode', { mode, characters: this.source().length });
    const area = this.sourceArea()?.nativeElement, preview = this.previewPane()?.nativeElement;
    if (area) this.syncedPositions.delete(area);
    if (preview) this.syncedPositions.delete(preview);
    this.scrollDriver = 'source';
    this.mode.set(mode);
  }
  protected setScrollDriver(origin: 'source' | 'preview'): void {
    this.scrollDriver = origin;
  }
  protected syncScroll(origin: 'source' | 'preview', force = false): void {
    if (this.mode() !== 'split' || (!force && origin !== this.scrollDriver)) return;
    const area = this.sourceArea()?.nativeElement, preview = this.previewPane()?.nativeElement;
    if (!area || !preview) return;
    const from = origin === 'source' ? area : preview, to = origin === 'source' ? preview : area;
    // Ignora l’evento generato dal pannello che abbiamo appena spostato: evita rimbalzi.
    const programmed = this.syncedPositions.get(from);
    if (programmed !== undefined) {
      this.syncedPositions.delete(from);
      if (!force && Math.abs(from.scrollTop - programmed) < 1) return;
    }
    const sourceRange = from.scrollHeight - from.clientHeight;
    const targetRange = to.scrollHeight - to.clientHeight;
    const top = sourceRange > 0 ? from.scrollTop / sourceRange * Math.max(0, targetRange) : 0;
    if (Math.abs(to.scrollTop - top) < 1) return;
    to.scrollTop = top;
    this.syncedPositions.set(to, to.scrollTop);
  }
  public openPreview(): void {
    if (this.source().trim()) this.setMode('preview');
  }
  public focus(): void {
    this.sourceArea()?.nativeElement.focus({preventScroll:true});
  }
  protected setFocusedNpcLayout(layout: string): void {
    if (this.focusedCharacter()?.kind !== 'npc' || !this.masterTools() || !['card','full'].includes(layout)) return;
    this.sourceChange.emit(this.source().replace(/^::: npc(?: full)?(?=\r?$)/m, layout === 'full' ? '::: npc full' : '::: npc'));
  }
  protected insertImage(src: string, area: HTMLTextAreaElement): void {
    if (!this.allowImages() || !safeNarrativeImage(src)) return;
    const label = (this.images().find(image => image.src === src)?.label || 'Immagine')
      .replace(/[\[\]\r\n"]/g, ' ');
    this.insert('image', area, `![${label}](${src})`);
    this.imagePickerOpen.set(false);
  }
  protected insert(type: string, area: HTMLTextAreaElement, customSnippet?: string): void {
    if (type === 'image' && !this.allowImages()) return;
    if ((type !== 'image' && type !== 'paragraph' && BLOCK_TYPES.includes(type as typeof BLOCK_TYPES[number])) || type === 'subtitle' || NARRATIVE_TEXT_FORMATS[type] || type === 'npc_full') {
      if (!this.document() && !this.masterTools()) return;
    }
    if (type === 'image' && !customSnippet) {
      this.imagePickerOpen.update(value => !value);
      return;
    }
    const text = this.source();
    const view = this.visibleSource();
    const start = storedSourceOffset(view, area.selectionStart ?? view.text.length);
    const end = storedSourceOffset(view, area.selectionEnd ?? area.selectionStart ?? view.text.length);
    const selected = area.value.slice(area.selectionStart, area.selectionEnd);
    const character = this.characters()[this.characterIndex()] ?? this.characters()[0];
    if (isCharacterNarrativeKind(type) && !character && !this.allowGeneric()) return;
    const snippet = customSnippet ?? narrativeSnippet(type, selected, character);
    if (!snippet) {
      if (type === 'npc_grid' || type === 'npc_full') this.voiceMessage.set('Scegli un PNG nel menu Personaggio.');
      return;
    }
    this.voiceMessage.set('');
    const formatMarker = NARRATIVE_TEXT_FORMATS[type] ?? '';
    const replacement = replaceNarrativeSelection(text, start, end, snippet, !!formatMarker);
    const fenced = ['dialogo', 'pensiero', 'lettera', 'messaggio', 'azione', 'nota', 'callout'].includes(type);
    const heading = type === 'heading' || type === 'subtitle';
    const correspondenceBody = type === 'lettera' || type === 'messaggio' ? parseNarrative(snippet).sections[0]?.contentStart : undefined;
    const contentOffset = correspondenceBody ?? (fenced ? snippet.indexOf('\n') + 1 : heading ? snippet.indexOf(' ') + 1 : formatMarker.length);
    const contentLength = fenced ? snippet.lastIndexOf('\n') - contentOffset : formatMarker ? snippet.length - formatMarker.length * 2 : snippet.length - contentOffset;
    const nextView = visibleNarrativeSource(replacement.source, this.characterRoster().length ? this.characterRoster() : this.characters());
    updateGdrTextarea(area, () => {
      this.sourceChange.emit(replacement.source);
      this.setMode(this.mode() === 'preview' ? 'source' : this.mode());
    }, visibleSourceOffset(nextView, replacement.start + contentOffset), visibleSourceOffset(nextView, replacement.start + contentOffset + contentLength));
  }
}
