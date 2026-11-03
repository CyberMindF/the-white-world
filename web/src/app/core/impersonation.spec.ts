import {TestBed} from '@angular/core/testing';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {AuthService} from './auth.service';
import {ApiService} from './api.service';
import {TelemetryService} from './telemetry.service';
import {GlobalChatService} from './global-chat.service';
import {SafeModeService} from './safe-mode.service';
import {RealtimeService} from './realtime.service';
import {signal} from '@angular/core';
import {EMPTY} from 'rxjs';
describe('accesso durante impersonazione',()=>{
 afterEach(()=>{vi.unstubAllGlobals();TestBed.resetTestingModule();sessionStorage.clear();});
 it('conserva lo sblocco dell’admin quando la sessione assume l’identità della giocatrice',async()=>{
  TestBed.configureTestingModule({providers:[AuthService,ApiService]});const auth=TestBed.inject(AuthService);
  auth.rememberAccessUnlock(1);
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({authenticated:true,user:{id:2,nickname:'Desy',role:'member'},adminModeEnabled:false,impersonation:{actorId:1,actorNickname:'Rory',readOnly:false}})));
  const data=await auth.loadAuthSession();expect(data.user?.id).toBe(2);expect(auth.impersonation()?.readOnly).toBe(false);expect(auth.isAccessUnlocked(2)).toBe(true);
  auth.touchAccessUnlock(2);auth.impersonation.set(null);expect(auth.isAccessUnlocked(1)).toBe(true);expect(auth.isAccessUnlocked(2)).toBe(false);
 });
 it('non invia attività o conferme di lettura; dal vero account entrambe restano funzionanti',async()=>{
  TestBed.configureTestingModule({providers:[AuthService,ApiService,TelemetryService,GlobalChatService,
   {provide:SafeModeService,useValue:{enabled:signal(false)}},{provide:RealtimeService,useValue:{on:()=>EMPTY}}
  ]});
  const auth=TestBed.inject(AuthService),telemetry=TestBed.inject(TelemetryService),chat=TestBed.inject(GlobalChatService);
  const fetchMock=vi.fn().mockImplementation(()=>Promise.resolve(Response.json({ok:true})));vi.stubGlobal('fetch',fetchMock);
  auth.impersonation.set({actorId:1,actorNickname:'Rory',readOnly:false});
  await telemetry.trackEvent('gdr','world_page_opened');await chat.markRead();
  expect(fetchMock).not.toHaveBeenCalled();
  auth.impersonation.set(null);
  await telemetry.trackEvent('gdr','world_page_opened');await chat.markRead();
  expect(fetchMock.mock.calls.map(c=>c[0])).toEqual(['/api/telemetry/events','/api/ponti-chat/read']);
 });
});
