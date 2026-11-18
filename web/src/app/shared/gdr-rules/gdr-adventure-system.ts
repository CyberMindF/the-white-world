import {Component,DestroyRef,OnInit,computed,effect,inject,signal} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {RouterLink} from '@angular/router';
import {GdrWorkspaceService} from '../../core/gdr-workspace.service';
interface SystemChoice{id:string;name:string;revision:number;}
@Component({
  selector:'app-gdr-adventure-system',standalone:true,imports:[FormsModule,RouterLink],
  template:`<section aria-label="Sistema dell’avventura">
    <h2>Sistema di gioco</h2><p>{{adventure()?.systemName || 'Scegli il sistema dell’avventura'}}</p>
    @if(!workspace.systemEditing() && adventure()?.systemId){<p><a class="btn" routerLink="/tavolo-da-gioco/gdr/gestione/sistemi" [queryParams]="{system:adventure()?.systemId}">Gestisci questo sistema</a></p>}
    <p class="hint">Regole, campi della scheda e catalogo di abilità e magie vengono ereditati dal sistema.</p>
    <label>Sistema dell’avventura<select aria-label="Sistema dell’avventura" [disabled]="loading() || saving()" [ngModel]="selected()" (ngModelChange)="select($event)"><option value="">Scegli un sistema…</option>@for(system of systems();track system.id){<option [value]="system.id">{{system.name}}</option>}</select></label>
    @if(workspace.systemEditing()){
      <div class="actions"><button class="btn" [disabled]="saving()" (click)="cancel()">Annulla cambio sistema</button><button class="btn" [disabled]="saving() || !selected()" (click)="save()">{{saving()?'Salvataggio…':'Applica sistema all’avventura'}}</button></div>
      <p class="hint">I valori dei personaggi vengono conservati. Il nuovo sistema deve includere le loro abilità e magie e accettare i valori della scheda.</p>
    }
    @if(error()){<p role="alert">{{error()}}</p>}
    @if(notice()){<p role="status">{{notice()}}</p>}
  </section>`,
  styles:`:host{display:block;margin-bottom:2rem}select{display:block;width:100%;font:inherit;color:var(--text-color);background:var(--input-bg);padding:.7rem;border:1px solid var(--panel-border-color);border-radius:.5rem}.actions{display:flex;gap:.5rem;flex-wrap:wrap;margin-top:1rem}.hint{opacity:.75}`,
})
export class GdrAdventureSystem implements OnInit{
  protected readonly workspace=inject(GdrWorkspaceService);
  protected readonly adventure=computed(()=>this.workspace.adventures().find(a=>a.id===this.workspace.selectedId()));
  protected readonly selected=signal('');
  protected readonly systems=signal<SystemChoice[]>([]);
  protected readonly loading=signal(true);
  protected readonly saving=signal(false);
  protected readonly error=signal('');
  protected readonly notice=signal('');
  constructor(){
    effect(()=>{const a=this.adventure();if(!this.workspace.systemEditing())this.selected.set(a?.systemId??'');});
    inject(DestroyRef).onDestroy(()=>this.workspace.systemEditing.set(false));
  }
  async ngOnInit():Promise<void>{
    try{const r=await fetch('/api/gdr-systems',{credentials:'same-origin'}),data=await r.json();if(!r.ok)throw new Error(data.error||'Sistemi non disponibili.');this.systems.set(data.systems);}catch(e){this.error.set(e instanceof Error?e.message:'Sistemi non disponibili.');}finally{this.loading.set(false);}
  }
  protected select(id:string):void{this.workspace.systemEditing.set(id!==this.adventure()?.systemId);this.selected.set(id);this.error.set('');this.notice.set('');}
  protected cancel():void{if(this.saving())return;this.workspace.systemEditing.set(false);this.selected.set(this.adventure()?.systemId??'');this.error.set('');}
  protected async save():Promise<void>{
    const a=this.adventure(),system=this.systems().find(s=>s.id===this.selected());if(!a||!system||this.saving())return;
    this.saving.set(true);this.error.set('');
    try{const r=await fetch('/api/gdr-systems',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'assignSystem',id:a.id,revision:a.revision,systemId:system.id,systemRevision:system.revision})}),data=await r.json();if(!r.ok)throw new Error(data.error||'Cambio sistema non riuscito.');await this.workspace.load(a.id);if(!this.workspace.available())throw new Error('Il sistema è stato salvato. Ricarica la pagina per rileggere i dati aggiornati.');this.workspace.systemEditing.set(false);this.notice.set('Sistema aggiornato. Le schede ereditano le sue regole e i suoi campi.');}catch(e){this.error.set(e instanceof Error?e.message:'Cambio sistema non riuscito.');}finally{this.saving.set(false);}
  }
}
