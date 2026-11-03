import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../core/auth.service';
import { SafeModeService } from '../../core/safe-mode.service';
import { CarteBustineService } from '../../core/carte-bustine.service';
import { WorldDiscovery } from '../../shared/world-discovery/world-discovery';
import { Novita } from './novita';

class NewsPage extends Novita {
  read(){return this.load();}
  seen(){return this.updates()[0]?.seen;}
}
class Discovery extends WorldDiscovery {
  seed(){this.updates.set([{id:'1',kind:'contenuto',emoji:'✨',title:'Nuovo capitolo',body:'',route:null,ctaLabel:null,publishedAt:'2026-11-01',safe:true,seen:false}]);this.updateModalOpen.set(true);}
  close(){this.closeUpdates();}
  isOpen(){return this.updateModalOpen();}
}
function setup(impersonating:boolean){
  TestBed.configureTestingModule({providers:[
    {provide:AuthService,useValue:{impersonation:signal(impersonating?{actorId:1,actorNickname:'Rory',readOnly:false}:null),currentUser:signal({id:2}),isAdmin:signal(false),adminModeEnabled:signal(false)}},
    {provide:SafeModeService,useValue:{enabled:signal(true)}},
    {provide:CarteBustineService,useValue:{}},{provide:Router,useValue:{url:'/profilo'}},
  ]});
  const fetchMock=vi.fn().mockImplementation(()=>Promise.resolve(Response.json({updates:[{id:'1',kind:'contenuto',active:true,safe:true,seen:false}]})));
  vi.stubGlobal('fetch',fetchMock);return fetchMock;
}
describe('lettura delle novità durante impersonazione',()=>{
  afterEach(()=>{TestBed.resetTestingModule();vi.unstubAllGlobals();});
  it('mostra le novità senza consumarle e permette di chiudere la modale senza confermarne la lettura',async()=>{
    const fetchMock=setup(true),page=TestBed.runInInjectionContext(()=>new NewsPage());
    await page.read();expect(page.seen()).toBe(false);
    const discovery=TestBed.runInInjectionContext(()=>new Discovery());discovery.seed();discovery.close();expect(discovery.isOpen()).toBe(false);
    expect(fetchMock.mock.calls.map(c=>c[0])).toEqual(['/api/world-updates']);
  });
  it('dal vero account la pagina e la modale continuano a confermare la lettura',async()=>{
    const fetchMock=setup(false),page=TestBed.runInInjectionContext(()=>new NewsPage());
    await page.read();expect(page.seen()).toBe(true);
    const discovery=TestBed.runInInjectionContext(()=>new Discovery());discovery.seed();discovery.close();
    expect(fetchMock.mock.calls.map(c=>c[0])).toEqual(['/api/world-updates','/api/world-updates/seen','/api/world-updates/seen']);
  });
});
