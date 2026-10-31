import { Routes } from '@angular/router';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { SafeModeService, isSafeRoute } from './core/safe-mode.service';
import { authGuard } from './core/auth.guard';
import { adminGuard } from './core/admin.guard';
import { adminModeGuard } from './core/admin-mode.guard';
import { Portone } from './portone/portone';

// Struttura route: '/login' è il Portone (pagina di accesso). Le pagine protette stanno sotto
// un gruppo con un'unica guardia condivisa (authGuard) ma NESSUN componente shell in comune:
// ogni pagina include <app-shell> con i propri @Input (vedi pages/mondo-bianco), replicando
// come nell'originale ogni pagina generasse la propria shell completa invece di condividerne
// una sola tra tutte le navigazioni. '/' (root) è il Mondo Bianco stesso — pathMatch 'full'
// essenziale sul child vuoto, senza matcherebbe come prefisso anche le altre route protette
// sotto, impedendo loro di attivarsi.
//
// loadComponent (lazy) invece di component (eager) per tutte le pagine protette. Il Portone
// resta eager: è la prima cosa che vede chi non ha ancora una sessione valida (authGuard
// reindirizza lì), niente da guadagnare a caricarlo pigro.
export const routes: Routes = [
  {
    path: 'login',
    pathMatch: 'full',
    component: Portone,
    data: { bodyClasses: ['access-locked', 'portone-page'] },
  },
  {
    path: '',
    canActivate: [authGuard],
    canActivateChild: [(_route, state) => !inject(SafeModeService).enabled() || isSafeRoute(state.url)
      ? true : inject(Router).createUrlTree(['/'])],
    children: [
      {
        path: '',
        pathMatch: 'full',
        data: { bodyClasses: ['world-page'] },
        loadComponent: () => import('./pages/mondo-bianco/mondo-bianco').then((m) => m.MondoBianco),
      },
      {
        path: 'mondo-bianco',
        redirectTo: '',
        pathMatch: 'full',
      },
      {
        path: 'ponti',
        data: { bodyClasses: ['ponti-page'] },
        loadComponent: () => import('./pages/ponti/ponti').then((m) => m.Ponti),
      },
      {
        path: 'calendario',
        data: { bodyClasses: ['calendar-page'] },
        loadComponent: () => import('./pages/calendario/calendario').then((m) => m.Calendario),
      },
      {
        path: 'cuffiette',
        data: { bodyClasses: ['music-page'] },
        loadComponent: () => import('./pages/cuffiette/cuffiette').then((m) => m.Cuffiette),
      },
      {
        path: 'suggerimenti',
        data: { bodyClasses: ['suggerimenti-page'] },
        loadComponent: () =>
          import('./pages/suggerimenti/suggerimenti').then((m) => m.Suggerimenti),
      },
      {
        path: 'profilo',
        data: { bodyClasses: ['profilo-page'] },
        loadComponent: () => import('./pages/profilo/profilo').then((m) => m.Profilo),
      },
      {
        path: 'amministrazione',
        canActivate: [adminGuard],
        data: { bodyClasses: ['amministrazione-page'] },
        loadComponent: () => import('./pages/amministrazione/amministrazione').then((m) => m.Amministrazione),
      },
      {
        path: 'contatore-amore',
        canActivate: [adminGuard],
        loadComponent: () => import('./pages/contatore-amore/contatore-amore').then((m) => m.ContatoreAmore),
      },
      {
        path: 'novita',
        data: { bodyClasses: ['novita-page'] },
        loadComponent: () => import('./pages/novita/novita').then((m) => m.Novita),
      },
      {
        path: 'log',
        canActivate: [adminGuard],
        data: { bodyClasses: ['log-page'] },
        loadComponent: () => import('./pages/log/log').then((m) => m.Log),
      },
      {
        path: 'contenuti',
        canActivate: [adminGuard],
        data: { bodyClasses: ['contenuti-page'] },
        loadComponent: () => import('./pages/contenuti/contenuti').then((m) => m.Contenuti),
      },
      {
        path: 'il-cielo',
        data: { bodyClasses: ['sky-view-page'] },
        loadComponent: () => import('./pages/il-cielo/il-cielo').then((m) => m.IlCielo),
      },
      {
        path: 'impostazioni-mondo',
        data: { bodyClasses: ['impostazioni-mondo-page'] },
        loadComponent: () =>
          import('./pages/impostazioni-mondo/impostazioni-mondo').then((m) => m.ImpostazioniMondo),
      },
      {
        path: 'linguaggio-segreto',
        data: { bodyClasses: ['linguaggio-page'] },
        loadComponent: () =>
          import('./pages/linguaggio-segreto/linguaggio-segreto').then((m) => m.LinguaggioSegreto),
      },
      {
        path: 'storie',
        data: { bodyClasses: ['stories-page'] },
        loadComponent: () => import('./pages/storie/storie').then((m) => m.Storie),
      },
      {
        path: 'mappa',
        data: { bodyClasses: ['map-page'] },
        loadComponent: () => import('./pages/mappa/mappa').then((m) => m.Mappa),
      },
      {
        path: 'mappamondo',
        data: { bodyClasses: ['globe-page'] },
        loadComponent: () => import('./pages/mappamondo/mappamondo').then((m) => m.Mappamondo),
      },
      {
        path: 'bacheca',
        data: { bodyClasses: ['bacheca-page'] },
        loadComponent: () =>
          import('./pages/bacheca-preview/bacheca-preview').then((m) => m.BachecaPreview),
      },
      {
        path: 'bacheca-nuova',
        redirectTo: 'bacheca',
        pathMatch: 'full',
      },
      {
        path: 'lettere',
        data: { bodyClasses: ['lettere-page'] },
        loadComponent: () => import('./pages/lettere/lettere').then((m) => m.Lettere),
      },
      {
        path: 'domande',
        data: { bodyClasses: ['domande-page'] },
        loadComponent: () => import('./pages/domande/domande').then((m) => m.Domande),
      },
      {
        path: 'barattolo-dei-pensieri',
        loadComponent: () =>
          import('./pages/barattolo-dei-pensieri/barattolo-dei-pensieri').then(
            (m) => m.BarattoloDeiPensieri,
          ),
      },
      {
        path: 'capsula-del-tempo',
        loadComponent: () =>
          import('./pages/capsula-del-tempo/capsula-del-tempo').then((m) => m.CapsulaDelTempo),
      },
      {
        path: 'ponti-chat',
        data: { bodyClasses: ['ponti-chat-page'] },
        loadComponent: () => import('./pages/ponti-chat/ponti-chat').then((m) => m.PontiChat),
      },
      {
        path: 'fake-omegle',
        data: { bodyClasses: ['stranger-chat-page'] },
        loadComponent: () =>
          import('./pages/stranger-chat/stranger-chat').then((m) => m.StrangerChat),
      },
      {
        path: 'stranger-chat',
        redirectTo: 'fake-omegle',
        pathMatch: 'full',
      },
      {
        path: 'cose-da-fare-insieme',
        data: { bodyClasses: ['together-page-view'] },
        loadComponent: () => import('./pages/cose-insieme/cose-insieme').then((m) => m.CoseInsieme),
      },
      {
        path: 'ricettario',
        data: { bodyClasses: ['recipe-page-view'] },
        loadComponent: () => import('./pages/ricettario/ricettario').then((m) => m.Ricettario),
      },
      {
        path: 'aula-studio/quiz/:id',
        data: { bodyClasses: ['aula-studio-page'] },
        loadComponent: () => import('./pages/aula-studio/study-quiz').then((m) => m.StudyQuiz),
      },
      {
        path: 'aula-studio/quiz-misto/:id',
        data: { bodyClasses: ['aula-studio-page'], mixedQuiz: true },
        loadComponent: () => import('./pages/aula-studio/study-quiz').then((m) => m.StudyQuiz),
      },
      {
        path: 'aula-studio',
        data: { bodyClasses: ['aula-studio-page'] },
        loadComponent: () => import('./pages/aula-studio/aula-studio').then((m) => m.AulaStudio),
      },
      {
        path: 'tavolo-da-gioco',
        data: { bodyClasses: ['tavolo-page'] },
        loadComponent: () =>
          import('./pages/tavolo-da-gioco/tavolo-da-gioco').then((m) => m.TavoloDaGioco),
      },
      {
        path: 'tavolo-da-gioco/trappole',
        data: { bodyClasses: ['tavolo-page'], game: 'trappole' },
        loadComponent: () => import('./pages/giochi-due/giochi-due').then((m) => m.GiochiDue),
      },
      {
        path: 'tavolo-da-gioco/frequenze/prova',
        canActivate: [adminGuard],
        data: { bodyClasses: ['tavolo-page'] },
        loadComponent: () => import('./pages/giochi-due/frequenze-prova').then((m) => m.FrequenzeProva),
      },
      {
        path: 'tavolo-da-gioco/frequenze',
        data: { bodyClasses: ['tavolo-page'], game: 'frequenze' },
        loadComponent: () => import('./pages/giochi-due/giochi-due').then((m) => m.GiochiDue),
      },
      {
        path: 'tavolo-da-gioco/animali',
        data: { bodyClasses: ['tavolo-page'], game: 'nuvola' },
        loadComponent: () => import('./pages/giochi-due/giochi-due').then((m) => m.GiochiDue),
      },
      {
        path: 'tavolo-da-gioco/piccole-avventure',
        data: { bodyClasses: ['tavolo-page'] },
        loadComponent: () => import('./pages/giochi-due/giochi-due').then((m) => m.GiochiDue),
      },
      {
        path: 'tavolo-da-gioco/gdr/laboratorio',
        data: { bodyClasses: ['tavolo-page'] },
        loadComponent: () => import('./pages/gdr-laboratorio/gdr-laboratorio').then((m) => m.GdrLaboratorio),
      },
      {
        path: 'tavolo-da-gioco/gdr/classico',
        data: { bodyClasses: ['tavolo-page'], classic: true },
        loadComponent: () => import('./pages/gdr/gdr').then((m) => m.Gdr),
      },
      {
        path: 'tavolo-da-gioco/gdr/gioca/:adventureId',
        data: { bodyClasses: ['tavolo-page'] },
        loadComponent: () => import('./pages/gdr-laboratorio/gdr-laboratorio').then((m) => m.GdrLaboratorio),
      },
      {
        path: 'tavolo-da-gioco/gdr',
        data: { bodyClasses: ['tavolo-page'] },
        loadComponent: () => import('./pages/gdr/gdr').then((m) => m.Gdr),
      },
      {
        path: 'tavolo-da-gioco/gdr/il-prezzo-della-verita/avventura',
        data: { bodyClasses: ['tavolo-page'] },
        loadComponent: () => import('./pages/avventura/avventura').then((m) => m.Avventura),
      },
      {
        path: 'tavolo-da-gioco/gdr/la-casa-che-trattiene-il-respiro',
        data: { bodyClasses: ['tavolo-page'] },
        loadComponent: () =>
          import('./pages/la-casa-che-trattiene-il-respiro/la-casa-che-trattiene-il-respiro').then(
            (m) => m.LaCasaCheTrattieneIlRespiro,
          ),
      },
      {
        path: 'tavolo-da-gioco/cruciverba',
        loadComponent: () => import('./pages/cruciverba/cruciverba').then((m) => m.Cruciverba),
      },
      {
        path: 'tavolo-da-gioco/messaggio-criptato',
        data: { bodyClasses: ['tavolo-page'] },
        loadComponent: () =>
          import('./pages/messaggio-criptato/messaggio-criptato').then((m) => m.MessaggioCriptato),
      },
      {
        path: 'tavolo-da-gioco/prova-a-dire-no',
        data: { bodyClasses: ['tavolo-page'] },
        loadComponent: () =>
          import('./pages/prova-a-dire-no/prova-a-dire-no').then((m) => m.ProvaADireNo),
      },
      {
        path: 'tavolo-da-gioco/prova-a-dire-no/playground',
        canActivate: [adminGuard],
        data: { bodyClasses: ['tavolo-page'] },
        loadComponent: () =>
          import('./pages/prova-a-dire-no-playground/prova-a-dire-no-playground').then(
            (m) => m.ProvaADireNoPlayground,
          ),
      },
      {
        path: 'tavolo-da-gioco/carte/catalogo',
        canActivate: [adminGuard, adminModeGuard],
        data: { bodyClasses: ['tavolo-page'] },
        loadComponent: () => import('./pages/carte/carte-catalogo').then((m) => m.CarteCatalogo),
      },
      {
        path: 'tavolo-da-gioco/carte',
        data: { bodyClasses: ['tavolo-page'] },
        loadComponent: () => import('./pages/carte/carte').then((m) => m.Carte),
      },
    ],
  },
  {
    path: '**',
    data: { bodyClasses: ['not-found-page'] },
    loadComponent: () => import('./pages/not-found/not-found').then((m) => m.NotFound),
  },
];
