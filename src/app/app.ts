import { Component, effect, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { PulsoService } from './pulso.service';
import { RecordatorioService } from './recordatorio.service';
import { SesionService } from './sesion.service';
import { TemaService } from './tema.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
})
export class App {
  readonly sesion = inject(SesionService);
  readonly tema = inject(TemaService);
  readonly avisos = inject(RecordatorioService);
  readonly pulso = inject(PulsoService);
  private router = inject(Router);

  constructor() {
    effect(() => {
      if (this.pulso.sesionVencida()) void this.router.navigateByUrl('/entrar');
    });
  }

  async salir(): Promise<void> {
    if (await this.pulso.salir()) await this.router.navigateByUrl('/entrar');
  }

  reintentar(): void {
    void this.pulso.reintentar();
  }
}
