import {Component,computed,input} from '@angular/core';

export const SPELL_COMPONENTS = [
  {code:'V',label:'Verbale'},
  {code:'S',label:'Somatica'},
  {code:'M',label:'Materiale'},
] as const;

@Component({
  selector:'app-gdr-spell-components',
  template:`@if(components()){<abbr [title]="description()" [attr.aria-label]="description()">{{components()}}</abbr>}`,
  styles:`:host{display:inline} abbr{display:inline-block;margin-inline-start:.4em;padding:.1em .4em;border:1px solid var(--panel-border-color);border-radius:.35em;font-size:.8em;font-weight:600;text-decoration:none;white-space:nowrap}`,
})
export class GdrSpellComponents {
  readonly components=input('');
  protected readonly description=computed(()=>'Componenti: '+SPELL_COMPONENTS.filter(c=>this.components().includes(c.code)).map(c=>c.label.toLocaleLowerCase('it')).join(', '));
}
