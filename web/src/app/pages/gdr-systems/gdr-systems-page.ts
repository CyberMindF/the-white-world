import {Component,OnInit,computed,inject,signal} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {ActivatedRoute,RouterLink} from '@angular/router';
import {GdrManagementShell} from '../../shared/gdr-management/gdr-management-shell';
import {AuthService} from '../../core/auth.service';
import {SafeModeService} from '../../core/safe-mode.service';
import {SystemSheetField} from '../../core/gdr-workspace.service';
import {GdrBlocks} from '../../shared/gdr-blocks/gdr-blocks';
import {GdrReferenceBlock,referenceRows} from '../../shared/gdr-blocks/gdr-block.types';
import {parseGdrMarkdown} from '../../shared/gdr-blocks/gdr-markdown.parser';
import {serializeGdrBlocks} from '../../shared/gdr-blocks/gdr-markdown.serializer';
export interface GameSystem {
  id:string;name:string;description:string;fields:SystemSheetField[];statBudget:number;revision:number|null;
  ruleIds:string[];powerIds:string[];adventureIds:string[];
}
interface Rule {id:string;title:string;blocks:GdrReferenceBlock[];revision:number|null;systemIds:string[];}
interface Power {id:string;name:string;kind:'ability'|'spell';description:string;}
const newSystem=():GameSystem=>({id:crypto.randomUUID(),name:'',description:'',fields:[],statBudget:12,revision:null,ruleIds:[],powerIds:[],adventureIds:[]});
const newRule=():Rule=>({id:crypto.randomUUID(),title:'',blocks:[],revision:null,systemIds:[]});

