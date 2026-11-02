import { SNIPPETS } from '../gdr-blocks/gdr-snippets';
import { safeNarrativeImage } from './gdr-turn.parser';

export interface NarrativeCharacter {
  id?: string;
  name: string;
  portrait: string;
  photo?: string;
  description?: string;
  kind?: 'pg' | 'png';
}

export function narrativeSnippet(
  type: string,
  selected: string,
  character?: NarrativeCharacter,
): string {
  const name = (character?.name || 'Il mio personaggio').replace(/[|\r\n]/g, ' ').trim();
  const portrait = safeNarrativeImage(character?.portrait ?? '');
  if (type === 'dialogo')
    return `::: dialogo ${name}${portrait ? ' | ' + portrait : ''}\n${selected || 'Scrivi qui le sue parole.'}\n:::`;
  if (type === 'azione' || type === 'nota')
    return `::: ${type}\n${selected || (type === 'azione' ? 'Descrivi cosa fa il personaggio.' : 'Scrivi la nota fuori personaggio.')}\n:::`;
  if (type === 'heading') return `## ${selected || 'Titolo'}`;
  if (type === 'subtitle') return `### ${selected || 'Sottotitolo'}`;
  if (type === 'emphasis') return `*${selected || 'Testo in corsivo.'}*`;
  if (type === 'paragraph') return selected || 'Testo del paragrafo.';
  if (type === 'callout') return `::: callout\n${selected || 'Testo del riquadro.'}\n:::`;
  if (type === 'list' && selected) return selected.split(/\r?\n/).filter(line => line.trim()).map(line => '- ' + line).join('\n');
  if (type === 'npc_grid') {
    const photo = safeNarrativeImage(character?.photo ?? '');
    if (!photo || character?.kind !== 'png') return '';
    const description = (selected || character.description || 'Descrizione del personaggio.').replace(/[\r\n]+/g, ' ');
    return `::: npc\n- image: ${photo}\n  alt: ${name}\n  name: ${name}\n  description: ${description}\n:::`;
  }
  return SNIPPETS[type as keyof typeof SNIPPETS] ?? '';
}

/** Aggiunge solo i separatori necessari, conservando intatto il testo già presente. */
export function insertNarrativeBlock(source: string, offset: number, content: string): string {
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const join = (left: string, right: string): string => {
    if (!left || !right) return left + right;
    const ending = left.replace(/\r\n?/g, '\n').match(/\n*$/)![0].length;
    const starting = right.replace(/\r\n?/g, '\n').match(/^\n*/)![0].length;
    return left + newline.repeat(Math.max(0, 2 - ending - starting)) + right;
  };
  return join(join(source.slice(0, offset), content), source.slice(offset));
}
