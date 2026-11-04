import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SesionService } from './sesion.service';

function casa() {
  const sesion = inject(SesionService);
  const router = inject(Router);
  return router.createUrlTree([sesion.esCliente() ? '/mi-plan' : '/']);
}

export const authGuard: CanActivateFn = () => {
  const sesion = inject(SesionService);
  if (!sesion.activa()) return inject(Router).createUrlTree(['/entrar']);
  return true;
};

export const entrenadorGuard: CanActivateFn = () => {
  const sesion = inject(SesionService);
  if (!sesion.activa()) return inject(Router).createUrlTree(['/entrar']);
  if (sesion.esCliente()) return casa();
  return true;
};

export const clienteGuard: CanActivateFn = () => {
  const sesion = inject(SesionService);
  if (!sesion.activa()) return inject(Router).createUrlTree(['/entrar']);
  if (!sesion.esCliente()) return casa();
  return true;
};

export const adminGuard: CanActivateFn = () => {
  const sesion = inject(SesionService);
  if (!sesion.activa()) return inject(Router).createUrlTree(['/entrar']);
  if (!sesion.esAdmin()) return inject(Router).createUrlTree(['/']);
  return true;
};

export const invitadoGuard: CanActivateFn = () => {
  const sesion = inject(SesionService);
  if (!sesion.activa()) return true;
  return casa();
};
