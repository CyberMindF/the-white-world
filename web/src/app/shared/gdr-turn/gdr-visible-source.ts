import { parseNarrative } from './gdr-turn.parser';
import { findNarrativeCharacter, NarrativeCharacter, narrativeSnippet } from './gdr-writing';

interface VoiceHeader {
  sourceStart: number;
  sourceEnd: number;
  start: number;
  end: number;
  visible: string;
  stored: string;
}

export interface VisibleNarrativeSource {
  source: string;
  text: string;
  headers: VoiceHeader[];
}

/** La textbox mostra il nome; ID e ritratti restano nel testo salvato. */
export function visibleNarrativeSource(source: string, roster: NarrativeCharacter[] = []): VisibleNarrativeSource {
  const normalized = source.replace(/\r\n?/g, '\n');
  const headers: VoiceHeader[] = [];
  let text = '', offset = 0;
  // La chiusura di servizio riconosce anche l’ultimo blocco ancora in scrittura.
  for (const section of parseNarrative(normalized + '\n:::').sections) {
    if (section.kind !== 'dialogo' && section.kind !== 'pensiero') continue;
    const lineEnd = normalized.indexOf('\n', section.start), sourceEnd = lineEnd < 0 ? normalized.length : lineEnd;
    const character = findNarrativeCharacter(roster, section.characterId, section.speaker);
    const name = (character?.name ?? section.speaker).replace(/[|\r\n]/g, ' ').trim();
    const visible = `::: ${section.kind}${name ? ' ' + name : ''}`;
    text += normalized.slice(offset, section.start);
    headers.push({ sourceStart: section.start, sourceEnd, start: text.length, end: text.length + visible.length, visible, stored: normalized.slice(section.start, sourceEnd) });
    text += visible;
    offset = sourceEnd;
  }
  return { source, text: text + normalized.slice(offset), headers };
}

function originalOffset(source: string, normalizedOffset: number): number {
  let index = 0, count = 0;
  while (index < source.length && count < normalizedOffset) {
    if (source[index] === '\r' && source[index + 1] === '\n') index++;
    index++; count++;
  }
  return index;
}

export function storedSourceOffset(view: VisibleNarrativeSource, offset: number): number {
  let difference = 0;
  for (const header of view.headers) {
    if (offset < header.start) break;
    if (offset < header.end) return originalOffset(view.source, header.sourceStart + Math.min(offset - header.start, header.stored.length));
    difference += header.stored.length - header.visible.length;
  }
  return originalOffset(view.source, offset + difference);
}

export function visibleSourceOffset(view: VisibleNarrativeSource, offset: number): number {
  const normalized = view.source.slice(0, offset).replace(/\r\n?/g, '\n').length;
  let difference = 0;
  for (const header of view.headers) {
    if (normalized < header.sourceStart) break;
    if (normalized < header.sourceEnd) return header.start + Math.min(normalized - header.sourceStart, header.visible.length);
    difference += header.stored.length - header.visible.length;
  }
  return normalized - difference;
}

/** Conserva i riferimenti delle intestazioni rimaste intatte durante una modifica. */
export function updateVisibleNarrativeSource(view: VisibleNarrativeSource, value: string, roster: NarrativeCharacter[] = []): string {
  const next = value.replace(/\r\n?/g, '\n');
  if (view.text === next) return view.source;
  let prefix = 0, suffix = 0;
  while (prefix < view.text.length && prefix < next.length && view.text[prefix] === next[prefix]) prefix++;
  while (suffix < view.text.length - prefix && suffix < next.length - prefix && view.text.at(-1 - suffix) === next.at(-1 - suffix)) suffix++;
  const oldEnd = view.text.length - suffix, delta = next.length - view.text.length;
  const preserved = new Map<number, VoiceHeader>();
  for (const header of view.headers) {
    let start = header.end <= prefix ? header.start : header.start >= oldEnd ? header.start + delta : -1;
    let retained = header;
    if (start < 0 && header.start <= prefix && header.end >= oldEnd) {
      const lineEnd = next.indexOf('\n', header.start);
      const candidate = next.slice(header.start, lineEnd < 0 ? next.length : lineEnd);
      const match = /^::: (dialogo|pensiero) (.*)$/.exec(candidate);
      if (match && match[2] === header.visible.replace(/^::: (dialogo|pensiero) /, '')) {
        start = header.start;
        retained = {...header, visible: candidate, stored: header.stored.replace(/::: (dialogo|pensiero)/, '::: ' + match[1])};
      }
    }
    if (start >= 0 && next.slice(start, start + retained.visible.length) === retained.visible &&
        (start === 0 || next[start - 1] === '\n') && ['\n', undefined].includes(next[start + retained.visible.length])) preserved.set(start, retained);
  }
  const replacements: {start: number; end: number; header: string}[] = [];
  for (const section of parseNarrative(next + '\n:::').sections) {
    if (section.kind !== 'dialogo' && section.kind !== 'pensiero') continue;
    const lineEnd = next.indexOf('\n', section.start), end = lineEnd < 0 ? next.length : lineEnd;
    const stored = preserved.get(section.start);
    if (stored) replacements.push({start: section.start, end, header: stored.stored});
    else if (!section.characterId) {
      const character = findNarrativeCharacter(roster, undefined, section.speaker);
      if (character?.id) replacements.push({start: section.start, end, header: narrativeSnippet(section.kind, '', character).split('\n')[0]});
    }
  }
  let result = next;
  for (const replacement of replacements.reverse()) result = result.slice(0, replacement.start) + replacement.header + result.slice(replacement.end);
  return result;
}
