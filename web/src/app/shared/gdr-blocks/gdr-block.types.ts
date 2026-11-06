export type GdrDocumentKey =
  | 'avventura'
  | 'maga-regole'
  | 'maga-personaggio'
  | 'casa-avventura'
  | 'casa-regole'
  | 'casa-personaggio';

export type GdrBlockType = 'heading' | 'paragraph' | 'callout' | 'image' | 'npc_grid' | 'list' | 'table';

export interface GdrHeadingData {
  level: 2 | 3;
  text: string;
}

export interface GdrParagraphData {
  text: string;
  emphasis?: boolean;
  format?: 'gdr-narrative';
}

export interface GdrCalloutData {
  lead: string | null;
  text: string;
}

export interface GdrImageData {
  src: string;
  alt: string;
  caption: string | null;
}

export interface GdrNpcEntry {
  characterId?: string;
  image: string;
  alt: string;
  name: string;
  description: string;
}

export interface GdrNpcGridData {
  layout?: 'full';
  entries: GdrNpcEntry[];
}

export interface GdrListData {
  items: string[];
}

export interface GdrTableData {
  header: [string, string];
  rows: string[][];
}

export type GdrBlockData =
  | GdrHeadingData
  | GdrParagraphData
  | GdrCalloutData
  | GdrImageData
  | GdrNpcGridData
  | GdrListData
  | GdrTableData;

export interface GdrBlockRow {
  id: string;
  documentKey: GdrDocumentKey;
  type: GdrBlockType;
  data: GdrBlockData;
  position: number;
  updatedAt?: string;
}
