import { GdrBlockRow, GdrHeadingData } from '../gdr-blocks/gdr-block.types';

/** Consulta gli stessi blocchi originali: nessuna copia da mantenere allineata. */
export function splitCharacterPowers(blocks: GdrBlockRow[]): {
  rules: GdrBlockRow[];
  powers: GdrBlockRow[];
} {
  const rules: GdrBlockRow[] = [], powers: GdrBlockRow[] = [];
  let powerLevel: number | null = null;
  for (const block of blocks) {
    if (block.type === 'heading') {
      const heading = block.data as GdrHeadingData;
      if (/^(abilità(?: speciali)?|incantesimi)$/iu.test(heading.text.trim())) {
        powerLevel = heading.level;
      } else if (powerLevel !== null && heading.level <= powerLevel) {
        powerLevel = null;
      }
    }
    (powerLevel === null ? rules : powers).push(block);
  }
  return { rules, powers };
}
