import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { subirCampoClave } from '../clave-campo';
import { SesionService } from '../sesion.service';
import { TemaService } from '../tema.service';

@Component({
  selector: 'app-recuperar',
  imports: [FormsModule, RouterLink],
  templateUrl: './recuperar.html',
})
export class Recuperar {
  private readonly sesion = inject(SesionService);
  private readonly router = inject(Router);
  readonly tema = inject(TemaService);
  readonly paso = signal<'correo' | 'codigo' | 'clave'>('correo');
  readonly error = signal('');
  readonly enviando = signal(false);
  readonly verClave = signal(false);
  readonly verConfirma = signal(false);
  readonly claveAbierta = signal(false);
  readonly foco = signal('');
  correo = '';
  codigo = '';
  clave = '';
  confirma = '';

  async pedir(): Promise<void> {
    this.error.set('');
    this.enviando.set(true);
    const mensaje = await this.sesion.pedirCodigo(this.correo);
    this.enviando.set(false);
    if (mensaje) {
      this.error.set(mensaje);
      return;
    }
    this.paso.set('codigo');
  }

  async confirmar(): Promise<void> {
    this.error.set('');
    this.enviando.set(true);
    const mensaje = await this.sesion.confirmarCodigo(this.correo, this.codigo);
    this.enviando.set(false);
    if (mensaje) {
      this.error.set(mensaje);
      return;
    }
    this.paso.set('clave');
  }

  async guardar(): Promise<void> {
    this.error.set('');
    if (this.clave !== this.confirma) {
      this.error.set('Las contraseñas no coinciden.');
      return;
    }
    this.enviando.set(true);
    const mensaje = await this.sesion.cambiarClave(this.correo, this.clave);
    this.enviando.set(false);
    if (mensaje) {
      this.error.set(mensaje);
      return;
    }
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
