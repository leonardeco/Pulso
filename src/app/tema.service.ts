import { Injectable, signal } from '@angular/core';

export type Tema = 'oscuro' | 'claro';

const CLAVE = 'pulso.tema';

function leer(): Tema {
  return localStorage.getItem(CLAVE) === 'claro' ? 'claro' : 'oscuro';
}

@Injectable({ providedIn: 'root' })
export class TemaService {
  readonly tema = signal<Tema>(leer());

  constructor() {
    this.pintar(this.tema());
  }

  usar(tema: Tema): void {
    this.tema.set(tema);
    this.pintar(tema);
  }

  alternar(): void {
    this.usar(this.tema() === 'oscuro' ? 'claro' : 'oscuro');
  }

  private pintar(tema: Tema): void {
    document.documentElement.dataset['tema'] = tema;
    localStorage.setItem(CLAVE, tema);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', tema === 'oscuro' ? '#07090d' : '#f4f6fa');
  }
}
