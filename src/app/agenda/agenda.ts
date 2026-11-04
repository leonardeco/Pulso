import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DIAS, etiquetaFecha, hoyISO, sumarDias } from '../modelos';
import { PulsoService } from '../pulso.service';

@Component({
  selector: 'app-agenda',
  imports: [RouterLink],
  templateUrl: './agenda.html',
})
export class Agenda {
  readonly pulso = inject(PulsoService);
  readonly diasSemana = DIAS;
  readonly etiqueta = etiquetaFecha;
  readonly fecha = signal(hoyISO());
  readonly dias = Array.from({ length: 7 }, (_, indice) => sumarDias(hoyISO(), indice));

  citas() {
    return this.pulso
      .estado()
      .citas.filter((cita) => cita.fecha === this.fecha())
      .sort((a, b) => a.hora.localeCompare(b.hora));
  }

  cliente(id: string) {
    return this.pulso.estado().clientes.find((item) => item.id === id);
  }

  servicio(id: string) {
    return this.pulso.estado().servicios.find((item) => item.id === id);
  }

  numeroDia(iso: string) {
    return Number(iso.slice(-2));
  }

  corto(iso: string) {
    return etiquetaFecha(iso).split(' ')[0];
  }

  hora(evento: Event) {
    return (evento.target as HTMLInputElement).value;
  }

  bloques(diaId: string) {
    return this.pulso.estado().horario[diaId] ?? [];
  }
}
