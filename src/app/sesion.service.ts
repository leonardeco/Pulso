import { Injectable, computed, signal } from '@angular/core';
import { AccesoCliente, Estado, uid } from './modelos';

const ADMIN = 'leonardecojt@gmail.com';

const CUENTAS = 'pulso.cuentas.v1';
const SESION = 'pulso.sesion.v1';
const RECUPERACION = 'pulso.recuperacion.v1';

export interface Cuenta {
  id: string;
  nombre: string;
  correo: string;
  sal: string;
  hash: string;
}

export interface Sesion {
  id: string;
  rol: 'entrenador' | 'cliente';
  nombre: string;
  correo: string;
  entrenadorId: string;
  clienteId?: string;
}

interface Recuperacion {
  correo: string;
  sal: string;
  hash: string;
  expira: number;
  intentos: number;
  verificado: boolean;
}

function leerCuentas(): Cuenta[] {
  try {
    const data = JSON.parse(localStorage.getItem(CUENTAS) || '[]') as Cuenta[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function guardarCuentas(cuentas: Cuenta[]): void {
  localStorage.setItem(CUENTAS, JSON.stringify(cuentas));
}

function leerSesion(): Sesion | null {
  try {
    const data = JSON.parse(localStorage.getItem(SESION) || 'null') as Sesion | null;
    if (!data?.id || !data.correo) return null;
    const rol = data.rol === 'cliente' ? 'cliente' : 'entrenador';
    if (rol === 'cliente' && (!data.clienteId || !data.entrenadorId)) return null;
    return {
      id: data.id,
      rol,
      nombre: data.nombre || '',
      correo: data.correo,
      entrenadorId: data.entrenadorId || data.id,
      clienteId: data.clienteId,
    };
  } catch {
    return null;
  }
}

function leerEstudio(id: string): Estado | null {
  try {
    const data = JSON.parse(localStorage.getItem(`pulso.estado.${id}`) || 'null') as Estado | null;
    if (!data || !Array.isArray(data.clientes)) return null;
    return { ...data, accesos: Array.isArray(data.accesos) ? data.accesos : [] };
  } catch {
    return null;
  }
}

function leerRecuperacion(): Recuperacion | null {
  try {
    const data = JSON.parse(localStorage.getItem(RECUPERACION) || 'null') as Recuperacion | null;
    if (!data?.correo || !data.hash || !data.expira) return null;
    return { ...data, verificado: data.verificado === true, intentos: Number(data.intentos) || 0 };
  } catch {
    return null;
  }
}

export async function hashClave(clave: string, sal: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${sal}:${clave}`);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function correoValido(correo: string): boolean {
  return correo.includes('@') && !correo.startsWith('@') && !correo.endsWith('@');
}

async function enviarCodigo(correo: string, codigo: string): Promise<string | null> {
  if (!correoValido(correo) || codigo.length !== 4) return 'No pude armar el código.';
  return 'El código no salió al correo. Este estudio todavía no tiene envío de correo.';
}

@Injectable({ providedIn: 'root' })
export class SesionService {
  readonly actual = signal<Sesion | null>(leerSesion());
  readonly id = computed(() => this.actual()?.id ?? null);
  readonly estudioId = computed(() => this.actual()?.entrenadorId || this.actual()?.id || null);
  readonly activa = computed(() => this.actual() !== null);
  readonly esCliente = computed(() => this.actual()?.rol === 'cliente');
  readonly esEntrenador = computed(() => this.activa() && !this.esCliente());
  readonly esAdmin = computed(() => this.esEntrenador() && this.actual()?.correo === ADMIN);

  entrenadores(): { id: string; nombre: string; correo: string; estado: Estado | null }[] {
    return leerCuentas().map((cuenta) => ({
      id: cuenta.id,
      nombre: cuenta.nombre,
      correo: cuenta.correo,
      estado: leerEstudio(cuenta.id),
    }));
  }

  hayEntrenador(correo: string): boolean {
    const mail = correo.trim().toLowerCase();
    return leerCuentas().some((cuenta) => cuenta.correo === mail);
  }

  async registrar(nombre: string, correo: string, clave: string): Promise<string | null> {
    const limpio = nombre.trim();
    const mail = correo.trim().toLowerCase();
    if (limpio.length < 2) return 'Escribe tu nombre.';
    if (!correoValido(mail)) return 'Escribe un correo válido.';
    if (clave.length < 8) return 'La contraseña necesita al menos 8 caracteres.';
    const cuentas = leerCuentas();
    if (cuentas.some((cuenta) => cuenta.correo === mail)) return 'Ese correo ya tiene una cuenta. Entra con él.';
    if (this.correoDeCliente(mail)) return 'Ese correo ya es el acceso de un cliente.';
    const sal = uid();
    const cuenta: Cuenta = { id: uid(), nombre: limpio, correo: mail, sal, hash: await hashClave(clave, sal) };
    guardarCuentas([...cuentas, cuenta]);
    this.abrirEntrenador(cuenta);
    return null;
  }

  async entrar(correo: string, clave: string): Promise<string | null> {
    const mail = correo.trim().toLowerCase();
    const cuenta = leerCuentas().find((item) => item.correo === mail);
    if (cuenta) {
      if ((await hashClave(clave, cuenta.sal)) !== cuenta.hash) return 'Correo o contraseña no coinciden.';
      this.abrirEntrenador(cuenta);
      return null;
    }
    for (const entrenador of leerCuentas()) {
      const estudio = leerEstudio(entrenador.id);
      const acceso = estudio?.accesos.find((item) => item.correo === mail);
      if (!acceso || (await hashClave(clave, acceso.sal)) !== acceso.hash) continue;
      const cliente = estudio?.clientes.find((item) => item.id === acceso.clienteId);
      if (!cliente) continue;
      this.abrirCliente(entrenador.id, cliente.nombre, acceso);
      return null;
    }
    return 'Correo o contraseña no coinciden.';
  }

  async pedirCodigo(correo: string): Promise<string | null> {
    const mail = correo.trim().toLowerCase();
    if (!correoValido(mail)) return 'Escribe un correo válido.';
    const cuenta = leerCuentas().find((item) => item.correo === mail);
    if (!cuenta) return 'No hay una cuenta de entrenador con ese correo.';
    const codigo = String(Math.floor(1000 + Math.random() * 9000));
    const sal = uid();
    const pendiente: Recuperacion = {
      correo: mail,
      sal,
      hash: await hashClave(codigo, sal),
      expira: Date.now() + 10 * 60 * 1000,
      intentos: 0,
      verificado: false,
    };
    localStorage.setItem(RECUPERACION, JSON.stringify(pendiente));
    const aviso = await enviarCodigo(mail, codigo);
    if (aviso) {
      localStorage.removeItem(RECUPERACION);
      return aviso;
    }
    return null;
  }

  async confirmarCodigo(correo: string, codigo: string): Promise<string | null> {
    const mail = correo.trim().toLowerCase();
    const pendiente = leerRecuperacion();
    if (!pendiente || pendiente.correo !== mail) return 'Pide un código nuevo.';
    if (pendiente.expira < Date.now()) {
      localStorage.removeItem(RECUPERACION);
      return 'Ese código ya venció. Pide otro.';
    }
    if (pendiente.intentos >= 5) {
      localStorage.removeItem(RECUPERACION);
      return 'Demasiados intentos. Pide otro código.';
    }
    const limpio = codigo.replace(/\D/g, '');
    if (limpio.length !== 4) return 'El código tiene 4 números.';
    if ((await hashClave(limpio, pendiente.sal)) !== pendiente.hash) {
      pendiente.intentos += 1;
      localStorage.setItem(RECUPERACION, JSON.stringify(pendiente));
      return 'Ese código no coincide.';
    }
    pendiente.verificado = true;
    localStorage.setItem(RECUPERACION, JSON.stringify(pendiente));
    return null;
  }

  async cambiarClave(correo: string, clave: string): Promise<string | null> {
    const mail = correo.trim().toLowerCase();
    const pendiente = leerRecuperacion();
    if (!pendiente || pendiente.correo !== mail || pendiente.expira < Date.now() || !pendiente.verificado) {
      return 'Pide un código nuevo.';
    }
    if (clave.length < 8) return 'La contraseña necesita al menos 8 caracteres.';
    const cuentas = leerCuentas();
    const cuenta = cuentas.find((item) => item.correo === mail);
    if (!cuenta) return 'No hay una cuenta de entrenador con ese correo.';
    const sal = uid();
    cuenta.sal = sal;
    cuenta.hash = await hashClave(clave, sal);
    guardarCuentas(cuentas.map((item) => (item.id === cuenta.id ? cuenta : item)));
    localStorage.removeItem(RECUPERACION);
    this.abrirEntrenador(cuenta);
    return null;
  }

  cerrar(): void {
    localStorage.removeItem(SESION);
    this.actual.set(null);
  }

  private correoDeCliente(correo: string): boolean {
    return leerCuentas().some((entrenador) => {
      const estudio = leerEstudio(entrenador.id);
      return estudio?.accesos.some((acceso) => acceso.correo === correo) ?? false;
    });
  }

  private abrirEntrenador(cuenta: Cuenta): void {
    const sesion: Sesion = {
      id: cuenta.id,
      rol: 'entrenador',
      nombre: cuenta.nombre,
      correo: cuenta.correo,
      entrenadorId: cuenta.id,
    };
    localStorage.setItem(SESION, JSON.stringify(sesion));
    this.actual.set(sesion);
  }

  private abrirCliente(entrenadorId: string, nombre: string, acceso: AccesoCliente): void {
    const sesion: Sesion = {
      id: acceso.clienteId,
      rol: 'cliente',
      nombre,
      correo: acceso.correo,
      entrenadorId,
      clienteId: acceso.clienteId,
    };
    localStorage.setItem(SESION, JSON.stringify(sesion));
    this.actual.set(sesion);
  }
}
