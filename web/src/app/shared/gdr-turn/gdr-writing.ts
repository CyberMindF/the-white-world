import { SNIPPETS } from '../gdr-blocks/gdr-snippets';
import { safeNarrativeImage } from './gdr-turn.parser';
import { writeCorrespondence } from './gdr-correspondence';

export interface NarrativeCharacter {
  id?: string;
  name: string;
  portrait: string;
  photo?: string;
  description?: string;
  profile?: import('../../core/gdr-workspace.service').CharacterProfile;
  sheet?: string;
  baseName?: string;
  kind?: 'pg' | 'png';
}

export function narrativeNameMatches(roster:NarrativeCharacter[],name:string):NarrativeCharacter[]{
  const normalize=(value:string)=>value.trim().replace(/\s+/g,' ').toLocaleLowerCase('it');
  const exact=roster.filter(c=>normalize(c.name)===normalize(name));
  return exact.length?exact:roster.filter(c=>c.baseName&&normalize(c.baseName)===normalize(name));
}
export function findNarrativeCharacter(roster: NarrativeCharacter[], id: string | undefined, name: string): NarrativeCharacter | undefined {
  if(id)return roster.find(c=>c.id===id);
  const matches=narrativeNameMatches(roster,name);
  return matches.length===1?matches[0]:undefined;
}

export const NARRATIVE_TEXT_FORMATS: Readonly<Record<string,string>> = {emphasis:'*',strong:'**',underline:'__'};

export function narrativeSnippet(
  type: string,
  selected: string,
  character?: NarrativeCharacter,
): string {
  const name = (character?.name || 'Il mio personaggio').replace(/[|\r\n]/g, ' ').trim();
  const portrait = character?.id ? '' : safeNarrativeImage(character?.portrait ?? '');
  if (type === 'dialogo' || type === 'pensiero')
    return `::: ${type} ${name}${portrait || character?.id ? ' | ' + portrait : ''}${character?.id ? ' | ' + character.id : ''}\n${selected || (type === 'pensiero' ? 'Scrivi qui i suoi pensieri.' : 'Scrivi qui le sue parole.')}\n:::`;
  if (type === 'lettera' || type === 'messaggio')
    return writeCorrespondence({ kind: type, body: selected || (type === 'lettera' ? 'Scrivi qui la lettera.' : 'Scrivi qui il messaggio.'), name: type === 'messaggio' ? character?.name ?? '' : '', characterId: type === 'messaggio' ? character?.id ?? '' : '', portrait: type === 'messaggio' && !character?.id ? portrait : '', signature: type === 'lettera' ? character?.name ?? '' : '', date: '', time: '' }, true);
  if (type === 'azione' || type === 'nota')
    return `::: ${type}\n${selected || (type === 'azione' ? 'Descrivi cosa fa il personaggio.' : 'Scrivi la nota fuori personaggio.')}\n:::`;
  if (type === 'heading') return `## ${selected || 'Titolo'}`;
  if (type === 'subtitle') return `### ${selected || 'Sottotitolo'}`;
  if (type === 'emphasis') return `*${selected || 'Testo in corsivo.'}*`;
  if (type === 'strong') return `**${selected || 'Testo in grassetto.'}**`;
  if (type === 'underline') return `__${selected || 'Testo sottolineato.'}__`;
  if (type === 'paragraph') return selected || 'Testo del paragrafo.';
  if (type === 'callout') return `::: callout\n${selected || 'Testo del riquadro.'}\n:::`;
  if (type === 'list' && selected) return selected.split(/\r?\n/).filter(line => line.trim()).map(line => '- ' + line).join('\n');
  if (type === 'npc_grid' || type === 'npc_full') {
    const photo = safeNarrativeImage(character?.photo ?? '');
    if (character?.kind !== 'png') return '';
    if(character.id)return `::: npc${type==='npc_full'?' full':''}\n- characterId: ${character.id}\n  name: ${name}${selected?'\n  description: '+selected.replace(/\r?\n/g,'\n    '):''}\n:::`;
    if(!photo)return '';
    const description = (selected || character.description || 'Descrizione del personaggio.').replace(/[\r\n]+/g, ' ');
    return `::: npc${type === 'npc_full' ? ' full' : ''}\n- image: ${photo}\n  alt: ${name}\n  name: ${name}\n  description: ${description}${character.id ? '\n  characterId: ' + character.id : ''}\n:::`;
  }
  return SNIPPETS[type as keyof typeof SNIPPETS] ?? '';
}

/** Sostituisce la selezione riusando i separatori esistenti, senza righe vuote ai bordi. */
export function replaceNarrativeSelection(source: string, start: number, end: number, content: string, inline = false): {
  source: string; start: number; end: number;
} {
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const separator = (left: string, right: string): string => {
    if (inline) return '';
    if (!left || !right) return '';
    const ending = left.replace(/\r\n?/g, '\n').match(/\n*$/)![0].length;
    const starting = right.replace(/\r\n?/g, '\n').match(/^\n*/)![0].length;
    return newline.repeat(Math.max(0, 2 - ending - starting));
  };
  const before = source.slice(0, start), after = source.slice(end);
  const prefix = separator(before, content), suffix = separator(content, after);
  const insertedStart = before.length + prefix.length;
  return {
    source: before + prefix + content + suffix + after,
    start: insertedStart,
    end: insertedStart + content.length,
  };
}

/** Aggiunge solo i separatori necessari, conservando intatto il testo già presente. */
export function insertNarrativeBlock(source: string, offset: number, content: string): string {
  return replaceNarrativeSelection(source, offset, offset, content).source;
}
