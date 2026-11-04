import { Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { pedir } from '../api';
import { pesos, type Modalidad } from '../modelos';

interface FilaRutina {
  id: string;
  nombre: string;
  cliente: string;
  modalidad: string;
  precio: number;
}

interface FilaEntrenador {
  id: string;
  nombre: string;
  correo: string;
  rutinas: FilaRutina[];
  total: number;
  personalizados: number;
  semipersonalizados: number;
  virtuales: number;
}

@Component({
  selector: 'app-estudio',
  imports: [RouterLink],
  templateUrl: './estudio.html',
})
export class Estudio {
  readonly pesos = pesos;
  readonly filas = signal<FilaEntrenador[]>([]);
  readonly error = signal('');

  constructor() {
    void pedir<{ entrenadores: FilaEntrenador[] }>('GET', '/api/panel').then((r) => {
      if (r.ok) this.filas.set(r.datos.entrenadores ?? []);
      else this.error.set(r.error);
    });
  }

  lista(): FilaEntrenador[] {
    return this.filas();
  }

  entrenadores() {
    return this.lista().length;
  }

  rutinas() {
    return this.lista().reduce((suma, item) => suma + item.rutinas.length, 0);
  }

  precios() {
    return this.lista().reduce((suma, item) => suma + item.total, 0);
  }

  clientes(tipo: Modalidad) {
    return this.lista().reduce((suma, item) => {
      if (tipo === 'personalizado') return suma + item.personalizados;
      if (tipo === 'semipersonalizado') return suma + item.semipersonalizados;
      return suma + item.virtuales;
    }, 0);
  }
}
