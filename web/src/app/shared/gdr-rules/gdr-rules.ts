import { Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GdrWorkspaceService } from '../../core/gdr-workspace.service';
import { GdrBlocks } from '../gdr-blocks/gdr-blocks';
import { GdrReferenceBlock, referenceRows } from '../gdr-blocks/gdr-block.types';
import { parseGdrMarkdown } from '../gdr-blocks/gdr-markdown.parser';
import { serializeGdrBlocks } from '../gdr-blocks/gdr-markdown.serializer';

@Component({
  selector: 'app-gdr-rules',
  standalone: true,
  imports: [FormsModule, GdrBlocks],
  templateUrl: './gdr-rules.html',
  styleUrl: './gdr-rules.css',
})
export class GdrRules {
  readonly adventureId = input.required<string>();
  readonly blocks = input<GdrReferenceBlock[]>([]);
  readonly revision = input(1);
  readonly editable = input(false);
  readonly saved = output<{ blocks: GdrReferenceBlock[]; revision: number }>();
  protected readonly workspace = inject(GdrWorkspaceService);
  protected readonly referenceRows = referenceRows;
  protected readonly editing = signal(false);
  protected readonly saving = signal(false);
  protected readonly draft = signal('');
  protected readonly error = signal('');
  protected readonly search = signal('');
  protected readonly parsed = computed(() => parseGdrMarkdown(this.draft()));
  protected readonly preview = computed(() =>
    referenceRows(this.parsed().blocks as GdrReferenceBlock[]),
  );
  protected readonly visible = computed(() =>
    referenceRows(
      this.blocks().filter((b) =>
        JSON.stringify(b.data)
          .toLocaleLowerCase('it')
          .includes(this.search().trim().toLocaleLowerCase('it')),
      ),
    ),
  );
  private editingRevision = 1;
  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.editing()) this.workspace.rulesEditing.set(false);
    });
  }
  protected begin(): void {
    if (!this.editable() || this.workspace.pendingChanges()) return;
    this.editingRevision = this.revision();
    this.draft.set(serializeGdrBlocks(referenceRows(this.blocks())));
    this.error.set('');
    this.editing.set(true);
    this.workspace.rulesEditing.set(true);
  }
  protected cancel(): void {
    if (this.saving()) return;
    this.editing.set(false);
    this.workspace.rulesEditing.set(false);
    this.error.set('');
  }
  protected async save(): Promise<void> {
    if (!this.editable() || this.saving() || !this.editing() || this.parsed().errors.length) return;
    this.saving.set(true);
    this.error.set('');
    try {
      const response = await fetch('/api/gdr-rules', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adventureId: this.adventureId(),
          revision: this.editingRevision,
          blocks: this.parsed().blocks,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Salvataggio non riuscito.');
      this.saved.emit({ blocks: data.blocks, revision: data.revision });
      this.editing.set(false);
      this.workspace.rulesEditing.set(false);
    } catch (error) {
      this.error.set(
        error instanceof Error ? error.message : 'Non è stato possibile salvare le regole.',
      );
    } finally {
      this.saving.set(false);
    }
  }
}
