import { Component, EventEmitter, HostListener, Input, Output, OnInit, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GdrBlocks } from '../gdr-blocks/gdr-blocks';
import { GdrDocumentEditor } from '../gdr-blocks/gdr-document-editor';
import { GdrBlockRow, GdrDocumentKey } from '../gdr-blocks/gdr-block.types';
import { GdrNotesEditor } from '../gdr-notes/gdr-notes-editor';
import { GdrDiceRoller } from '../gdr-dice-roller/gdr-dice-roller';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';

export interface GdrCharacterField {
  key: string;
  label: string;
  type: 'text' | 'number';
  min?: number;
  max?: number;
  long?: boolean;
  default?: string | number;
}

type GdrPanelTab = 'personaggio' | 'regole' | 'appunti' | 'dadi' | 'inventario';

// Pannello di gioco condiviso tra le avventure GDR: prima erano pagine separate ("La Tua
// Maga", regole, "I Tuoi Appunti"), qui diventano tab di un bottom sheet consultabile senza
// uscire dalla pagina dell'avventura. Scoped per avventura (adventure/rulesDocumentKey come
// @Input), ma la STRUTTURA della scheda (quali campi, testo o numero) non è più fissata nel
// codice come nella prima versione: arriva da gdr_character_schema, un JSON modificabile
// dall'admin da qui stesso — così una nuova avventura non richiede toccare questo componente,
// solo definire i suoi campi. I valori sono condivisi tra i due account, non più una copia
// per utente (vale anche per "Il Prezzo della Verità", dove prima ognuno aveva la propria
// scheda: da qui in poi è una sola, come voluto da Rory).
@Component({
  selector: 'app-gdr-panel',
  standalone: true,
  imports: [NgTemplateOutlet, FormsModule, GdrBlocks, GdrDocumentEditor, GdrNotesEditor, GdrDiceRoller],
  templateUrl: './gdr-panel.html',
  styleUrl: './gdr-panel.css'
})
export class GdrPanel implements OnInit {
  @Input({ required: true }) adventure!: string;
  @Input({ required: true }) rulesDocumentKey!: GdrDocumentKey;
  @Input() fieldsDocumentKey?: GdrDocumentKey;
  // Il tab "Personaggio" si chiama così di default, ma ogni avventura può avere il proprio
  // nome per il personaggio (es. "La Tua Maga" ne "Il Prezzo della Verità").
  @Input() personaggioLabel = 'Personaggio';
  @Input() personaggioIcon = '🧍';
  // Il laboratorio consulta i dati reali senza offrire scritture sulle partite.
  @Input() readOnly = false;
  @Input() workspaceMode = false;
  @Input() legacyCharacterSheet = false;
  @Input() pendingChanges = false;
  @Output() opened = new EventEmitter<void>();
  @Output() tabChange = new EventEmitter<GdrPanelTab>();
  protected readonly wide = signal(false);
  protected readonly pinned = signal(false);
  protected readonly scrollPositions: Partial<Record<GdrPanelTab, number>> = {};
  protected rememberScroll(event: Event): void { this.scrollPositions[this.activeTab()] = (event.target as HTMLElement).scrollTop; }
  @HostListener('document:keydown.escape') protected escape(): void { this.closePanel(); }

  private readonly api = inject(ApiService);
  protected readonly authService = inject(AuthService);
  protected readonly canEditSchema = computed(() => (!this.readOnly || this.legacyCharacterSheet) && this.authService.isAdmin() && this.authService.adminModeEnabled());

  protected readonly open = signal(false);
  protected readonly activeTab = signal<GdrPanelTab>('personaggio');

  protected readonly schema = signal<GdrCharacterField[]>([]);
  protected readonly fieldValues = signal<Record<string, string>>({});
  protected readonly fieldsLoading = signal(true);
  protected readonly fieldsStatus = signal('');

  protected readonly schemaEditorOpen = signal(false);
  protected readonly schemaDraft = signal('');
  protected readonly schemaError = signal('');

  private readonly rawBlocks = signal<GdrBlockRow[]>([]);
  protected readonly rulesBlocks = computed(() =>
    this.rawBlocks()
      .filter((block) => block.documentKey === this.rulesDocumentKey)
      .sort((a, b) => a.position - b.position)
  );
  protected readonly portraitBlocks = computed(() =>
    this.fieldsDocumentKey
      ? this.rawBlocks()
          .filter((block) => block.documentKey === this.fieldsDocumentKey)
          .sort((a, b) => a.position - b.position)
      : []
  );

