import { Component, ElementRef, Injector, afterNextRender, effect, inject, input, output, signal, viewChild, type OnInit } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { imagenEjercicio, type DiaRutina, type Ejercicio, type Rutina } from '../modelos';
import { PulsoService } from '../pulso.service';
import { abrirPdf, htmlRutinas } from '../exportar';
import { SelectorEjercicio } from '../selector-ejercicio/selector-ejercicio';
import { resumenEjercicio } from '../resumen-ejercicio';

@Component({
  selector: 'app-editor-rutina',
  imports: [RouterLink, NgTemplateOutlet, SelectorEjercicio],
  templateUrl: './editor-rutina.html',
  host: { style: 'display: contents', '(input)': 'pulso.olvidarQuitado()' },
})
export class EditorRutina implements OnInit {
  readonly pulso = inject(PulsoService);
  readonly rutina = input.required<Rutina>();
  readonly enlaceFicha = input(false);
  readonly anuncioInicial = input('');
  readonly duplicada = output<{ id: string; texto: string }>();
  readonly foto = imagenEjercicio;
  private readonly anfitrion = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly btnDeshacer = viewChild<ElementRef<HTMLButtonElement>>('btnDeshacer');
  private readonly ancla = viewChild<ElementRef<HTMLElement>>('ancla');
  readonly anuncio = signal('');
  readonly abierto = signal<string | null>(null);
  readonly selector = signal<{ rutinaId: string; diaId: string; boton: HTMLElement } | null>(null);
  private hayFila = false;
  private devolviendo = false;
  private quitadoConTeclado = false;

  constructor() {
    effect(() => {
      const hay = this.pulso.quitado() !== null;
      const habia = this.hayFila;
      this.hayFila = hay;
      const conTeclado = this.quitadoConTeclado;
      this.quitadoConTeclado = false;
      if (hay) {
        if (!conTeclado) return;
        afterNextRender(
          () => {
            const activo = document.activeElement;
            if (activo && activo !== document.body) return;
            this.btnDeshacer()?.nativeElement.focus();
          },
          { injector: this.injector },
        );
      } else if (habia && !this.devolviendo) {
        const activo = document.activeElement;
        if (!activo || !this.anfitrion.nativeElement.contains(activo) || !activo.closest('.fila-quitado')) return;
        afterNextRender(() => this.ancla()?.nativeElement.focus(), { injector: this.injector });
      }
    });
  }

  ngOnInit() {
    const inicial = this.anuncioInicial();
    if (inicial) this.anunciar(inicial);
  }

  quitar(evento: MouseEvent, accion: () => void) {
    this.quitadoConTeclado = evento.detail === 0;
    accion();
  }

  deshacer() {
    const quitado = this.pulso.quitado();
    if (!quitado) return;
    const id = quitado.elemento.id;
    this.devolviendo = true;
    this.pulso.deshacer();
    afterNextRender(
      () => {
        this.devolviendo = false;
        const elemento = this.anfitrion.nativeElement.querySelector(`[data-id="${CSS.escape(id)}"]`);
        const campo = elemento?.querySelector<HTMLElement>('input, button');
        (campo ?? this.ancla()?.nativeElement)?.focus();
      },
      { injector: this.injector },
    );
  }

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

  nombreEjercicio(nombre: string): string {
    return nombre.trim() || 'ejercicio sin nombre';
  }

  alternar(id: string) {
    this.abierto.set(this.abierto() === id ? null : id);
  }

  resumen(ejercicio: Ejercicio): string {
    return resumenEjercicio(ejercicio);
  }

  nombreVisible(nombre: string): string {
    return nombre.trim() || 'Ejercicio sin nombre';
  }

  atajo(campo: HTMLInputElement, valor: string, rutinaId: string, diaId: string, id: string, clave: 'reps' | 'descanso') {
    campo.value = valor;
    this.pulso.cambiarEjercicio(rutinaId, diaId, id, { [clave]: valor });
  }

  quitarEjercicio(evento: MouseEvent, rutinaId: string, diaId: string, id: string) {
    if (this.abierto() === id) this.abierto.set(null);
    this.quitar(evento, () => this.pulso.quitarEjercicio(rutinaId, diaId, id));
  }

  private enfocarCampo(id: string) {
    afterNextRender(
      () => {
        const elemento = document.querySelector(`[data-id="${CSS.escape(id)}"]`);
        elemento?.querySelector('input')?.focus();
      },
      { injector: this.injector },
    );
  }

