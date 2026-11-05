import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { nombreModalidad, pesos } from '../modelos';
import { PulsoService } from '../pulso.service';
import { EditorRutina } from '../editor-rutina/editor-rutina';

@Component({
  selector: 'app-rutinas',
  imports: [FormsModule, EditorRutina],
  templateUrl: './rutinas.html',
})
export class Rutinas {
  readonly pulso = inject(PulsoService);
  readonly pesos = pesos;
  readonly nombreModalidad = nombreModalidad;
  readonly error = signal('');
  readonly abierta = signal<string | null>(null);
  nombre = '';
  clienteId = '';
  precio = 0;

  nombreCliente(clienteId: string | null) {
    if (!clienteId) return 'Plantilla';
    return this.pulso.estado().clientes.find((cliente) => cliente.id === clienteId)?.nombre || 'Cliente';
  }

  modalidadCliente(clienteId: string | null) {
    if (!clienteId) return 'Plantilla';
    const cliente = this.pulso.estado().clientes.find((item) => item.id === clienteId);
    return nombreModalidad(cliente?.modalidad);
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
}
