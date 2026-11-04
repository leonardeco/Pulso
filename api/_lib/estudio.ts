import { ErrorHttp } from './http';

export interface Cliente {
  id: string;
  nombre: string;
  telefono: string;
  correo: string;
  objetivo: string;
  notas: string;
  peso: string;
  estatura: string;
  mensualidad: number;
  valoracionMensual: number;
  modalidad: string;
}
export interface Servicio {
  id: string;
  nombre: string;
  minutos: number;
  precio: number;
}
export interface Cita {
  id: string;
  servicioId: string;
  clienteId: string;
  fecha: string;
  hora: string;
  estado: string;
}
export interface Rutina {
  id: string;
  clienteId: string | null;
  nombre: string;
  precio: number;
  dias: unknown[];
}
export interface Tabla {
  id: string;
  clienteId: string | null;
  nombre: string;
  filas: unknown[];
}
export interface AccesoVista {
  clienteId: string;
  correo: string;
}

export interface Estado {
  servicios: Servicio[];
  horario: Record<string, [string, string][]>;
  clientes: Cliente[];
  citas: Cita[];
  rutinas: Rutina[];
  tablas: Tabla[];
  pagos: unknown[];
  accesos: AccesoVista[];
}

export const ESTADO_VACIO: Estado = {
  servicios: [],
  horario: {},
  clientes: [],
  citas: [],
  rutinas: [],
  tablas: [],
  pagos: [],
  accesos: [],
};

const LISTAS = ['servicios', 'clientes', 'citas', 'rutinas', 'tablas', 'pagos'] as const;

export function validarEstado(x: unknown): Estado | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  for (const k of LISTAS) if (!Array.isArray(o[k])) return null;
  if (!o['horario'] || typeof o['horario'] !== 'object' || Array.isArray(o['horario'])) return null;
  for (const c of o['clientes'] as unknown[]) {
    if (!c || typeof c !== 'object' || typeof (c as { id?: unknown }).id !== 'string') return null;
  }
  return { ...(o as unknown as Estado), accesos: [] };
}

export function estadoDe(x: unknown): Estado {
  const e = validarEstado(x);
  if (!e) throw new ErrorHttp(500, 'Algo falló. Inténtalo de nuevo.');
  return e;
}

export function estaVacio(e: Estado): boolean {
  return LISTAS.every((k) => e[k].length === 0);
}

export function vistaCliente(e: Estado, clienteId: string): Estado {
  const propio = e.clientes.find((c) => c.id === clienteId);
  const citas = e.citas.filter((c) => c.clienteId === clienteId);
  const ids = new Set(citas.map((c) => c.servicioId));
  return {
    servicios: e.servicios.filter((s) => ids.has(s.id)).map((s) => ({ ...s, precio: 0 })),
    horario: {},
    clientes: propio
      ? [
          {
            id: propio.id,
            nombre: propio.nombre,
            objetivo: propio.objetivo,
            modalidad: propio.modalidad,
            telefono: '',
            correo: '',
            notas: '',
            peso: '',
            estatura: '',
            mensualidad: 0,
            valoracionMensual: 0,
          },
        ]
      : [],
    citas,
    rutinas: e.rutinas.filter((r) => r.clienteId === clienteId).map((r) => ({ ...r, precio: 0 })),
    tablas: e.tablas.filter((t) => t.clienteId === clienteId),
    pagos: [],
    accesos: [],
  };
}

const MODALIDADES = ['personalizado', 'semipersonalizado', 'virtual'];

function modalidadDe(v: string | undefined): string {
  return v && MODALIDADES.includes(v) ? v : 'personalizado';
}

function nombreModalidad(v: string | undefined): string {
  const m = modalidadDe(v);
  return m === 'semipersonalizado' ? 'Semipersonalizado' : m === 'virtual' ? 'Virtual' : 'Personalizado';
}

export function filaPanel(cuenta: { id: string; nombre: string; correo: string }, e: Estado | null) {
  const clientes = e?.clientes ?? [];
  const rutinas = (e?.rutinas ?? []).map((r) => {
    const c = clientes.find((i) => i.id === r.clienteId);
    return {
      id: r.id,
      nombre: r.nombre || 'Rutina',
      cliente: c?.nombre || 'Plantilla',
      modalidad: c ? nombreModalidad(c.modalidad) : 'Plantilla',
      precio: Number(r.precio) || 0,
    };
  });
  const contar = (m: string) => clientes.filter((i) => modalidadDe(i.modalidad) === m).length;
  return {
    id: cuenta.id,
    nombre: cuenta.nombre || 'Entrenador',
    correo: cuenta.correo,
    rutinas,
    personalizados: contar('personalizado'),
    semipersonalizados: contar('semipersonalizado'),
    virtuales: contar('virtual'),
    total: rutinas.reduce((s, i) => s + i.precio, 0),
  };
}
