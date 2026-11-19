import { Component, computed, inject, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GdrWorkspaceService } from '../../core/gdr-workspace.service';
import { GdrBlocks } from '../gdr-blocks/gdr-blocks';
import { GdrBlockRow, GdrHeadingData, GdrListData, referenceRows } from '../gdr-blocks/gdr-block.types';
import { GdrTurn } from '../gdr-turn/gdr-turn';
import { GdrSpellComponents } from '../gdr-spell-components';

@Component({
  selector: 'app-gdr-powers',
  standalone: true,
  imports: [FormsModule, GdrBlocks, GdrTurn, GdrSpellComponents],
  templateUrl: './gdr-powers.html',
  styleUrl: './gdr-powers.css',
})
export class GdrPowers {
  protected readonly workspace = inject(GdrWorkspaceService);
  readonly legacyBlocks = input<GdrBlockRow[]>([]);
  readonly showCharacterSelector = input(true);
  protected readonly referenceRows = referenceRows;
  protected readonly blocks = computed(() =>
    this.workspace.active()?.legacyProtagonist && this.workspace.active()?.powers === undefined ? this.legacyBlocks() : [],
  );
  protected readonly personalNotes = computed(()=> {
    const c=this.workspace.active();
    return c?.powers === undefined ? c?.profile.abilities ?? '' : '';
  });
  protected heading(block: GdrBlockRow): string {
    return (block.data as GdrHeadingData).text;
  }
  protected entries(block: GdrBlockRow): { title: string; text: string }[] {
    return (block.data as GdrListData).items.map((item) => {
      const separator = item.indexOf(':');
      return separator < 0
        ? { title: item, text: '' }
        : { title: item.slice(0, separator), text: item.slice(separator + 1).trim() };
    });
  }
}