  async ngOnInit(): Promise<void> {
    if (this.workspaceMode) {
      if (this.legacyCharacterSheet) await Promise.all([this.loadSchemaAndValues(), this.loadBlocks()]);
      try { const tab=sessionStorage.getItem('gdr-panel-tab-'+this.adventure); if (tab && ['personaggio','regole','appunti','dadi'].includes(tab)) {this.activeTab.set(tab as GdrPanelTab);queueMicrotask(()=>this.tabChange.emit(tab as GdrPanelTab));} } catch { /* Preferenze facoltative. */ }
      return;
    }
    await Promise.all([this.loadSchemaAndValues(), this.loadBlocks()]);
  }

  public openCharacters():void {if(this.pendingChanges)return;this.open.set(true);this.wide.set(true);this.setTab('personaggio');}
  protected togglePanel(): void {
    if(this.open()) { this.closePanel(); return; }
    this.open.set(true); this.opened.emit();
  }

  protected closePanel(): void {
    if(this.pendingChanges) return;
    this.open.set(false);
  }

  protected setTab(tab: GdrPanelTab): void {
    if(this.pendingChanges)return;
    this.activeTab.set(tab);
    this.tabChange.emit(tab);
    if(this.workspaceMode)try{sessionStorage.setItem('gdr-panel-tab-'+this.adventure,tab);}catch{/* Preferenze facoltative. */}
  }

  private async loadSchemaAndValues(): Promise<void> {
    this.fieldsLoading.set(true);
    try {
      const schemaResponse = await fetch(`/api/gdr/character-schema?adventure=${this.adventure}`, { credentials: 'same-origin' });
      if (!schemaResponse.ok) throw new Error(`Errore ${schemaResponse.status}`);
      const schemaResult = await this.api.readApiResponse<{ fields?: GdrCharacterField[] }>(schemaResponse);
      this.schema.set(schemaResult.fields ?? []);

      const valuesResponse = await fetch(`/api/gdr/character-fields?adventure=${this.adventure}`, { credentials: 'same-origin' });
      if (!valuesResponse.ok) throw new Error(`Errore ${valuesResponse.status}`);
      const valuesResult = await this.api.readApiResponse<{ values?: Record<string, string> }>(valuesResponse);
      this.fieldValues.set(valuesResult.values ?? {});
    } catch (error) {
      console.error('Errore nel caricamento della scheda del personaggio:', error);
    } finally {
      this.fieldsLoading.set(false);
    }
  }

  private async loadBlocks(): Promise<void> {
    try {
      const response = await fetch('/api/gdr-blocks', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`Errore ${response.status}`);
      const result = await this.api.readApiResponse<{ blocks?: GdrBlockRow[] }>(response);
      this.rawBlocks.set(result.blocks ?? []);
    } catch (error) {
      console.error('Errore nel caricamento dei contenuti della scheda:', error);
    }
  }

  protected async setField(key: string, value: string): Promise<void> {
    if (this.readOnly && !this.legacyCharacterSheet) return;
    this.fieldValues.update((values) => ({ ...values, [key]: value }));
    this.fieldsStatus.set('Sto salvando...');
    try {
      const formData = new FormData();
      formData.set('adventure', this.adventure);
      formData.set('fieldKey', key);
      formData.set('value', value);
      const response = await fetch('/api/gdr/character-fields', { method: 'POST', credentials: 'same-origin', body: formData });
      if (!response.ok) throw new Error(`Errore ${response.status}`);
      this.fieldsStatus.set('Salvato.');
    } catch (error) {
      console.error('Errore nel salvataggio del campo:', error);
      this.fieldsStatus.set('Non è stato possibile salvare, riprova.');
    }
  }

  protected onTextInput(key: string, event: Event): void {
    void this.setField(key, (event.target as HTMLInputElement | HTMLTextAreaElement).value);
  }

  protected openSchemaEditor(): void {
    this.schemaDraft.set(JSON.stringify(this.schema(), null, 2));
    this.schemaError.set('');
    this.schemaEditorOpen.set(true);
  }

  protected closeSchemaEditor(): void {
    this.schemaEditorOpen.set(false);
  }

  protected async saveSchema(): Promise<void> {
    if (this.readOnly && !this.legacyCharacterSheet) return;
    let fields: unknown;
    try {
      fields = JSON.parse(this.schemaDraft());
    } catch {
      this.schemaError.set('Il contenuto non è JSON valido.');
      return;
    }

    const ok = await this.api.sendAuthenticatedJson('/api/gdr/character-schema', { adventure: this.adventure, fields }, 'POST');
    if (!ok) {
      this.schemaError.set('Non è stato possibile salvare la struttura.');
      return;
    }

    this.schemaEditorOpen.set(false);
    await this.loadSchemaAndValues();
  }
}
