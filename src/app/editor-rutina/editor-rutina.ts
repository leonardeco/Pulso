import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EJERCICIOS, imagenEjercicio, type Rutina } from '../modelos';
import { PulsoService } from '../pulso.service';
import { abrirPdf, htmlRutinas } from '../exportar';

@Component({
  selector: 'app-editor-rutina',
  imports: [RouterLink],
  templateUrl: './editor-rutina.html',
  host: { style: 'display: contents' },
})
export class EditorRutina {
  readonly pulso = inject(PulsoService);
  readonly rutina = input.required<Rutina>();
  readonly enlaceFicha = input(false);
  readonly ejercicios = EJERCICIOS;
  readonly foto = imagenEjercicio;
  readonly idLista = computed(() => `ejercicios-${this.rutina().id}`);

  texto(evento: Event) {
    return (evento.target as HTMLInputElement).value;
  }

  numero(evento: Event) {
    return Math.max(0, Math.round(Number(this.texto(evento)) || 0));
  }

  pdf() {
    const rutina = this.rutina();
    const cliente = rutina.clienteId
      ? this.pulso.estado().clientes.find((item) => item.id === rutina.clienteId)?.nombre || 'Cliente'
      : 'Plantilla';
    abrirPdf(rutina.nombre || 'Rutina', htmlRutinas(cliente, [rutina]));
  }
}
