import { isCharacterNarrativeKind, parseNarrative } from './gdr-turn.parser';
import { findNarrativeCharacter, NarrativeCharacter, narrativeSnippet } from './gdr-writing';
import { CorrespondenceData, correspondencePrefix, correspondenceReferenceHeader } from './gdr-correspondence';

interface VoiceHeader {
  sourceStart: number;
  sourceEnd: number;
  start: number;
  end: number;
  visible: string;
  stored: string;
  correspondence?: CorrespondenceData;
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
    if (!isCharacterNarrativeKind(section.kind) && !['lettera','messaggio'].includes(section.kind)) continue;
    const lineEnd = normalized.indexOf('\n', section.start);
    const sourceEnd = section.correspondence && section.contentStart !== undefined ? section.contentStart - 1 : lineEnd < 0 ? normalized.length : lineEnd;
    const character = findNarrativeCharacter(roster, section.characterId, section.speaker);
    const name = (character?.name ?? section.speaker).replace(/[|\r\n]/g, ' ').trim();
    let visible = `::: ${section.kind}${isCharacterNarrativeKind(section.kind) && name ? ' ' + name : ''}`;
    let correspondence = section.correspondence;
    if (correspondence && (section.kind === 'lettera' || section.kind === 'messaggio')) {
      if (sourceEnd > lineEnd) visible += normalized.slice(lineEnd,sourceEnd);
      else {
        // Aggiorna un contatto già presente nel vecchio JSON, senza generarne
        // uno nuovo quando i codici sono temporaneamente parte del corpo.
        correspondence = {...correspondence,name:section.kind === 'messaggio' && correspondence.name ? character?.name ?? correspondence.name : correspondence.name};
        visible = correspondencePrefix(section.kind,correspondence,false,true);
      }
    }
    text += normalized.slice(offset, section.start);
    headers.push({ sourceStart: section.start, sourceEnd, start: text.length, end: text.length + visible.length, visible, stored: normalized.slice(section.start, sourceEnd),...(correspondence?{correspondence}:{}) });
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
  const references = new Map<number, VoiceHeader>();
  for (const header of view.headers) {
    if (header.correspondence) {
      const referenceStart = header.start <= prefix ? header.start : header.start >= oldEnd ? header.start + delta : -1;
      if (referenceStart >= 0) references.set(referenceStart,header);
    }
    let start = header.end <= prefix ? header.start : header.start >= oldEnd ? header.start + delta : -1;
    let retained = header;
    if (start < 0 && !header.correspondence && header.start <= prefix && header.end >= oldEnd) {
      const lineEnd = next.indexOf('\n', header.start);
      const candidate = next.slice(header.start, lineEnd < 0 ? next.length : lineEnd);
      const match = /^::: (dialogo|pensiero|azione|lettera|messaggio)(?: (.*))?$/.exec(candidate);
      const oldMatch = /^::: (dialogo|pensiero|azione|lettera|messaggio)(?: (.*))?$/.exec(header.visible);
      const sameFamily = match && oldMatch && ['lettera','messaggio'].includes(match[1]) === ['lettera','messaggio'].includes(oldMatch[1]);
      if (sameFamily && (match[2] ?? '') === (oldMatch[2] ?? '')) {
        start = header.start;
        retained = {...header, visible: candidate, stored: header.stored.replace(/::: (dialogo|pensiero|azione|lettera|messaggio)/, '::: ' + match[1])};
      }
    }
    if (start >= 0 && next.slice(start, start + retained.visible.length) === retained.visible &&
        (start === 0 || next[start - 1] === '\n') && ['\n', undefined].includes(next[start + retained.visible.length])) preserved.set(start, retained);
  }
  const replacements: {start: number; end: number; header: string}[] = [];
  for (const section of parseNarrative(next + '\n:::').sections) {
    if (!isCharacterNarrativeKind(section.kind) && !['lettera','messaggio'].includes(section.kind)) continue;
    const lineEnd = next.indexOf('\n', section.start);
    const end = section.correspondence && section.contentStart !== undefined ? section.contentStart - 1 : lineEnd < 0 ? next.length : lineEnd;
    const stored = preserved.get(section.start);
    // Sostituisce solo il testo rimasto intatto: un separatore appena completato
    // può far riconoscere nuovi campi oltre l’intestazione conservata.
    if (stored) replacements.push({start: section.start, end: section.start + stored.visible.length, header: stored.stored});
    else if (section.correspondence && (section.kind === 'lettera' || section.kind === 'messaggio')) {
      const data = {...section.correspondence};
      const previous = references.get(section.start)?.correspondence;
      const explicit = next.slice(section.start,lineEnd).includes('{');
      if (previous && !explicit) {
        data.characterId = previous.characterId; data.portrait = previous.portrait;
        if (section.kind === 'lettera') {data.name=previous.name;data.time=previous.time;}
        else {
          data.signature=previous.signature;
          // Senza separatore i codici non sono ancora riconosciuti: il nome
          // temporaneamente vuoto non equivale a cambiare contatto.
          if (end > lineEnd && data.name !== previous.name) {data.characterId='';data.portrait='';}
        }
      }
      replacements.push({start:section.start,end:lineEnd < 0 ? next.length : lineEnd,header:correspondenceReferenceHeader(section.kind,data)});
    }
    else if (isCharacterNarrativeKind(section.kind) && !section.characterId) {
      const character = findNarrativeCharacter(roster, undefined, section.speaker);
      if (character?.id) replacements.push({start: section.start, end, header: narrativeSnippet(section.kind, '', character).split('\n')[0]});
    }
  }
  let result = next;
  for (const replacement of replacements.reverse()) result = result.slice(0, replacement.start) + replacement.header + result.slice(replacement.end);
  return result;
}
