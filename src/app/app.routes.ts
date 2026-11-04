import { Routes } from '@angular/router';
import { Acceso } from './acceso/acceso';
import { Agenda } from './agenda/agenda';
import { adminGuard, clienteGuard, entrenadorGuard, invitadoGuard } from './auth.guard';
import { Estudio } from './estudio/estudio';
import { Clientes } from './clientes/clientes';
import { Ficha } from './ficha/ficha';
import { Inicio } from './inicio/inicio';
import { MiPlan } from './mi-plan/mi-plan';
import { Recuperar } from './recuperar/recuperar';
import { Reserva } from './reserva/reserva';
import { Rutinas } from './rutinas/rutinas';

export const routes: Routes = [
  { path: 'entrar', component: Acceso, canActivate: [invitadoGuard], data: { registro: false } },
  { path: 'registro', component: Acceso, canActivate: [invitadoGuard], data: { registro: true } },
  { path: 'recuperar', component: Recuperar, canActivate: [invitadoGuard] },
  { path: '', component: Inicio, canActivate: [entrenadorGuard] },
  { path: 'estudio', component: Estudio, canActivate: [adminGuard] },
  { path: 'agenda', component: Agenda, canActivate: [entrenadorGuard] },
  { path: 'reserva', component: Reserva, canActivate: [entrenadorGuard] },
  { path: 'rutinas', component: Rutinas, canActivate: [entrenadorGuard] },
  { path: 'clientes', component: Clientes, canActivate: [entrenadorGuard] },
  { path: 'clientes/:id', component: Ficha, canActivate: [entrenadorGuard] },
  { path: 'mi-plan', component: MiPlan, canActivate: [clienteGuard] },
  { path: '**', redirectTo: '' },
];
