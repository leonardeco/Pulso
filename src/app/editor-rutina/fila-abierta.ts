import { Injectable, effect, inject, signal } from '@angular/core';
import { PulsoService } from '../pulso.service';

@Injectable({ providedIn: 'root' })
export class FilaAbierta {
  private readonly pulso = inject(PulsoService);
  readonly id = signal<string | null>(null);

  constructor() {
    effect(() => {
      const estado = this.pulso.estado();
      const abierto = this.id();
      if (abierto === null) return;
      const existe = estado.rutinas.some((rutina) =>
        rutina.dias.some((dia) => dia.ejercicios.some((ejercicio) => ejercicio.id === abierto)),
      );
      if (!existe) this.id.set(null);
    });
  }

  abrir(id: string) {
    this.id.set(id);
  }

  cerrar() {
    this.id.set(null);
  }

  alternar(id: string) {
    this.id.set(this.id() === id ? null : id);
  }
}
