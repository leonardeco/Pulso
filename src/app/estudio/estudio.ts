import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { modalidadDe, nombreModalidad, pesos, type Estado, type Modalidad } from '../modelos';
import { PulsoService } from '../pulso.service';
import { SesionService } from '../sesion.service';

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
  private readonly sesion = inject(SesionService);
  private readonly pulso = inject(PulsoService);
  readonly pesos = pesos;

  lista(): FilaEntrenador[] {
    const propio = this.sesion.estudioId();
    const vivo = this.pulso.estado();
    return this.sesion
      .entrenadores()
      .map((cuenta) => fila(cuenta, cuenta.id === propio ? vivo : cuenta.estado))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
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

function fila(
  cuenta: { id: string; nombre: string; correo: string },
  estado: Estado | null,
): FilaEntrenador {
  const clientes = estado?.clientes ?? [];
  const rutinas = (estado?.rutinas ?? []).map((rutina) => {
    const cliente = clientes.find((item) => item.id === rutina.clienteId);
    return {
      id: rutina.id,
      nombre: rutina.nombre || 'Rutina',
      cliente: cliente?.nombre || 'Plantilla',
      modalidad: cliente ? nombreModalidad(cliente.modalidad) : 'Plantilla',
      precio: Number(rutina.precio) || 0,
    };
  });
  return {
    id: cuenta.id,
    nombre: cuenta.nombre || 'Entrenador',
    correo: cuenta.correo,
    rutinas,
    total: rutinas.reduce((suma, item) => suma + item.precio, 0),
    personalizados: clientes.filter((item) => modalidadDe(item.modalidad) === 'personalizado').length,
    semipersonalizados: clientes.filter((item) => modalidadDe(item.modalidad) === 'semipersonalizado').length,
    virtuales: clientes.filter((item) => modalidadDe(item.modalidad) === 'virtual').length,
  };
}
