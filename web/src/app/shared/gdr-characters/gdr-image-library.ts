import { Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GdrBlockRow, GdrImageData, GdrNpcGridData } from '../gdr-blocks/gdr-block.types';
import { GdrLibraryImage, gdrLibraryImages } from './gdr-image-catalog';
export type { GdrLibraryImage } from './gdr-image-catalog';

export function imagesFromGdrBlocks(blocks: GdrBlockRow[]): GdrLibraryImage[] {
  return blocks.flatMap(block => {
    if (block.type === 'image') {
      const image = block.data as GdrImageData;
      return [{ src: image.src, label: image.caption || image.alt || 'Immagine dell’avventura' }];
    }
    if (block.type === 'npc_grid')
      return (block.data as GdrNpcGridData).entries.map(npc => ({ src: npc.image, label: npc.name }));
    return [];
  });
}

@Component({
  selector: 'app-gdr-image-library',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './gdr-image-library.html',
  styleUrl: './gdr-image-library.css',
})
export class GdrImageLibrary {
  readonly images = input<GdrLibraryImage[]>([]);
  readonly photo = input('');
  readonly portrait = input('');
  readonly story = input(false);
  readonly selected = output<{ src: string; slot: 'photo' | 'avatar' }>();
  protected readonly slot = signal<'photo' | 'avatar'>('photo');
  protected readonly query = signal('');
  protected readonly available = computed(() => gdrLibraryImages(this.images()));
  protected readonly filtered = computed(() => {
    const query = this.query().trim().toLocaleLowerCase('it');
    return this.available().filter(image => image.label.toLocaleLowerCase('it').includes(query));
  });
}
