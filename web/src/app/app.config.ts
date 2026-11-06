import { reportDiagnostic } from './core/diagnostics';
import { registerLocaleData } from '@angular/common';
import localeIt from '@angular/common/locales/it';
import { ApplicationConfig, LOCALE_ID, provideBrowserGlobalErrorListeners } from '@angular/core';
import {
  NavigationError,
  provideRouter,
  withInMemoryScrolling,
  withNavigationErrorHandler,
} from '@angular/router';

import { routes } from './app.routes';
import { recoverFromLazyChunkError } from './core/lazy-chunk-recovery';

registerLocaleData(localeIt);

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: LOCALE_ID, useValue: 'it-IT' },
    provideRouter(
      routes,
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled', anchorScrolling: 'enabled' }),
      withNavigationErrorHandler((error: NavigationError) => {
        reportDiagnostic('navigation_error', error.error);
        void recoverFromLazyChunkError(error.error);
      }),
    ),
  ],
};
