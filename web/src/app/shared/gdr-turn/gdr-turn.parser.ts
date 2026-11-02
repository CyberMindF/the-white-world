import { GdrBlockRow } from '../gdr-blocks/gdr-block.types';
import {
  GdrParseError,
  GdrSourceRange,
  gdrLineOffsets,
  parseGdrMarkdown,
} from '../gdr-blocks/gdr-markdown.parser';

export interface NarrativeSection {
  id: string;
  kind: 'document' | 'dialogo' | 'azione' | 'nota';
  text: string;
  speaker: string;
  portrait: string;
  blocks: GdrBlockRow[];
  ranges: GdrSourceRange[];
  start: number;
  end: number;
}
export interface NarrativeResult {
  sections: NarrativeSection[];
  errors: GdrParseError[];
}

/** Estende la sintassi dei documenti senza reinterpretare mai i turni storici. */
export function parseNarrative(source: string): NarrativeResult {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const offsets = gdrLineOffsets(source);
  const sections: NarrativeSection[] = [];
  const errors: GdrParseError[] = [];
  let buffer: string[] = [];
  let bufferLine = 0;
  const flush = () => {
    if (!buffer.join('\n').trim()) {
      buffer = [];
      return;
    }
    const localRanges: GdrSourceRange[] = [];
    const parsed = parseGdrMarkdown(buffer.join('\n'), localRanges);
    const ranges = localRanges.map((r) => ({
      ...r,
      start: offsets[bufferLine + r.startLine],
      end: offsets[bufferLine + r.endLine] + lines[bufferLine + r.endLine].length,
      startLine: bufferLine + r.startLine,
      endLine: bufferLine + r.endLine,
    }));
    const id = `section-${sections.length}`;
    sections.push({
      id,
      kind: 'document',
      text: '',
      speaker: '',
      portrait: '',
      ranges,
      start: ranges[0]?.start ?? 0,
      end: ranges.at(-1)?.end ?? 0,
      blocks: parsed.blocks.map((block, index) => ({
        id: `${id}-${index}`,
        documentKey: 'avventura',
        type: block.type,
        data: block.data as GdrBlockRow['data'],
        position: index,
      })),
    });
    errors.push(...parsed.errors.map((error) => ({ ...error, line: error.line + bufferLine })));
    buffer = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const match = /^::: (dialogo|azione|nota)(?:\s+(.*))?$/.exec(lines[i].trim());
    if (match) {
      flush();
      const start = i;
      let end = i + 1;
      while (end < lines.length && lines[end].trim() !== ':::') end++;
      if (end === lines.length) {
        errors.push({
          line: start + 1,
          message: `Riga ${start + 1}: manca la chiusura ::: del ${match[1]}.`,
        });
        bufferLine = start;
        buffer = lines.slice(start);
        break;
      }
      const [speaker = '', portrait = ''] = (match[2] ?? '')
        .split('|')
        .map((value) => value.trim());
      if (match[1] === 'dialogo' && !speaker)
        errors.push({
          line: start + 1,
          message: `Riga ${start + 1}: indica chi parla dopo "::: dialogo".`,
        });
      if (portrait && !safeNarrativeImage(portrait))
        errors.push({
          line: start + 1,
          message: `Riga ${start + 1}: usa un’immagine /assets/ oppure /api/media/ del sito.`,
        });
      sections.push({
        id: `section-${sections.length}`,
        kind: match[1] as NarrativeSection['kind'],
        text: lines.slice(start + 1, end).join('\n'),
        speaker,
        portrait: safeNarrativeImage(portrait),
        ranges: [],
        start: offsets[start],
        end: offsets[end] + lines[end].length,
        blocks: [],
      });
      i = end;
      bufferLine = end + 1;
    } else {
      if (!buffer.length) bufferLine = i;
      // I costrutti esistenti restano interi, anche se il loro testo contiene comandi narrativi.
      if (/^::: (callout(?:\s|$)|npc(?: full)?$)/.test(lines[i].trim())) {
        buffer.push(lines[i]);
        while (++i < lines.length) {
          buffer.push(lines[i]);
          if (lines[i].trim() === ':::') break;
        }
      } else buffer.push(lines[i]);
    }
  }
  flush();
  return { sections, errors };
}

export function safeNarrativeImage(value: string): string {
  // Niente URL esterni, traversal o richieste a endpoint diversi dai media autenticati.
  return /^\/(?:assets|api\/media)\/[a-zA-Z0-9/_%.\-]+\.(?:webp|png|jpe?g|gif)$/i.test(value) &&
    !/%2e|%2f|%5c|\.\./i.test(value)
    ? value
    : '';
}
