import { Injectable, computed, signal } from '@angular/core';
import { SIN_RED, pedir } from './api';
import { cuentaLocal } from './datos-locales';

const SESION_VIEJA = 'pulso.sesion.v1';

export type { Cuenta } from './datos-locales';

export interface Sesion {
  id: string;
  rol: 'entrenador' | 'cliente';
  nombre: string;
  correo: string;
  entrenadorId: string;
  clienteId?: string;
  esAdmin: boolean;
}

interface SesionApi {
  rol?: string;
  nombre?: string;
  correo?: string;
  entrenadorId?: string;
  clienteId?: string;
  esAdmin?: boolean;
}

function correoValido(correo: string): boolean {
  return correo.includes('@') && !correo.startsWith('@') && !correo.endsWith('@');
}

function aSesion(s: SesionApi | null | undefined): Sesion | null {
  if (!s?.correo || !s.entrenadorId) return null;
  const rol = s.rol === 'cliente' ? 'cliente' : 'entrenador';
  if (rol === 'cliente' && !s.clienteId) return null;
  return {
    id: rol === 'cliente' ? (s.clienteId as string) : s.entrenadorId,
    rol,
    nombre: s.nombre ?? '',
    correo: s.correo,
    entrenadorId: s.entrenadorId,
    clienteId: s.clienteId,
    esAdmin: s.esAdmin === true,
  };
}

@Injectable({ providedIn: 'root' })
export class SesionService {
  readonly actual = signal<Sesion | null>(null);
  readonly sinServidor = signal(false);
  readonly id = computed(() => this.actual()?.id ?? null);
  readonly estudioId = computed(() => this.actual()?.entrenadorId || this.actual()?.id || null);
  readonly activa = computed(() => this.actual() !== null);
  readonly esCliente = computed(() => this.actual()?.rol === 'cliente');
  readonly esEntrenador = computed(() => this.activa() && !this.esCliente());
  readonly esAdmin = computed(() => this.esEntrenador() && this.actual()?.esAdmin === true);

  async iniciar(): Promise<void> {
    try {
      localStorage.removeItem(SESION_VIEJA);
    } catch {
      /* sin almacenamiento */
    }
    const r = await pedir<{ sesion: SesionApi | null }>('GET', '/api/sesion');
    if (r.ok) {
      this.sinServidor.set(false);
      this.actual.set(aSesion(r.datos?.sesion));
    } else {
      this.sinServidor.set(true);
      this.actual.set(null);
    }
  }

  async registrar(nombre: string, correo: string, clave: string): Promise<string | null> {
    const limpio = nombre.trim();
    const mail = correo.trim().toLowerCase();
    if (limpio.length < 2) return 'Escribe tu nombre.';
    if (!correoValido(mail)) return 'Escribe un correo válido.';
    if (clave.length < 8) return 'La contraseña necesita al menos 8 caracteres.';
    return this.registro(limpio, mail, clave);
  }

  async entrar(correo: string, clave: string): Promise<string | null> {
    const mail = correo.trim().toLowerCase();
    const r = await pedir<{ sesion: SesionApi }>('POST', '/api/entrar', { correo: mail, clave });
    if (r.ok) return this.abrir(r.datos?.sesion);
    if (r.status !== 401) return r.error;
    const cuenta = await cuentaLocal(mail, clave);
    if (!cuenta) return r.error;
    const reg = await this.registro(cuenta.nombre, mail, clave);
    if (reg === 'Ese correo ya tiene una cuenta. Entra con él.') return 'Correo o contraseña no coinciden.';
    return reg;
  }

  async salir(): Promise<boolean> {
    const r = await pedir('DELETE', '/api/sesion');
    if (!r.ok) return false;
    this.actual.set(null);
    return true;
  }

  async pedirCodigo(correo: string): Promise<string | null> {
    const mail = correo.trim().toLowerCase();
    if (!correoValido(mail)) return 'Escribe un correo válido.';
    return 'El código no salió al correo. Este estudio todavía no tiene envío de correo.';
  }

  async confirmarCodigo(_correo: string, _codigo: string): Promise<string | null> {
    return 'Pide un código nuevo.';
  }

  async cambiarClave(_correo: string, _clave: string): Promise<string | null> {
    return 'Pide un código nuevo.';
  }

  private async registro(nombre: string, correo: string, clave: string): Promise<string | null> {
    const r = await pedir<{ sesion: SesionApi }>('POST', '/api/registro', { nombre, correo, clave });
    if (!r.ok) return r.status === 0 ? SIN_RED : r.error;
    return this.abrir(r.datos?.sesion);
  }

  private abrir(s: SesionApi | undefined): string | null {
    const sesion = aSesion(s);
    if (!sesion) return 'Algo salió mal. Inténtalo de nuevo.';
    this.sinServidor.set(false);
    this.actual.set(sesion);
    return null;
  }
}
