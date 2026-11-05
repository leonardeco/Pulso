import { Component, computed, inject, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { EJERCICIOS, imagenEjercicio, type Rutina } from '../modelos';
import { PulsoService } from '../pulso.service';
import { abrirPdf, htmlRutinas } from '../exportar';

@Component({
  selector: 'app-editor-rutina',
  imports: [RouterLink, NgTemplateOutlet],
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

  nombreQuitado(): string {
    const quitado = this.pulso.quitado();
    if (!quitado) return '';
    return quitado.nombre.trim() || (quitado.tipo === 'dia' ? 'Día sin nombre' : 'Ejercicio sin nombre');
  }

  ejercicioAqui(rutinaId: string, diaId: string, indice: number): boolean {
    const quitado = this.pulso.quitado();
    return (
      quitado?.tipo === 'ejercicio' &&
      quitado.rutinaId === rutinaId &&
      quitado.diaId === diaId &&
      quitado.indice === indice
    );
  }

  ejercicioAlFinal(rutinaId: string, diaId: string, total: number): boolean {
    const quitado = this.pulso.quitado();
    return (
      quitado?.tipo === 'ejercicio' &&
      quitado.rutinaId === rutinaId &&
      quitado.diaId === diaId &&
      quitado.indice >= total
    );
  }

  diaAqui(rutinaId: string, indice: number): boolean {
    const quitado = this.pulso.quitado();
    return quitado?.tipo === 'dia' && quitado.rutinaId === rutinaId && quitado.indice === indice;
  }

  diaAlFinal(rutinaId: string, total: number): boolean {
    const quitado = this.pulso.quitado();
    return quitado?.tipo === 'dia' && quitado.rutinaId === rutinaId && quitado.indice >= total;
  }

  borrar() {
    const rutina = this.rutina();
    const nombre = rutina.nombre.trim() || 'esta rutina';
    if (!confirm(`¿Borrar la rutina ${nombre}? No se puede deshacer.`)) return;
    this.pulso.eliminarRutina(rutina.id);
  }

  pdf() {
    const rutina = this.rutina();
    const cliente = rutina.clienteId
      ? this.pulso.estado().clientes.find((item) => item.id === rutina.clienteId)?.nombre || 'Cliente'
      : 'Plantilla';
    abrirPdf(rutina.nombre || 'Rutina', htmlRutinas(cliente, [rutina]));
  }
}
