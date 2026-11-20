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

export function writeCorrespondence(draft: CorrespondenceDraft): string {
  const { kind, body, ...fields } = draft;
  const header = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== ''));
  return `::: ${kind}${Object.keys(header).length ? ' ' + JSON.stringify(header) : ''}\n${body}\n:::`;
}
