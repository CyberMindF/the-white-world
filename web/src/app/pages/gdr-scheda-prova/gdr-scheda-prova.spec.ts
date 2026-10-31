import { beforeEach, describe, expect, it } from 'vitest';
import { GdrSchedaProva } from './gdr-scheda-prova';

describe('prova separata di scheda e zaino', () => {
  beforeEach(() => localStorage.removeItem('gdr-scheda-prova-v1'));

  it('permette di assegnare un PG senza identità e di completarlo come giocatrice', () => {
    const page = new GdrSchedaProva();
    page.assign();
    page.setRole('player');
    page.complete();
    expect(page.character().assigned).toBe(true);
    expect(page.character().completed).toBe(false);
    page.update('name', 'Livia');
    page.update('surname', 'Alba');
    for (let i = 0; i < 4; i++) { page.stat(i, 1); page.stat(i, 1); }
    page.complete();
    expect(page.points()).toBe(0);
    expect(page.character().completed).toBe(true);
    expect(page.fullName()).toBe('Livia Alba');
    expect(new GdrSchedaProva().fullName()).toBe('Livia Alba');
  });

  it('non consente di spendere più punti o scendere sotto il minimo', () => {
    const page = new GdrSchedaProva();
    page.stat(0, -1);
    expect(page.character().stats[0]).toBe(1);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 10; j++) page.stat(i, 1);
    expect(page.points()).toBe(0);
    expect(page.character().stats.every(n => n >= 1 && n <= 5)).toBe(true);
  });

  it('conserva compagna e oggetti nella prova e ripristina solo i dati dimostrativi', () => {
    const page = new GdrSchedaProva();
    page.update('petName', 'Luna');
    page.newItemName.set('Pozione');
    page.newItemQuantity.set(2);
    page.addItem();
    const item = page.character().items.at(-1)!;
    page.equip(item.id);
    expect(new GdrSchedaProva().character().petName).toBe('Luna');
    expect(new GdrSchedaProva().character().items.at(-1)?.equipped).toBe(true);
    page.reset();
    expect(page.character().assigned).toBe(false);
    expect(page.character().items.some(i => i.name === 'Pozione')).toBe(false);
  });
});
