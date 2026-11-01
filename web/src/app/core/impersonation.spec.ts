import {TestBed} from '@angular/core/testing';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {AuthService} from './auth.service';
import {ApiService} from './api.service';
describe('accesso durante impersonazione',()=>{
 afterEach(()=>{vi.unstubAllGlobals();TestBed.resetTestingModule();sessionStorage.clear();});
 it('conserva lo sblocco dell’admin quando la sessione assume l’identità della giocatrice',async()=>{
  TestBed.configureTestingModule({providers:[AuthService,ApiService]});const auth=TestBed.inject(AuthService);
  auth.rememberAccessUnlock(1);
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({authenticated:true,user:{id:2,nickname:'Desy',role:'member'},adminModeEnabled:false,impersonation:{actorId:1,actorNickname:'Rory',readOnly:true}})));
  const data=await auth.loadAuthSession();expect(data.user?.id).toBe(2);expect(auth.impersonation()?.readOnly).toBe(true);expect(auth.isAccessUnlocked(2)).toBe(true);
  auth.touchAccessUnlock(2);auth.impersonation.set(null);expect(auth.isAccessUnlocked(1)).toBe(true);expect(auth.isAccessUnlocked(2)).toBe(false);
 });
});