@Component({
  selector:'app-gdr-systems-page',standalone:true,imports:[FormsModule,RouterLink,GdrManagementShell,GdrBlocks],
  templateUrl:'./gdr-systems-page.html',styleUrl:'./gdr-systems-page.css',
})
export class GdrSystemsPage implements OnInit {
  private readonly auth=inject(AuthService);
  private readonly safe=inject(SafeModeService);
  private readonly route=inject(ActivatedRoute);
  protected readonly canManage=computed(()=>this.auth.isAdmin()&&this.auth.adminModeEnabled()&&!this.auth.currentUser()?.isTest&&!this.safe.enabled());
  protected readonly systems=signal<GameSystem[]>([]);
  protected readonly rules=signal<Rule[]>([]);
  protected readonly powers=signal<Power[]>([]);
  protected readonly adventures=signal<{id:string;title:string}[]>([]);
  protected readonly loading=signal(true);
  protected readonly saving=signal(false);
  protected readonly error=signal('');
  protected readonly notice=signal('');
  protected readonly mode=signal<'systems'|'rules'>(this.route.snapshot.data['managementSection']==='rules'?'rules':'systems');
  protected readonly section=signal<'rules'|'sheet'|'powers'>('rules');
  protected readonly dirty=signal(false);
  protected readonly ruleDirty=signal(false);
  protected readonly ruleEditorOpen=signal(false);
  protected readonly search=signal('');
  protected readonly ruleSearch=signal('');
  protected readonly powerSearch=signal('');
  protected readonly ruleSource=signal('');
  protected readonly parsed=computed(()=>parseGdrMarkdown(this.ruleSource()));
  protected readonly filteredSystems=computed(()=>this.systems().filter(s=>(s.name+' '+s.description).toLocaleLowerCase('it').includes(this.search().trim().toLocaleLowerCase('it'))));
  protected readonly filteredRules=computed(()=>this.rules().filter(r=>(r.title+' '+JSON.stringify(r.blocks)).toLocaleLowerCase('it').includes(this.search().trim().toLocaleLowerCase('it'))));
  protected readonly availableRules=computed(()=>this.rules().filter(r=>(r.title+' '+JSON.stringify(r.blocks)).toLocaleLowerCase('it').includes(this.ruleSearch().trim().toLocaleLowerCase('it'))));
  protected readonly filteredPowers=computed(()=>this.powers().filter(p=>(p.name+' '+p.description).toLocaleLowerCase('it').includes(this.powerSearch().trim().toLocaleLowerCase('it'))));
  protected readonly referenceRows=referenceRows;
  protected draft:GameSystem=newSystem();
  protected ruleDraft:Rule=newRule();
  canLeave():boolean{return !this.dirty()&&!this.ruleDirty()&&!this.saving();}
  async ngOnInit():Promise<void>{
    try{
      await this.refresh();
      const requested=this.route.snapshot.queryParamMap.get('system') ?? this.lastSystem();
      this.selectSystem(this.systems().find(s=>s.id===requested)??this.systems()[0]??newSystem());
      if(this.route.snapshot.queryParamMap.get('sezione')==='scheda')this.section.set('sheet');
      const requestedRule=this.rules().find(r=>r.id===this.route.snapshot.queryParamMap.get('rule'));
      if(this.mode()==='rules'&&requestedRule)this.editRule(requestedRule);
    }catch(error){this.fail(error);}finally{this.loading.set(false);}
  }
  private fail(error:unknown):void{this.error.set(error instanceof Error?error.message:'Non è stato possibile completare l’operazione.');}
  private async refresh():Promise<void>{
    const response=await fetch('/api/gdr-systems',{credentials:'same-origin'}),data=await response.json();
    if(!response.ok)throw new Error(data.error||'Sistemi non disponibili.');
    this.systems.set(data.systems);this.rules.set(data.rules);this.powers.set(data.powers);this.adventures.set(data.adventures);
  }
  protected change():void{this.dirty.set(true);this.notice.set('');this.error.set('');}
  protected ruleChange():void{this.ruleDirty.set(true);this.notice.set('');this.error.set('');}
  private get selectionKey():string{return 'gdr-management-system-'+(this.auth.currentUser()?.id??'');}
  private lastSystem():string|null{try{return sessionStorage.getItem(this.selectionKey);}catch{return null;}}
  private rememberSystem():void{try{sessionStorage.setItem(this.selectionKey,this.draft.id);}catch{/* Preferenza facoltativa. */}}
  protected selectSystem(system:GameSystem):void{
    if(!this.canLeave())return;
    this.draft=structuredClone(system);if(this.mode()==='systems'&&system.revision!==null)this.rememberSystem();this.ruleEditorOpen.set(false);this.error.set('');
  }
  protected createSystem(copy?:GameSystem):void{
    if(!this.canLeave())return;
    this.draft=copy?{...structuredClone(copy),id:crypto.randomUUID(),name:('Copia di '+copy.name).slice(0,160),revision:null,adventureIds:[]}:newSystem();
    this.mode.set('systems');this.ruleEditorOpen.set(false);this.change();
  }
  protected rule(id:string):Rule|undefined{return this.rules().find(r=>r.id===id);}
  protected systemName(id:string):string{return this.systems().find(s=>s.id===id)?.name??id;}
  protected adventureName(id:string):string{return this.adventures().find(a=>a.id===id)?.title??id;}
  protected attachRule(id:string):void{if(!this.draft.ruleIds.includes(id)){this.draft.ruleIds=[...this.draft.ruleIds,id];this.change();}}
  protected removeRule(id:string):void{this.draft.ruleIds=this.draft.ruleIds.filter(value=>value!==id);this.change();}
  protected moveRule(index:number,delta:number):void{const target=index+delta;if(target<0||target>=this.draft.ruleIds.length)return;[this.draft.ruleIds[index],this.draft.ruleIds[target]]=[this.draft.ruleIds[target],this.draft.ruleIds[index]];this.change();}
  protected togglePower(id:string,checked:boolean):void{this.draft.powerIds=checked?[...this.draft.powerIds,id]:this.draft.powerIds.filter(value=>value!==id);this.change();}
  protected toggleRuleSystem(id:string,checked:boolean):void{
    this.ruleDraft.systemIds=checked?[...this.ruleDraft.systemIds,id]:this.ruleDraft.systemIds.filter(value=>value!==id);this.ruleChange();
  }
  protected editRule(rule?:Rule,copy=false):void{
    if(this.ruleDirty()||this.saving())return;
    this.ruleDraft=rule?{...structuredClone(rule),...(copy?{id:crypto.randomUUID(),title:('Copia di '+rule.title).slice(0,160),revision:null,systemIds:[]}: {})}:newRule();
    this.ruleSource.set(serializeGdrBlocks(referenceRows(this.ruleDraft.blocks)));
    this.ruleDirty.set(!rule||copy);this.ruleEditorOpen.set(true);this.error.set('');
  }
  protected closeRule():void{if(this.saving())return;this.ruleDirty.set(false);this.ruleEditorOpen.set(false);this.error.set('');}
  protected addField():void{
    this.draft.fields.push({key:'field'+crypto.randomUUID().replaceAll('-',''),label:'',type:'text',role:'field',default:''});this.change();
  }
  protected fieldType(field:SystemSheetField):void{
    if(field.type==='number'){field.min=0;field.max=10;field.default=0;}else{field.role='field';field.default='';delete field.min;delete field.max;}
    this.change();
  }
  protected removeField(index:number):void{this.draft.fields.splice(index,1);this.change();}
  protected copySheet(id:string):void{const source=this.systems().find(s=>s.id===id);if(!source)return;this.draft.fields=structuredClone(source.fields);this.draft.statBudget=source.statBudget;this.change();}
  protected async cancel():Promise<void>{
    if(this.saving())return;
    try{await this.refresh();this.dirty.set(false);this.ruleDirty.set(false);this.selectSystem(this.systems().find(s=>s.id===this.draft.id)??this.systems()[0]??newSystem());this.notice.set('');}catch(error){this.fail(error);}
  }
  private async write(body:object):Promise<void>{
    const response=await fetch('/api/gdr-systems',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'Salvataggio non riuscito.');
  }
  protected async saveSystem():Promise<void>{
    if(!this.canManage()||this.saving()||!this.dirty())return;
    this.saving.set(true);this.error.set('');
    try{
      await this.write({action:'saveSystem',...this.draft});await this.refresh();
      this.draft=structuredClone(this.systems().find(s=>s.id===this.draft.id)!);this.rememberSystem();this.dirty.set(false);this.notice.set('Sistema salvato. Le avventure collegate usano le sue regole e la sua scheda.');
    }catch(error){this.fail(error);}finally{this.saving.set(false);}
  }
  protected async saveRule():Promise<void>{
    if(!this.canManage()||this.saving()||!this.ruleDirty()||this.parsed().errors.length)return;
    this.saving.set(true);this.error.set('');
    try{
      const id=this.ruleDraft.id;
      await this.write({action:'saveRule',id,title:this.ruleDraft.title,revision:this.ruleDraft.revision,blocks:this.parsed().blocks,systemIds:this.ruleDraft.systemIds});await this.refresh();
      this.ruleDraft=structuredClone(this.rules().find(r=>r.id===id)!);this.ruleDirty.set(false);
      this.notice.set('Regola salvata.');
    }catch(error){this.fail(error);}finally{this.saving.set(false);}
  }
}
