import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { EJERCICIOS, imagenEjercicio, nombreModalidad, pesos, type Rutina } from '../modelos';
import { PulsoService } from '../pulso.service';
import { abrirPdf, htmlRutinas } from '../exportar';

@Component({
  selector: 'app-rutinas',
  imports: [FormsModule, RouterLink],
  templateUrl: './rutinas.html',
})
export class Rutinas {
  readonly pulso = inject(PulsoService);
  readonly ejercicios = EJERCICIOS;
  readonly foto = imagenEjercicio;
  readonly pesos = pesos;
  readonly nombreModalidad = nombreModalidad;
  readonly error = signal('');
  readonly abierta = signal<string | null>(null);
  nombre = '';
  clienteId = '';
  precio = 0;

  texto(evento: Event) {
    return (evento.target as HTMLInputElement).value;
  }

  nombreCliente(clienteId: string | null) {
    if (!clienteId) return 'Plantilla';
    return this.pulso.estado().clientes.find((cliente) => cliente.id === clienteId)?.nombre || 'Cliente';
  }

  modalidadCliente(clienteId: string | null) {
    if (!clienteId) return 'Plantilla';
    const cliente = this.pulso.estado().clientes.find((item) => item.id === clienteId);
    return nombreModalidad(cliente?.modalidad);
  }

  numero(evento: Event) {
    return Math.max(0, Math.round(Number(this.texto(evento)) || 0));
  }

  crear() {
    const clienteId = this.clienteId || null;
    if (!this.nombre.trim() && !clienteId) {
      this.error.set('Escribe el nombre o elige un cliente.');
      return;
    }
    const id = this.pulso.nuevaRutina(clienteId, this.nombre, this.precio);
    this.nombre = '';
    this.clienteId = '';
    this.precio = 0;
    this.error.set('');
    this.abierta.set(id);
  }

  alternar(id: string) {
    this.abierta.update((actual) => (actual === id ? null : id));
  }

  pdf(rutina: Rutina) {
    const titulo = rutina.nombre || 'Rutina';
    abrirPdf(titulo, htmlRutinas(this.nombreCliente(rutina.clienteId), [rutina]));
  }
}
