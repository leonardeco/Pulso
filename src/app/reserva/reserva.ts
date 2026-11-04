import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { etiquetaFecha, horasLibres, hoyISO, pesos, sumarDias } from '../modelos';
import { PulsoService } from '../pulso.service';

@Component({
  selector: 'app-reserva',
  imports: [FormsModule],
  templateUrl: './reserva.html',
})
export class Reserva {
  readonly pulso = inject(PulsoService);
  readonly etiqueta = etiquetaFecha;
  readonly pesos = pesos;
  readonly dias = Array.from({ length: 14 }, (_, indice) => sumarDias(hoyISO(), indice));

  servicioId = signal(this.pulso.estado().servicios[0]?.id ?? '');
  fecha = signal(hoyISO());
  hora = signal('');
  nombre = '';
  telefono = '';
  correo = '';
  error = signal('');
  lista = signal(false);
  horaConfirmada = signal('');
  fechaConfirmada = signal('');

  libres() {
    return horasLibres(this.pulso.estado(), this.fecha(), this.servicioId());
  }

  elegirServicio(id: string) {
    this.servicioId.set(id);
    this.hora.set('');
  }

  elegirDia(dia: string) {
    this.fecha.set(dia);
    this.hora.set('');
  }

  numeroDia(iso: string) {
    return Number(iso.slice(-2));
  }

  confirmar() {
    if (!this.servicioId() || !this.hora()) {
      this.error.set('Elige un servicio y una hora.');
      return;
    }
    if (!this.nombre.trim() || !this.telefono.trim()) {
      this.error.set('El nombre y el teléfono son obligatorios.');
      return;
    }
    if (!horasLibres(this.pulso.estado(), this.fecha(), this.servicioId()).includes(this.hora())) {
      this.error.set('Esa hora ya no está libre.');
      this.hora.set('');
      return;
    }
    const hora = this.hora();
    const fecha = this.fecha();
    this.pulso.reservar({
      servicioId: this.servicioId(),
      fecha,
      hora,
      nombre: this.nombre,
      telefono: this.telefono,
      correo: this.correo,
    });
    this.nombre = '';
    this.telefono = '';
    this.correo = '';
    this.hora.set('');
    this.error.set('');
    this.horaConfirmada.set(hora);
    this.fechaConfirmada.set(fecha);
    this.lista.set(true);
  }
}
