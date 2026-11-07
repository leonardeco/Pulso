import { Component, computed, inject } from '@angular/core';
import { etiquetaFecha, hoyISO, sumarDias } from '../modelos';
import { PulsoService } from '../pulso.service';
import { SesionService } from '../sesion.service';
import { abrirPdf, htmlRutinas, htmlTablas } from '../exportar';

@Component({
  selector: 'app-mi-plan',
  templateUrl: './mi-plan.html',
})
export class MiPlan {
  private readonly pulso = inject(PulsoService);
  private readonly sesion = inject(SesionService);
  readonly etiqueta = etiquetaFecha;

  readonly cliente = computed(() => {
    const id = this.sesion.actual()?.clienteId;
    return this.pulso.estado().clientes.find((item) => item.id === id);
  });

  readonly rutinas = computed(() => {
    const id = this.cliente()?.id;
    return this.pulso.estado().rutinas.filter((item) => item.clienteId === id);
  });

  readonly tablas = computed(() => {
    const id = this.cliente()?.id;
    return this.pulso.estado().tablas.filter((item) => item.clienteId === id);
  });

  readonly citas = computed(() => {
    const id = this.cliente()?.id;
    const desde = hoyISO();
    const hasta = sumarDias(desde, 6);
    return this.pulso
      .estado()
      .citas.filter((cita) => cita.clienteId === id && cita.estado !== 'cancelada' && cita.fecha >= desde && cita.fecha <= hasta)
      .sort((a, b) => `${a.fecha}${a.hora}`.localeCompare(`${b.fecha}${b.hora}`));
  });

  servicio(id: string) {
    return this.pulso.estado().servicios.find((item) => item.id === id);
  }

  pdfEntreno() {
    const cliente = this.cliente();
    if (!cliente) return;
    abrirPdf('Rutina', htmlRutinas(cliente.nombre, this.rutinas()));
  }

  pdfComidas() {
    const cliente = this.cliente();
    if (!cliente) return;
    abrirPdf('Alimentación', htmlTablas(cliente.nombre, this.tablas()));
  }
}
