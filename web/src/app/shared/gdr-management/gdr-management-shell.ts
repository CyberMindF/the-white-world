import {Component,input} from '@angular/core';
import {RouterLink} from '@angular/router';
import {AppShell} from '../../shell/app-shell';

@Component({
  selector:'app-gdr-management-shell',standalone:true,imports:[AppShell,RouterLink],
  template:`<app-shell homeHref="/tavolo-da-gioco/gdr" homeLabel="Gioco di Ruolo" homeAria="Torna al gioco">
    <div class="management-container">
      <header class="management-header"><h1>Gestione GDR</h1></header>
      <nav class="management-nav" aria-label="Gestione GDR">
        @for(section of sections;track section.id){
          @if(blocked()){
            <button type="button" disabled [class.active]="activeSection()===section.id" [attr.aria-current]="activeSection()===section.id?'page':null">{{section.label}}</button>
          }@else{
            <a [routerLink]="section.path" [class.active]="activeSection()===section.id" [attr.aria-current]="activeSection()===section.id?'page':null">{{section.label}}</a>
          }
        }
      </nav>
      <div class="management-content"><ng-content /></div>
    </div>
  </app-shell>`,
  styles:`
    :host{display:block}.management-container{width:min(calc(100% - 2rem),76rem);margin:1.5rem auto 3rem}
    .management-header{margin:0 0 1.25rem}.management-header h1{font:inherit;font-weight:700;font-size:clamp(1.7rem,3vw,2.25rem);line-height:1.2;letter-spacing:-.025em;margin:0}
    .management-nav{display:flex;flex-wrap:wrap;gap:.25rem;border-bottom:1px solid var(--panel-border-color,var(--border-color));margin-bottom:1.75rem;padding-bottom:.6rem}
    .management-nav a,.management-nav button{display:block;box-sizing:border-box;padding:.65rem .95rem;border:1px solid transparent;border-radius:.55rem;font:inherit;font-weight:600;text-decoration:none;color:var(--muted-color);background:transparent;min-height:44px;text-align:center}
    .management-nav .active{background:var(--input-bg);border-color:var(--panel-border-color,var(--border-color));color:var(--text-color)}
    .management-nav button:disabled{cursor:default;opacity:.55}.management-nav button.active:disabled{opacity:.8}
    .management-nav a:hover{color:var(--text-color)}.management-nav a:focus-visible{outline:2px solid var(--accent-color);outline-offset:2px}
    .management-content{min-width:0}
    @media(max-width:600px){.management-container{width:calc(100% - 1.5rem);margin-top:1rem}.management-nav{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.management-nav a,.management-nav button{padding:.65rem .4rem;font-size:.9rem}}
  `,
})
export class GdrManagementShell{
  readonly activeSection=input<'adventures'|'systems'|'rules'|'powers'>('adventures');
  readonly blocked=input(false);
  protected readonly sections=[
    {id:'adventures',label:'Avventure',path:'/tavolo-da-gioco/gdr/gestione'},
    {id:'systems',label:'Sistemi',path:'/tavolo-da-gioco/gdr/gestione/sistemi'},
    {id:'rules',label:'Regole',path:'/tavolo-da-gioco/gdr/gestione/regole'},
    {id:'powers',label:'Abilità e magie',path:'/tavolo-da-gioco/gdr/gestione/poteri'},
  ];
}
