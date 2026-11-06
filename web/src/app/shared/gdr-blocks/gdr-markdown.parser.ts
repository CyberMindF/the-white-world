import {
  GdrBlockType,
  GdrCalloutData,
  GdrHeadingData,
  GdrImageData,
  GdrListData,
  GdrNpcEntry,
  GdrNpcGridData,
  GdrParagraphData,
  GdrTableData,
} from './gdr-block.types';

export interface GdrParseError {
  line: number;
  message: string;
}

export interface GdrParsedBlock {
  type: GdrBlockType;
  data: unknown;
}

export interface GdrSourceRange {
  start: number;
  end: number;
  startLine: number;
  endLine: number;
}
export function gdrLineOffsets(source: string): number[] {
  const result = [0];
  for (const match of source.matchAll(/\r\n|\r|\n/g)) result.push(match.index! + match[0].length);
  return result;
}

export interface GdrParseResult {
  blocks: GdrParsedBlock[];
  errors: GdrParseError[];
}

const IMAGE_RE = /^!\[([^\]]*)\]\(([^)"]*)(?:\s+"([^"]*)")?\)$/;
const TABLE_ROW_RE = /^\|(.*)\|$/;
const TABLE_SEP_RE = /^\|?\s*:?-{2,}:?\s*\|\s*:?-{2,}:?\s*\|?$/;

// Parser scritto a mano per la sintassi custom "stile Homebrewery" dell'editor GDR: markdown
// leggero per i tipi semplici (heading/paragraph/list/table/image), blocchi delimitati `::: tipo`
// per quelli strutturati (callout, npc). Best-effort: un costrutto malformato produce un errore
// in `errors` ma non interrompe il parsing del resto del documento.
export function parseGdrMarkdown(source: string, ranges?: GdrSourceRange[]): GdrParseResult {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: GdrParsedBlock[] = [];
  const offsets = gdrLineOffsets(source);
  const range = (startLine: number, endLine: number) =>
    ranges?.push({
      start: offsets[startLine],
      end: offsets[endLine] + lines[endLine].length,
      startLine,
      endLine,
    });
  const errors: GdrParseError[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const lineNo = i + 1;

    if (line.trim() === '') {
      i++;
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (headingMatch) {
      const hashes = headingMatch[1];
      const text = headingMatch[2].trim();
      if (hashes.length === 2 || hashes.length === 3) {
        const data: GdrHeadingData = { level: hashes.length as 2 | 3, text };
        blocks.push({ type: 'heading', data });
        range(i, i);
      } else {
        errors.push({
          line: lineNo,
          message: `Livello di titolo non supportato a riga ${lineNo} (solo ## o ###).`,
        });
      }
      i++;
      continue;
    }

    if (line.trim().startsWith('::: callout')) {
      const lead = line.trim().slice('::: callout'.length).trim() || null;
      const { content, endIndex, closed } = readFencedBlock(lines, i + 1);
      if (!closed) {
        errors.push({
          line: lineNo,
          message: `Blocco callout aperto a riga ${lineNo} non è mai chiuso.`,
        });
        i = endIndex;
        continue;
      }
      const data: GdrCalloutData = { lead, text: content.join('\n').trim() };
      blocks.push({ type: 'callout', data });
      range(i, endIndex);
      i = endIndex + 1;
      continue;
    }

    if (/^::: npc(?: full)?$/.test(line.trim())) {
      const { content, endIndex, closed } = readFencedBlock(lines, i + 1);
      if (!closed) {
        errors.push({
          line: lineNo,
          message: `Blocco npc aperto a riga ${lineNo} non è mai chiuso.`,
        });
        i = endIndex;
        continue;
      }
      const parsed = parseNpcEntries(content, lineNo + 1);
      errors.push(...parsed.errors);
      if (parsed.entries.length > 0) {
        const data: GdrNpcGridData = { entries: parsed.entries, ...(line.trim() === '::: npc full' ? {layout: 'full' as const} : {}) };
        blocks.push({ type: 'npc_grid', data });
        range(i, endIndex);
      }
      i = endIndex + 1;
      continue;
    }

    const imageMatch = IMAGE_RE.exec(line.trim());
    if (imageMatch) {
      const [, alt, src, caption] = imageMatch;
      if (!src.trim()) {
        errors.push({ line: lineNo, message: `Immagine a riga ${lineNo} senza URL.` });
      } else {
        const data: GdrImageData = {
          src: src.trim(),
          alt: alt.trim(),
          caption: caption ? caption.trim() : null,
        };
        blocks.push({ type: 'image', data });
        range(i, i);
      }
      i++;
      continue;
    }

    if (/^-\s+/.test(line)) {
      const items: string[] = [];
      let j = i;
      while (j < lines.length && /^-\s+/.test(lines[j])) {
        items.push(lines[j].replace(/^-\s+/, '').trim());
        j++;
      }
      const data: GdrListData = { items };
      blocks.push({ type: 'list', data });
      range(i, j - 1);
      i = j;
      continue;
    }

    if (TABLE_ROW_RE.test(line.trim())) {
      const tableLines: { text: string; lineNo: number }[] = [];
      let j = i;
      while (j < lines.length && TABLE_ROW_RE.test(lines[j].trim())) {
        tableLines.push({ text: lines[j].trim(), lineNo: j + 1 });
        j++;
      }
      const parsed = parseTable(tableLines);
      errors.push(...parsed.errors);
      if (parsed.data) {
        blocks.push({ type: 'table', data: parsed.data });
        range(i, j - 1);
      }
      i = j;
      continue;
    }

    // Paragrafo: accumula righe consecutive non vuote e non riconosciute come altro costrutto.
    const paragraphLines: string[] = [];
    let j = i;
    while (
      j < lines.length &&
      lines[j].trim() !== '' &&
      !/^(#{1,6})\s+/.test(lines[j]) &&
      !/^::: npc(?: full)?$/.test(lines[j].trim()) &&
      !lines[j].trim().startsWith('::: callout') &&
      !IMAGE_RE.test(lines[j].trim()) &&
      !/^-\s+/.test(lines[j]) &&
      !TABLE_ROW_RE.test(lines[j].trim())
    ) {
      paragraphLines.push(lines[j]);
      j++;
    }
    const rawText = paragraphLines.join('\n').trim();
    const emphasisMatch = /^\*(.+)\*$/s.exec(rawText);
    const data: GdrParagraphData = emphasisMatch
      ? { text: emphasisMatch[1].trim(), emphasis: true }
      : { text: rawText };
    blocks.push({ type: 'paragraph', data });
    range(i, j - 1);
    i = j;
  }

  return { blocks, errors };
}

function readFencedBlock(
  lines: string[],
  start: number,
): { content: string[]; endIndex: number; closed: boolean } {
  const content: string[] = [];
  let i = start;
  while (i < lines.length && lines[i].trim() !== ':::') {
    content.push(lines[i]);
    i++;
  }
  if (i >= lines.length) {
    return { content, endIndex: i, closed: false };
  }
  return { content, endIndex: i, closed: true };
}

function parseNpcEntries(
  lines: string[],
  firstLineNo: number,
): { entries: GdrNpcEntry[]; errors: GdrParseError[] } {
  const entries: GdrNpcEntry[] = [];
  const errors: GdrParseError[] = [];
  let current: Partial<GdrNpcEntry> | null = null;
  let currentLine = firstLineNo;

  const flush = (lineNo: number) => {
    if (!current) return;
    const missing = (['image', 'alt', 'name', 'description'] as const).filter(
      (key) => !current![key],
    );
    if (missing.length > 0) {
      errors.push({
        line: currentLine,
        message: `NPC alla riga ${currentLine}: manca il campo '${missing[0]}'.`,
      });
    } else {
      entries.push(current as GdrNpcEntry);
    }
    current = null;
  };

  lines.forEach((rawLine, idx) => {
    const lineNo = firstLineNo + idx;
    const trimmed = rawLine.trim();
    if (trimmed === '') return;

    const entryStart = /^-\s*image:\s*(.*)$/.exec(trimmed);
    if (entryStart) {
      flush(lineNo);
      currentLine = lineNo;
      current = { image: entryStart[1].trim() };
      return;
    }

    const field = /^(alt|name|description|characterId):\s*(.*)$/.exec(trimmed);
    if (field && current) {
      (current as Record<string, string>)[field[1]] = field[2].trim();
      return;
    }

    errors.push({ line: lineNo, message: `Riga ${lineNo} non riconosciuta nel blocco npc.` });
  });
  flush(currentLine);

  return { entries, errors };
}

function parseTable(rows: { text: string; lineNo: number }[]): {
  data: GdrTableData | null;
  errors: GdrParseError[];
} {
  const errors: GdrParseError[] = [];
  const cellRows = rows
    .filter((row) => !TABLE_SEP_RE.test(row.text))
    .map((row) => ({
      cells: row.text
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim()),
      lineNo: row.lineNo,
    }));

  if (cellRows.length === 0) {
    return { data: null, errors };
  }

  for (const row of cellRows) {
    if (row.cells.length !== 2) {
      errors.push({
        line: row.lineNo,
        message: `Riga ${row.lineNo} della tabella ha ${row.cells.length} colonne, devono essere 2.`,
      });
    }
  }
  if (errors.length > 0) {
    return { data: null, errors };
  }

  const [headerRow, ...bodyRows] = cellRows;
  const data: GdrTableData = {
    header: [headerRow.cells[0], headerRow.cells[1]],
    rows: bodyRows.map((r) => [r.cells[0], r.cells[1]]),
  };
  return { data, errors };
}
