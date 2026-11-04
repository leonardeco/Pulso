import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
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
  private router = inject(Router);

  salir(): void {
    this.sesion.cerrar();
    void this.router.navigateByUrl('/entrar');
  }
}
