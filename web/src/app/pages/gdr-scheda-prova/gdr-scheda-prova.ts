import { Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AppShell } from '../../shell/app-shell';
interface Item { id: string; name: string; quantity: number; notes: string; equipped: boolean }
interface Character { name: string; surname: string; appearance: string; history: string; goal: string; petName: string; petDescription: string; stats: number[]; items: Item[]; assigned: boolean; completed: boolean }
const KEY = 'gdr-scheda-prova-v1';
function initial(): Character { return { name: '', surname: '', appearance: '', history: '', goal: '', petName: '', petDescription: 'Una gattina che ti accompagna da casa. Il nome lo scegli tu.', stats: [1,1,1,1], items: [{ id: 'license', name: 'Licenza di apprendista maga', quantity: 1, notes: 'Rilasciata al superamento dell’esame.', equipped: false }, { id: 'coin', name: 'Moneta misteriosa', quantity: 1, notes: 'Trovata vicino alla biblioteca proibita.', equipped: false }], assigned: false, completed: false }; }
@Component({ selector: 'app-gdr-scheda-prova', standalone: true, imports: [FormsModule, AppShell], templateUrl: './gdr-scheda-prova.html', styleUrls: ['../../../styles/pages/tavolo.css', './gdr-scheda-prova.css'] })
export class GdrSchedaProva {
  readonly role = signal<'master'|'player'>('master');
  readonly tab = signal<'sheet'|'inventory'|'pet'>('sheet');
  readonly character = signal<Character>(initial());
  readonly editing = signal(false);
  readonly notice = signal('');
  readonly query = signal('');
  readonly newItemName = signal('');
  readonly newItemNotes = signal('');
  readonly newItemQuantity = signal(1);
  readonly statLabels = ['Corpo', 'Agilità', 'Mente', 'Magia'];
  readonly points = computed(() => 12 - this.character().stats.reduce((a,b) => a+b, 0));
  readonly fullName = computed(() => [this.character().name, this.character().surname].filter(Boolean).join(' ') || 'Il personaggio di Desy');
  readonly visibleItems = computed(() => this.character().items.filter(i => (i.name+' '+i.notes).toLocaleLowerCase('it').includes(this.query().toLocaleLowerCase('it'))));
  readonly canComplete = computed(() => !!this.character().name.trim() && this.points() === 0);
  constructor() {
    try { const saved = JSON.parse(localStorage.getItem(KEY) || 'null'); if (saved && typeof saved.name === 'string' && typeof saved.surname === 'string' && typeof saved.appearance === 'string' && typeof saved.history === 'string' && typeof saved.goal === 'string' && typeof saved.petName === 'string' && typeof saved.petDescription === 'string' && typeof saved.assigned === 'boolean' && typeof saved.completed === 'boolean' && Array.isArray(saved.stats) && saved.stats.length === 4 && saved.stats.every((n: unknown) => Number.isInteger(n) && Number(n)>=1 && Number(n)<=5) && Array.isArray(saved.items) && saved.items.every((i: Item) => typeof i.id === 'string' && typeof i.name === 'string' && typeof i.notes === 'string' && Number.isInteger(i.quantity) && i.quantity >= 1 && typeof i.equipped === 'boolean')) this.character.set(saved); } catch { /* Una prova nuova resta disponibile anche senza memoria locale. */ }
  }
  private persist(message = 'Prova salvata in questo browser.'): void { try { localStorage.setItem(KEY, JSON.stringify(this.character())); this.notice.set(message); } catch { this.notice.set('La prova funziona, ma il browser non permette di conservarla dopo la chiusura.'); } }
  setRole(role: 'master'|'player'): void { this.role.set(role); this.editing.set(false); this.notice.set(''); }
  update(key: 'name'|'surname'|'appearance'|'history'|'goal'|'petName'|'petDescription', value: string): void { this.character.update(c => ({...c, [key]: value, completed: key === 'name' && !value.trim() ? false : c.completed})); this.persist(); }
  assign(): void { this.character.update(c => ({...c, assigned: true})); this.persist('PG assegnato a Desy. Passa alla vista Desy per completarlo.'); }
  stat(index: number, delta: number): void { const c=this.character(); const value=c.stats[index]+delta; if(value<1 || value>5 || (delta>0 && this.points()<=0)) return; const stats=[...c.stats]; stats[index]=value; this.character.set({...c,stats,completed:false}); this.persist(); }
  complete(): void { if(!this.canComplete()) return; this.character.update(c=>({...c,completed:true})); this.editing.set(false); this.persist('Personaggio pronto per l’avventura.'); }
  addItem(): void { const name=this.newItemName().trim(), quantity=Number(this.newItemQuantity()); if(!name || !Number.isInteger(quantity) || quantity<1 || quantity>999) return; this.character.update(c=>({...c,items:[...c.items,{id:crypto.randomUUID(),name,quantity,notes:this.newItemNotes().trim(),equipped:false}]})); this.newItemName.set(''); this.newItemNotes.set(''); this.newItemQuantity.set(1); this.persist('Oggetto aggiunto allo zaino di Desy.'); }
  changeQuantity(id: string, delta: number): void { this.character.update(c=>({...c,items:c.items.map(i=>i.id===id?{...i,quantity:Math.max(1,Math.min(999,i.quantity+delta))}:i)})); this.persist(); }
  equip(id: string): void { this.character.update(c=>({...c,items:c.items.map(i=>i.id===id?{...i,equipped:!i.equipped}:i)})); this.persist(); }
  remove(id: string): void { this.character.update(c=>({...c,items:c.items.filter(i=>i.id!==id)})); this.persist('Oggetto rimosso dalla prova.'); }
  reset(): void { this.character.set(initial()); this.role.set('master'); this.tab.set('sheet'); this.editing.set(false); this.persist('Prova ricominciata. I dati della partita non sono stati modificati.'); }
}
