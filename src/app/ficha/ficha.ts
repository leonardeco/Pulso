import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { EJERCICIOS, MOMENTOS, etiquetaPeriodo, hoyISO, periodoActual, pesos } from '../modelos';
import { PulsoService } from '../pulso.service';

@Component({
  selector: 'app-ficha',
  imports: [FormsModule, RouterLink],
  templateUrl: './ficha.html',
})
export class Ficha {
  readonly pulso = inject(PulsoService);
  readonly ejercicios = EJERCICIOS;
  readonly momentos = MOMENTOS;
  readonly pesos = pesos;
  readonly etiquetaPeriodo = etiquetaPeriodo;
  readonly periodo = periodoActual();
  readonly nombrePeriodo = etiquetaPeriodo(this.periodo);
  pestana = 'datos';
  concepto = '';
  valor = 80000;

  private readonly id = toSignal(
    inject(ActivatedRoute).paramMap.pipe(map((params) => params.get('id') ?? '')),
    { initialValue: '' },
  );

  readonly cliente = computed(() => this.pulso.estado().clientes.find((item) => item.id === this.id()));
  readonly rutinas = computed(() => this.pulso.estado().rutinas.filter((item) => item.clienteId === this.id()));
  readonly plantillas = computed(() => this.pulso.estado().rutinas.filter((item) => item.clienteId === null));
  readonly tablas = computed(() => this.pulso.estado().tablas.filter((item) => item.clienteId === this.id()));
  readonly pagos = computed(() => this.pulso.estado().pagos.filter((item) => item.clienteId === this.id()));
  readonly citas = computed(() =>
    this.pulso
      .estado()
      .citas.filter((cita) => cita.clienteId === this.id() && cita.estado !== 'cancelada')
      .sort((a, b) => `${a.fecha}${a.hora}`.localeCompare(`${b.fecha}${b.hora}`)),
  );

  texto(evento: Event) {
    return (evento.target as HTMLInputElement).value;
  }

  campo(campo: 'nombre' | 'telefono' | 'correo' | 'objetivo' | 'notas' | 'peso' | 'estatura', evento: Event) {
    const cliente = this.cliente();
    if (!cliente) return;
    const valor = this.texto(evento);
    if (campo === 'nombre') this.pulso.actualizarCliente(cliente.id, { nombre: valor });
    if (campo === 'telefono') this.pulso.actualizarCliente(cliente.id, { telefono: valor });
    if (campo === 'correo') this.pulso.actualizarCliente(cliente.id, { correo: valor });
    if (campo === 'objetivo') this.pulso.actualizarCliente(cliente.id, { objetivo: valor });
    if (campo === 'notas') this.pulso.actualizarCliente(cliente.id, { notas: valor });
    if (campo === 'peso') this.pulso.actualizarCliente(cliente.id, { peso: valor });
    if (campo === 'estatura') this.pulso.actualizarCliente(cliente.id, { estatura: valor });
  }

  servicio(id: string) {
    return this.pulso.estado().servicios.find((item) => item.id === id);
  }

  usarPlantilla(evento: Event) {
    const id = this.texto(evento);
    const cliente = this.cliente();
    if (!id || !cliente) return;
    this.pulso.copiarRutina(id, cliente.id);
    (evento.target as HTMLSelectElement).value = '';
  }

  tarifa(campo: 'mensualidad' | 'valoracionMensual', evento: Event) {
    const cliente = this.cliente();
    if (!cliente) return;
    const valor = Math.max(0, Math.round(Number(this.texto(evento)) || 0));
    this.pulso.actualizarCliente(cliente.id, { [campo]: valor });
  }

  mesCubierto() {
    const cliente = this.cliente();
    if (!cliente) return false;
    const pagos = this.pagos().filter((pago) => pago.periodo === this.periodo);
    const mensualidad = cliente.mensualidad <= 0 || pagos.some((pago) => pago.tipo === 'mensualidad');
    const valoracion = cliente.valoracionMensual <= 0 || pagos.some((pago) => pago.tipo === 'valoracion');
    return (cliente.mensualidad > 0 || cliente.valoracionMensual > 0) && mensualidad && valoracion;
  }

  generarMes() {
    const cliente = this.cliente();
    if (!cliente) return;
    this.pulso.generarCobrosDelMes(cliente.id);
  }

  cobrar() {
    const cliente = this.cliente();
    if (!cliente || !this.concepto.trim()) return;
    this.pulso.agregarPago({
      clienteId: cliente.id,
      tipo: 'otro',
      periodo: '',
      concepto: this.concepto.trim(),
      valor: Number(this.valor) || 0,
      fecha: hoyISO(),
      estado: 'pendiente',
    });
    this.concepto = '';
    this.valor = 80000;
  }

  borrarCliente() {
    const cliente = this.cliente();
    if (!cliente) return;
    if (!confirm(`¿Quitar a ${cliente.nombre} y sus citas?`)) return;
    this.pulso.eliminarCliente(cliente.id);
  }
}
