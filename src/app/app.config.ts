import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { PulsoService } from './pulso.service';
import { SesionService } from './sesion.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideAppInitializer(async () => {
      const s = inject(SesionService);
      const p = inject(PulsoService);
      await s.iniciar();
      if (s.activa()) await p.cargar();
    }),
  ],
};
