import { Routes } from '@angular/router';
import { Agenda } from './agenda/agenda';
import { Clientes } from './clientes/clientes';
import { Ficha } from './ficha/ficha';
import { Inicio } from './inicio/inicio';
import { Reserva } from './reserva/reserva';

export const routes: Routes = [
  { path: '', component: Inicio },
  { path: 'agenda', component: Agenda },
  { path: 'reserva', component: Reserva },
  { path: 'clientes', component: Clientes },
  { path: 'clientes/:id', component: Ficha },
];
