import {
  GdrBlockRow,
  GdrCalloutData,
  GdrHeadingData,
  GdrImageData,
  GdrListData,
  GdrNpcGridData,
  GdrParagraphData,
  GdrTableData
} from './gdr-block.types';

// Inverso di gdr-markdown.parser.ts: usato solo per pre-popolare il textarea dell'editor al
// caricamento di un documento esistente. Deve produrre testo che, ri-parsato, generi blocchi
// equivalenti (round-trip), non necessariamente byte-identico all'originale.
export function serializeGdrBlocks(blocks: GdrBlockRow[]): string {
  return blocks
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((block) => serializeBlock(block))
    .join('\n\n');
}

function serializeBlock(block: GdrBlockRow): string {
  switch (block.type) {
    case 'heading': {
      const data = block.data as GdrHeadingData;
      return `${'#'.repeat(data.level)} ${data.text}`;
    }
    case 'paragraph': {
      const data = block.data as GdrParagraphData;
      return data.emphasis ? `*${data.text}*` : data.text;
    }
    case 'callout': {
      const data = block.data as GdrCalloutData;
      const lead = data.lead ? ` ${data.lead}` : '';
      return `::: callout${lead}\n${data.text}\n:::`;
    }
    case 'image': {
      const data = block.data as GdrImageData;
      const caption = data.caption ? ` "${data.caption}"` : '';
      return `![${data.alt}](${data.src}${caption})`;
    }
    case 'npc_grid': {
      const data = block.data as GdrNpcGridData;
      const entries = data.entries
        .map((entry) => `- image: ${entry.image}\n  alt: ${entry.alt}\n  name: ${entry.name}\n  description: ${entry.description}${entry.characterId ? `\n  characterId: ${entry.characterId}` : ''}`)
        .join('\n');
      return `::: npc${data.layout === 'full' ? ' full' : ''}\n${entries}\n:::`;
    }
    case 'list': {
      const data = block.data as GdrListData;
      return data.items.map((item) => `- ${item}`).join('\n');
    }
    case 'table': {
      const data = block.data as GdrTableData;
      const header = `| ${data.header[0]} | ${data.header[1]} |`;
      const separator = '| --- | --- |';
      const rows = data.rows.map((row) => `| ${row[0]} | ${row[1]} |`).join('\n');
      return [header, separator, rows].filter(Boolean).join('\n');
    }
  }
}
