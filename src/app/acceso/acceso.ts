import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { subirCampoClave } from '../clave-campo';
import { PulsoService } from '../pulso.service';
import { SesionService } from '../sesion.service';
import { TemaService } from '../tema.service';

@Component({
  selector: 'app-acceso',
  imports: [FormsModule, RouterLink],
  templateUrl: './acceso.html',
})
export class Acceso {
  private sesion = inject(SesionService);
  private pulso = inject(PulsoService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  readonly tema = inject(TemaService);

  readonly registro = signal(!!this.route.snapshot.data['registro']);
  readonly error = signal('');
  readonly enviando = signal(false);
  readonly verClave = signal(false);
  readonly verConfirma = signal(false);
  readonly claveAbierta = signal(false);
  readonly foco = signal('');
  nombre = '';
  correo = '';
  clave = '';
  confirma = '';

  constructor() {
    this.route.data.subscribe((data) => {
      this.registro.set(!!data['registro']);
      this.error.set('');
      this.confirma = '';
      this.verClave.set(false);
      this.verConfirma.set(false);
    });
    if (this.pulso.sesionVencida()) {
      this.error.set('Tu sesión venció. Entra de nuevo.');
      this.pulso.sesionVencida.set(false);
    } else if (this.sesion.sinServidor()) {
      this.error.set('No pude conectar. Revisa tu internet e inténtalo de nuevo.');
    }
  }

  async enviar(): Promise<void> {
    this.error.set('');
    if (this.registro() && this.clave !== this.confirma) {
      this.error.set('Las contraseñas no coinciden.');
      return;
    }
    this.enviando.set(true);
    const mensaje = this.registro()
      ? await this.sesion.registrar(this.nombre, this.correo, this.clave)
      : await this.sesion.entrar(this.correo, this.clave);
    this.enviando.set(false);
    if (mensaje) {
      this.error.set(mensaje);
      return;
    }
    await this.pulso.trasEntrar(this.correo, this.clave);
    await this.router.navigateByUrl('/');
  }

  abrirClave(evento: Event) {
    const campo = evento.target;
    this.claveAbierta.set(true);
    this.foco.set(campo instanceof HTMLInputElement ? campo.name : '');
    subirCampoClave(campo);
  }

  cerrarClave() {
    setTimeout(() => {
      const activo = document.activeElement;
      if (activo instanceof HTMLElement && activo.closest('.clave')) return;
      this.claveAbierta.set(false);
      this.foco.set('');
    }, 1200);
  }
}
