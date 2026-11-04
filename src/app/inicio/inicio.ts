import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Servicio, etiquetaFecha, hoyISO, pesos, uid } from '../modelos';
import { PulsoService } from '../pulso.service';

@Component({
  selector: 'app-inicio',
  imports: [RouterLink],
  templateUrl: './inicio.html',
})
export class Inicio {
  readonly pulso = inject(PulsoService);
  readonly hoy = hoyISO();
  readonly etiqueta = etiquetaFecha;
  readonly pesos = pesos;

  citasHoy() {
    return this.pulso
      .estado()
      .citas.filter((cita) => cita.fecha === this.hoy && cita.estado !== 'cancelada')
      .sort((a, b) => a.hora.localeCompare(b.hora));
  }

  cliente(id: string) {
    return this.pulso.estado().clientes.find((item) => item.id === id);
  }

  servicio(id: string) {
    return this.pulso.estado().servicios.find((item) => item.id === id);
  }

  porCobrar() {
    return this.pulso.estado().pagos.filter((pago) => pago.estado === 'pendiente');
  }

  totalPorCobrar() {
    return this.porCobrar().reduce((suma, pago) => suma + Number(pago.valor || 0), 0);
  }

  nuevoServicio() {
    this.pulso.guardarServicio({ id: uid(), nombre: 'Servicio nuevo', minutos: 45, precio: 50000 });
  }

  cambiarServicio(servicio: Servicio, campo: 'nombre' | 'minutos' | 'precio', evento: Event) {
    const valor = (evento.target as HTMLInputElement).value;
    if (campo === 'nombre') this.pulso.guardarServicio({ ...servicio, nombre: valor });
    if (campo === 'minutos') this.pulso.guardarServicio({ ...servicio, minutos: Number(valor) || 0 });
    if (campo === 'precio') this.pulso.guardarServicio({ ...servicio, precio: Number(valor) || 0 });
  }

  reiniciar() {
    if (confirm('¿Borrar los datos de este navegador y volver al ejemplo?')) this.pulso.reiniciar();
  }
}
