import { Component, ElementRef, Injector, afterNextRender, computed, inject, output, signal, viewChild } from '@angular/core';
import { EJERCICIOS } from '../modelos';
import { PulsoService } from '../pulso.service';
import { buscarEjercicios, recientes } from '../buscar-ejercicio';

@Component({
  selector: 'app-selector-ejercicio',
  templateUrl: './selector-ejercicio.html',
  host: { style: 'display: contents' },
})
export class SelectorEjercicio {
  private readonly pulso = inject(PulsoService);
  private readonly injector = inject(Injector);
  private readonly hoja = viewChild.required<ElementRef<HTMLDialogElement>>('hoja');
  private readonly buscador = viewChild.required<ElementRef<HTMLInputElement>>('buscador');
  private readonly lista = viewChild.required<ElementRef<HTMLElement>>('lista');
  readonly elegido = output<string>();
  readonly cerrado = output<void>();
  readonly consulta = signal('');
  private terminado = false;

  readonly busqueda = computed(() =>
    buscarEjercicios({
      consulta: this.consulta(),
      recientes: recientes(this.pulso.estado().rutinas),
      catalogo: EJERCICIOS,
      max: 50,
    }),
  );

  readonly conteo = computed(() => {
    const { resultados, crear } = this.busqueda();
    const total = resultados.length;
    if (total === 0) return crear ? `Sin coincidencias. Puedes crear «${crear}»` : 'Sin resultados';
    return total === 1 ? '1 resultado' : `${total} resultados`;
  });

  constructor() {
    afterNextRender(
      () => {
        this.hoja().nativeElement.showModal();
        this.buscador().nativeElement.focus();
      },
      { injector: this.injector },
    );
  }

  escribir(evento: Event) {
    this.consulta.set((evento.target as HTMLInputElement).value);
    this.lista().nativeElement.scrollTop = 0;
  }

  enter(evento: Event) {
    if ((evento as KeyboardEvent).isComposing) return;
    evento.preventDefault();
    const { resultados, crear } = this.busqueda();
    const nombre = resultados[0]?.nombre ?? crear;
    if (nombre) this.elegir(nombre);
  }

  elegir(nombre: string) {
    if (this.terminado) return;
    this.terminado = true;
    this.hoja().nativeElement.close();
    this.elegido.emit(nombre);
  }

  cerrar() {
    this.hoja().nativeElement.close();
  }

  alCerrar() {
    if (this.terminado) return;
    this.terminado = true;
    this.cerrado.emit();
  }

  clicFondo(evento: MouseEvent) {
    if (evento.target === this.hoja().nativeElement) this.cerrar();
  }
}