  abrirSelector(rutinaId: string, diaId: string, evento: Event) {
    this.selector.set({ rutinaId, diaId, boton: evento.currentTarget as HTMLElement });
  }

  elegirEjercicio(nombre: string) {
    const destino = this.selector();
    this.selector.set(null);
    if (!destino) return;
    const id = this.pulso.agregarEjercicio(destino.rutinaId, destino.diaId, nombre);
    if (!id) {
      this.anunciar(`No se pudo agregar «${this.nombreEjercicio(nombre)}»: el día ya no existe`);
      this.devolverFoco(destino.boton);
      return;
    }
    this.anunciar(`${this.nombreEjercicio(nombre)} agregado`);
    this.abierto.set(id);
    this.enfocarCampo(id);
  }

  cerrarSelector() {
    const destino = this.selector();
    this.selector.set(null);
    if (destino) this.devolverFoco(destino.boton);
  }

  private devolverFoco(boton: HTMLElement) {
    afterNextRender(
      () => {
        if (boton.isConnected) {
          boton.focus();
          return;
        }
        const botones = Array.from(this.anfitrion.nativeElement.querySelectorAll<HTMLButtonElement>('button'));
        botones.find((item) => item.textContent?.trim() === 'Agregar ejercicio')?.focus();
      },
      { injector: this.injector },
    );
  }

  duplicarEjercicio(rutinaId: string, diaId: string, ejercicio: Ejercicio) {
    const id = this.pulso.duplicarEjercicio(rutinaId, diaId, ejercicio.id);
    if (!id) return;
    this.anunciar(`${this.nombreEjercicio(ejercicio.nombre)} duplicado`);
    this.abierto.set(id);
    this.enfocarCampo(id);
  }

  duplicarDia(rutinaId: string, dia: DiaRutina) {
    const id = this.pulso.duplicarDia(rutinaId, dia.id);
    if (!id) return;
    this.anunciar(`${dia.nombre.trim() || 'Día sin nombre'} duplicado`);
    this.enfocarCampo(id);
  }

  duplicarRutina(rutina: Rutina) {
    const id = this.pulso.duplicarRutina(rutina.id);
    if (!id) return;
    const texto = `${rutina.nombre.trim() || 'Rutina sin nombre'} duplicada`;
    this.anunciar(texto);
    this.duplicada.emit({ id, texto });
    this.enfocarCampo(id);
  }

  mover(rutinaId: string, diaId: string, ejercicio: Ejercicio, delta: -1 | 1) {
    const resultado = this.pulso.moverEjercicio(rutinaId, diaId, ejercicio.id, delta);
    if (!resultado) return;
    this.anunciarMovido(ejercicio, resultado);
    this.abierto.set(ejercicio.id);
    const preferido = delta < 0 ? 'subir' : 'bajar';
    const otro = delta < 0 ? 'bajar' : 'subir';
    afterNextRender(
      () => {
        const fila = this.anfitrion.nativeElement.querySelector(`[data-id="${CSS.escape(ejercicio.id)}"]`);
        const boton = (accion: string) => fila?.querySelector<HTMLButtonElement>(`[data-orden="${accion}"]`) ?? null;
        const primero = boton(preferido);
        const segundo = boton(otro);
        (primero && !primero.disabled ? primero : segundo && !segundo.disabled ? segundo : primero)?.focus();
      },
      { injector: this.injector },
    );
  }

  moverADia(selector: HTMLSelectElement, rutinaId: string, diaId: string, ejercicio: Ejercicio) {
    const destino = selector.value;
    selector.value = '';
    if (!destino) return;
    const resultado = this.pulso.moverEjercicioADia(rutinaId, diaId, ejercicio.id, destino);
    if (!resultado) return;
    this.anunciarMovido(ejercicio, resultado);
    this.abierto.set(ejercicio.id);
    afterNextRender(
      () => {
        const fila = this.anfitrion.nativeElement.querySelector(`[data-id="${CSS.escape(ejercicio.id)}"]`);
        fila?.querySelector<HTMLElement>('[data-orden="dia"]')?.focus();
      },
      { injector: this.injector },
    );
  }

  private anunciarMovido(ejercicio: Ejercicio, resultado: { posicion: number; total: number }) {
    const nombre = this.nombreEjercicio(ejercicio.nombre);
    this.anunciar(
      `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} movida a la posición ${resultado.posicion} de ${resultado.total}`,
    );
  }

  private anunciar(texto: string) {
    this.anuncio.set('');
    afterNextRender(() => this.anuncio.set(texto), { injector: this.injector });
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
