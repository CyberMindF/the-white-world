const ADVENTURE_ICONS: Record<string, string> = {
  'il-prezzo-della-verita': '🪄',
  'la-casa-che-trattiene-il-respiro': '📜',
};

export function gdrAdventureIcon(id: string): string {
  return ADVENTURE_ICONS[id] ?? '📖';
}
