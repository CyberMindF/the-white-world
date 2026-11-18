import {Component,OnInit,computed,inject,signal} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {Router,RouterLink} from '@angular/router';
import {AuthService} from '../../core/auth.service';
import {SafeModeService} from '../../core/safe-mode.service';
import {GdrWorkspaceService} from '../../core/gdr-workspace.service';
import {GdrManagementShell} from '../../shared/gdr-management/gdr-management-shell';

@Component({
  selector:'app-gdr-management',standalone:true,imports:[FormsModule,RouterLink,GdrManagementShell],providers:[GdrWorkspaceService],
  templateUrl:'./gdr-management.html',styleUrl:'./gdr-management.css',
})
export class GdrManagement implements OnInit{
  protected readonly workspace=inject(GdrWorkspaceService);
  private readonly router=inject(Router);
  private readonly auth=inject(AuthService);
  private readonly safe=inject(SafeModeService);
  protected readonly canManage=computed(()=>this.auth.isAdmin()&&this.auth.adminModeEnabled()&&!this.auth.currentUser()?.isTest&&!this.safe.enabled());
  protected readonly loading=signal(true);
  protected readonly error=signal('');
  protected readonly search=signal('');
  protected readonly creating=signal(false);
  protected readonly title=signal('');
  protected readonly systemId=signal('');
  protected readonly systems=signal<{id:string;name:string}[]>([]);
  protected readonly filtered=computed(()=>this.workspace.adventures().filter(a=>
    (a.title+' '+(a.systemName??'')).toLocaleLowerCase('it').includes(this.search().trim().toLocaleLowerCase('it'))));
  private newId=crypto.randomUUID();
  canLeave():boolean{return !this.workspace.saving()&&(!this.creating()||(!this.title().trim()&&!this.systemId()));}
  async ngOnInit():Promise<void>{
    try{
      await this.workspace.load('il-prezzo-della-verita');
      if(!this.workspace.available())throw new Error(this.workspace.error());
      const r=await fetch('/api/gdr-systems',{credentials:'same-origin'}),data=await r.json();
      if(!r.ok)throw new Error(data.error||'Sistemi non disponibili.');
      this.systems.set(data.systems);
    }catch(error){this.error.set(error instanceof Error?error.message:'Gestione non disponibile.');}finally{this.loading.set(false);}
  }
  protected cancel():void{if(this.workspace.saving())return;this.creating.set(false);this.title.set('');this.systemId.set('');this.error.set('');}
  protected async create():Promise<void>{
    if(!this.canManage()||!this.title().trim()||!this.systemId()||this.workspace.saving())return;
    this.error.set('');const id=this.newId;
    if(await this.workspace.save({action:'createAdventure',id,title:this.title().trim(),source:'',systemId:this.systemId()})){
      this.newId=crypto.randomUUID();this.cancel();
      await this.router.navigate(['/tavolo-da-gioco/gdr/gestione',id]);
    }
  }
}
