import {Component,DestroyRef,OnInit,computed,effect,inject,signal} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {RouterLink} from '@angular/router';
import {GdrWorkspaceService} from '../../core/gdr-workspace.service';
interface SystemChoice{id:string;name:string;revision:number;}
@Component({
  selector:'app-gdr-adventure-system',standalone:true,imports:[FormsModule,RouterLink],
  template:`<section aria-label="Impostazione del sistema">
    <div class="system-setting">
      <label>Sistema<select aria-label="Sistema dell’avventura" [disabled]="loading() || saving() || workspace.saving() || workspace.characterPendingChanges()" [ngModel]="selected()" (ngModelChange)="select($event)"><option value="">Scegli un sistema…</option>@for(system of systems();track system.id){<option [value]="system.id">{{system.name}}</option>}</select></label>
      @if(!workspace.pendingChanges() && adventure()?.systemId){<a class="system-link" routerLink="/tavolo-da-gioco/gdr/gestione/sistemi" [queryParams]="{system:adventure()?.systemId}">Modifica sistema ↗</a>}
    </div>
    @if(workspace.systemEditing()){
      <div class="actions"><button class="btn" [disabled]="saving()" (click)="cancel()">Annulla cambio sistema</button><button class="btn" [disabled]="saving() || !selected()" (click)="save()">{{saving()?'Salvataggio…':'Applica sistema all’avventura'}}</button></div>
      <p class="hint">I valori dei personaggi vengono conservati. Il sistema deve includere le loro abilità e magie e accettare i valori della scheda.</p>
    }
    @if(error()){<p role="alert">{{error()}}</p>}
    @if(notice()){<p role="status">{{notice()}}</p>}
  </section>`,
  styles:`:host{display:block;margin:0 0 1.25rem}.system-setting{display:flex;flex-wrap:wrap;gap:.8rem;align-items:end}label{display:grid;gap:.35rem;flex:1 1 18rem;max-width:32rem;font-size:.85rem;min-width:0}select{display:block;width:100%;box-sizing:border-box;font:inherit;color:var(--text-color);background:var(--input-bg);padding:.7rem;border:1px solid var(--panel-border-color);border-radius:.5rem}.system-link{font-size:.85rem;color:var(--muted-color);padding:.7rem 0;text-underline-offset:3px}.actions{display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.8rem}.hint{font-size:.85rem;opacity:.75}`,

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
    try{const r=await fetch('/api/gdr-systems',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'assignSystem',id:a.id,revision:a.revision,systemId:system.id,systemRevision:system.revision})}),data=await r.json();if(!r.ok)throw new Error(data.error||'Cambio sistema non riuscito.');await this.workspace.load(a.id);if(!this.workspace.available())throw new Error('Il sistema è stato salvato. Ricarica la pagina per rileggere i dati aggiornati.');this.workspace.systemEditing.set(false);this.notice.set('Sistema aggiornato.');}catch(e){this.error.set(e instanceof Error?e.message:'Cambio sistema non riuscito.');}finally{this.saving.set(false);}
  }
}
