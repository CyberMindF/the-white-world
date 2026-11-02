import { safeNarrativeImage } from '../gdr-turn/gdr-turn.parser';

export interface GdrLibraryImage { src: string; label: string; }

// Ritratti già pubblicati: disponibili anche quando non sono inseriti nel racconto aperto.
export const GDR_PORTRAITS: GdrLibraryImage[] = [
  { src: '/assets/images/gdr/il-prezzo-della-verita/valin-fajar.webp', label: 'Valin Fajar' },
  { src: '/assets/images/gdr/il-prezzo-della-verita/maerath-solven.webp', label: 'Maerath Solven' },
  { src: '/assets/images/gdr/il-prezzo-della-verita/sorenne-caldri.webp', label: 'Sorenne Caldri' },
  { src: '/assets/images/gdr/il-prezzo-della-verita/shivay-lorenne.webp', label: 'Shivay Lorenne' },
  { src: '/assets/images/gdr/il-prezzo-della-verita/lefira-marsan.webp', label: 'Lefira Marsan' },
  { src: '/assets/images/gdr/il-prezzo-della-verita/pyron-feddott.webp', label: 'Pyron Feddott' },
  { src: '/assets/images/gdr/il-prezzo-della-verita/dravon-tassyr.webp', label: 'Dravon Tassyr' },
];

export function gdrImagePath(value: string): string {
  // I contenuti precedenti usavano "assets/...". Canonicalizza prima di validare,
  // così scelta, ritaglio, dialoghi e salvataggio ricevono lo stesso percorso assoluto.
  return safeNarrativeImage(value.startsWith('assets/') ? '/' + value : value);
}

export function gdrLibraryImages(images: GdrLibraryImage[]): GdrLibraryImage[] {
  const seen = new Set<string>();
  return images.flatMap(image => {
    const src = gdrImagePath(image.src);
    if (!src || seen.has(src)) return [];
    seen.add(src);
    return [{ src, label: image.label }];
  });
}
