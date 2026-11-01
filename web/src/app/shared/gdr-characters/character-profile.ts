import {
  CharacterProfile,
  InventoryItem,
  WorkspaceCharacter,
} from '../../core/gdr-workspace.service';
import { safeNarrativeImage } from '../gdr-turn/gdr-turn.parser';

export const PROFILE_FIELDS: { key: keyof CharacterProfile; label: string; rows: number }[] = [
  { key: 'surname', label: 'Cognome', rows: 1 },
  { key: 'appearance', label: 'Aspetto', rows: 3 },
  { key: 'personality', label: 'Carattere', rows: 3 },
  { key: 'history', label: 'Storia', rows: 5 },
  { key: 'goal', label: 'Obiettivo attuale', rows: 3 },
  { key: 'abilities', label: 'Abilità', rows: 4 },
];
export const emptyProfile = (): CharacterProfile => ({
  surname: '',
  appearance: '',
  personality: '',
  history: '',
  goal: '',
  abilities: '',
});
export interface CharacterBundle {
  format: 'mondobianco.character';
  version: 1;
  kind: 'pg' | 'png';
  name: string;
  profile: CharacterProfile;
  sheet: string;
  characterFields?: Record<string, string>;
  inventory: InventoryItem[];
  images: { photo: string; avatar: string };
}
export function parseCharacterBundle(raw: string): CharacterBundle {
  if (raw.length > 8 * 1024 * 1024) throw new Error('Il file personaggio è troppo grande.');
  let p: unknown;
  try {
    p = JSON.parse(raw);
  } catch {
    throw new Error('Il file non contiene JSON valido.');
  }
  const value = p as Partial<CharacterBundle>;
  if (
    !value ||
    value.format !== 'mondobianco.character' ||
    value.version !== 1 ||
    !['pg', 'png'].includes(value.kind ?? '')
  )
    throw new Error('Questo file non è un personaggio del Mondo Bianco compatibile.');
  const string = (v: unknown, max: number, required = false) => {
    if (typeof v !== 'string' || v.length > max || (required && !v.trim()))
      throw new Error('Un campo del personaggio è mancante o troppo lungo.');
    return v;
  };
  const characterFields: Record<string, string> = {};
  if (
    value.characterFields &&
    (typeof value.characterFields !== 'object' ||
      Array.isArray(value.characterFields) ||
      Object.keys(value.characterFields).length > 100)
  )
    throw new Error('Campi non validi.');
  for (const [key, field] of Object.entries(value.characterFields ?? {})) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(key)) throw new Error('Campo non valido.');
    characterFields[key] = string(field, 4000);
  }
  const profile = emptyProfile();
  for (const f of PROFILE_FIELDS)
    profile[f.key] = string(value.profile?.[f.key] ?? '', f.key === 'surname' ? 160 : 6000);
  if (!Array.isArray(value.inventory) || value.inventory.length > 100)
    throw new Error('Inventario non valido.');
  const inventory = value.inventory.map((item) => {
    if (!item || !Number.isSafeInteger(item.quantity) || item.quantity < 0 || item.quantity > 99999)
      throw new Error('Quantità dell’inventario non valida.');
    return {
      id: crypto.randomUUID(),
      name: string(item.name, 160, true),
      quantity: item.quantity,
      notes: string(item.notes ?? '', 2000),
    };
  });
  const image = (v: unknown) => {
    if (v === '') return '';
    if (
      typeof v !== 'string' ||
      v.length > 3 * 1024 * 1024 ||
      !/^data:image\/(?:webp|png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(v)
    )
      throw new Error('Immagine incorporata non valida.');
    return v;
  };
  return {
    format: 'mondobianco.character',
    version: 1,
    kind: value.kind!,
    name: string(value.name, 160, true),
    profile,
    sheet: string(value.sheet ?? '', 20000),
    characterFields,
    inventory,
    images: { photo: image(value.images?.photo ?? ''), avatar: image(value.images?.avatar ?? '') },
  };
}
export async function imageForExport(path: string): Promise<string> {
  if (!path) return '';
  if (!safeNarrativeImage(path)) throw new Error('Il percorso dell’immagine non è supportato.');
  const response = await fetch(path, { credentials: 'same-origin' });
  if (!response.ok)
    throw new Error(
      'Non è stato possibile includere una foto nel file. Riprova prima di esportare.',
    );
  const blob = await response.blob();
  if (blob.size > 2 * 1024 * 1024 || !/^image\/(webp|png|jpeg)$/.test(blob.type))
    throw new Error('La foto è troppo grande o non è in un formato esportabile.');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Lettura immagine non riuscita.'));
    reader.readAsDataURL(blob);
  });
}
export async function exportCharacter(c: WorkspaceCharacter): Promise<CharacterBundle> {
  const [photo, avatar] = await Promise.all([imageForExport(c.photo), imageForExport(c.portrait)]);
  return {
    format: 'mondobianco.character',
    version: 1,
    kind: c.kind,
    name: c.name,
    profile: { ...emptyProfile(), ...c.profile },
    sheet: c.sheet,
    characterFields: { ...c.characterFields },
    inventory: structuredClone(c.inventory),
    images: { photo, avatar },
  };
}
/** Foto completa e avatar quadrato sono due file distinti, ottenuti dalla stessa immagine. */
export async function prepareCharacterImage(blob: Blob, avatar: boolean): Promise<Blob> {
  if (blob.size > 12 * 1024 * 1024 || !/^image\/(jpeg|png|webp)$/.test(blob.type))
    throw new Error('Scegli una foto PNG, JPEG o WebP fino a 12 MB.');
  const bitmap = await createImageBitmap(blob);
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40_000_000)
      throw new Error('Questa immagine è troppo grande. Scegline una più piccola.');
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    canvas.width = avatar ? 256 : Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = avatar ? 256 : Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Impossibile preparare l’immagine.');
    if (avatar) {
      const side = Math.min(bitmap.width, bitmap.height);
      ctx.drawImage(
        bitmap,
        (bitmap.width - side) / 2,
        (bitmap.height - side) / 2,
        side,
        side,
        0,
        0,
        256,
        256,
      );
    } else ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) =>
      canvas.toBlob(
        (value) =>
          value ? resolve(value) : reject(new Error('Conversione della foto non riuscita.')),
        'image/webp',
        0.86,
      ),
    );
  } finally {
    bitmap.close();
  }
}

export function portraitCropRect(
  width: number,
  height: number,
  zoom: number,
  x: number,
  y: number,
) {
  const size = Math.min(width, height) / Math.max(1, Math.min(3, zoom));
  return {
    x: (width - size) * Math.max(0, Math.min(1, x)),
    y: (height - size) * Math.max(0, Math.min(1, y)),
    size,
  };
}
export async function cropCharacterPortrait(
  blob: Blob,
  zoom: number,
  x: number,
  y: number,
): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  try {
    const crop = portraitCropRect(bitmap.width, bitmap.height, zoom, x, y),
      canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Impossibile preparare il ritratto.');
    ctx.drawImage(bitmap, crop.x, crop.y, crop.size, crop.size, 0, 0, 256, 256);
    return await new Promise((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error('Ritaglio non riuscito.'))),
        'image/webp',
        0.86,
      ),
    );
  } finally {
    bitmap.close();
  }
}
