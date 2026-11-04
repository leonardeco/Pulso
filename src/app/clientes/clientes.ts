import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MODALIDADES, nombreModalidad, type Modalidad } from '../modelos';
import { PulsoService } from '../pulso.service';

@Component({
  selector: 'app-clientes',
  imports: [FormsModule, RouterLink],
  templateUrl: './clientes.html',
})
export class Clientes {
  private readonly pulso = inject(PulsoService);
  private readonly router = inject(Router);
  readonly estado = this.pulso.estado;
  readonly busqueda = signal('');
  readonly formulario = signal(false);
  readonly error = signal('');
  readonly modalidades = MODALIDADES;
  readonly nombreModalidad = nombreModalidad;
  nombre = '';
  telefono = '';
  correo = '';
  objetivo = '';
  modalidad: Modalidad = 'personalizado';

  lista() {
    const texto = this.busqueda().trim().toLowerCase();
    return this.estado().clientes.filter((cliente) => {
      if (!texto) return true;
      return [cliente.nombre, cliente.telefono, cliente.objetivo, nombreModalidad(cliente.modalidad)].join(' ').toLowerCase().includes(texto);
    });
  }

  texto(evento: Event) {
    return (evento.target as HTMLInputElement).value;
  }

  iniciales(nombre: string) {
    return nombre
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((parte) => parte[0]?.toUpperCase())
      .join('');
  }

  guardar() {
    if (!this.nombre.trim() || !this.telefono.trim()) {
      this.error.set('Nombre y teléfono son obligatorios.');
      return;
    }
    const id = this.pulso.agregarCliente({
      nombre: this.nombre,
      telefono: this.telefono,
      correo: this.correo,
      objetivo: this.objetivo,
      modalidad: this.modalidad,
    });
    this.nombre = '';
    this.telefono = '';
    this.correo = '';
    this.objetivo = '';
    this.modalidad = 'personalizado';
    this.error.set('');
    this.formulario.set(false);
    void this.router.navigate(['/clientes', id]);
  }
}
