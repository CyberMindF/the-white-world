import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { AuthService } from './core/auth.service';
import { SafeModeService } from './core/safe-mode.service';
import { RealtimeService } from './core/realtime.service';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false
      })
    });

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])]
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the shared atmosphere and router outlet', async () => {
    const fixture = TestBed.createComponent(App);
    TestBed.inject(SafeModeService).apply(false);
    fixture.detectChanges();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('app-world-stars')).toBeTruthy();
    expect(compiled.querySelector('router-outlet')).toBeTruthy();
  });
  it('shows an exit banner and connects as the impersonated user',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockImplementation(()=>Promise.resolve(Response.json({}))));
    try {
      const fixture=TestBed.createComponent(App),auth=TestBed.inject(AuthService);
      const connect=vi.spyOn(TestBed.inject(RealtimeService),'connect');
      auth.impersonation.set({actorId:1,actorNickname:'Rory',readOnly:false});
      auth.currentUser.set({id:2,nickname:'Desy',email:'test@example.test',identity:'lei',role:'member',isTest:false});
      fixture.detectChanges();await fixture.whenStable();
      expect(fixture.nativeElement.querySelector('.impersonation-banner').textContent).toContain('Stai impersonando Desy');
      expect(fixture.nativeElement.querySelector('.impersonation-banner').textContent).toContain('Torna al tuo account');
      expect(fixture.nativeElement.querySelector('.impersonation-banner').textContent).toContain('salvati sul suo account');
      expect(connect).toHaveBeenCalled();
    }finally{vi.unstubAllGlobals();}
  });

});
