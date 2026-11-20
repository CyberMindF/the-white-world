export interface CorrespondenceData {
  name: string;
  characterId: string;
  portrait: string;
  signature: string;
  date: string;
  time: string;
}

export interface CorrespondenceDraft extends CorrespondenceData {
  kind: 'lettera' | 'messaggio';
  body: string;
}

export function parseCorrespondenceHeader(header: string): CorrespondenceData {
  const value: unknown = header.trim() ? JSON.parse(header) : {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Intestazione non valida');
  const fields = ['name', 'characterId', 'portrait', 'signature', 'date', 'time'] as const;
  const data = {} as CorrespondenceData;
  for (const field of fields) {
    const entry = (value as Record<string, unknown>)[field];
    if (entry !== undefined && typeof entry !== 'string') throw new Error('Campo non valido');
    data[field] = entry ?? '';
  }
  return data;
}

export const OPTIONAL_CORRESPONDENCE_FIELD = '(Elimina se non ti serve)';

export function correspondenceReferenceHeader(kind: CorrespondenceDraft['kind'], fields: CorrespondenceData, visible = false): string {
  const hidden = kind === 'lettera'
    ? {name:fields.name,characterId:fields.characterId,portrait:fields.portrait,time:fields.time}
    : {characterId:fields.characterId,portrait:fields.portrait,signature:fields.signature};
  const header = visible ? {} : Object.fromEntries(Object.entries(hidden).filter(([, value]) => value !== ''));
  return `::: ${kind}${Object.keys(header).length ? ' ' + JSON.stringify(header) : ''}`;
}

export function correspondencePrefix(kind: CorrespondenceDraft['kind'], fields: CorrespondenceData, placeholders = false, visible = false): string {
  const rows = kind === 'lettera'
    ? [['DATA',fields.date],['FIRMA',fields.signature]]
    : [['CONTATTO',fields.name],['DATA',fields.date],['ORA',fields.time]];
  const codes = rows.filter(([, value]) => value || placeholders).map(([label,value]) => `${label}: ${value ? /[\r\n]|^"/.test(value) ? JSON.stringify(value) : value : OPTIONAL_CORRESPONDENCE_FIELD}`);
  return correspondenceReferenceHeader(kind,fields,visible) + (codes.length ? '\n' + codes.join('\n') + '\n---' : '');
}

export function readCorrespondenceBody(lines: string[], initial: CorrespondenceData): {data:CorrespondenceData;prefixLines:number} {
  const data = {...initial};
  const keys: Record<string, keyof CorrespondenceData> = {DATA:'date',GIORNO:'date',ORA:'time',ORARIO:'time',FIRMA:'signature',CONTATTO:'name',NOME:'name',NUMERO:'name'};
  for (let i=0;i<lines.length;i++) {
    if (lines[i].trim() === '---') return {data,prefixLines:i+1};
    if (!lines[i].trim()) continue;
    const match = /^\s*([A-Z]+):\s*(.*)$/i.exec(lines[i]);
    if (!match || !keys[match[1].toUpperCase()]) break;
    let value = match[2].trim();
    if (value === OPTIONAL_CORRESPONDENCE_FIELD) value = '';
    else if (value.startsWith('"')) { try {const decoded:unknown=JSON.parse(value);if(typeof decoded==='string')value=decoded;} catch { /* Testo libero, comprese virgolette non chiuse. */ } }
    data[keys[match[1].toUpperCase()]] = value;
  }
  return {data:initial,prefixLines:0};
}

export function writeCorrespondence(draft: CorrespondenceDraft, placeholders = false): string {
  return correspondencePrefix(draft.kind,draft,placeholders) + `\n${draft.body}\n:::`;
}
