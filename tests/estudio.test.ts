import { describe, expect, it } from 'vitest';
import {
  ESTADO_VACIO,
  estaVacio,
  filaPanel,
  validarEstado,
  vistaCliente,
  type Estado,
} from '../api/_lib/estudio';

const cli = (id: string, nombre: string) => ({
  id,
  nombre,
  telefono: '1',
  correo: 'a@b.c',
  objetivo: 'meta',
  notas: 'secreto',
  peso: '70',
  estatura: '170',
  mensualidad: 100,
  valoracionMensual: 50,
  modalidad: 'virtual',
});

const estado: Estado = {
  servicios: [
    { id: 's1', nombre: 'Sesion', minutos: 60, precio: 30 },
    { id: 's2', nombre: 'Otra', minutos: 30, precio: 20 },
  ],
  horario: { '1': [['08:00', '12:00']] },
  clientes: [cli('c1', 'Ana'), cli('c2', 'Beto')],
  citas: [
    { id: 'a1', servicioId: 's1', clienteId: 'c1', fecha: '2026-01-01', hora: '08:00', estado: 'pendiente' },
    { id: 'a2', servicioId: 's2', clienteId: 'c2', fecha: '2026-01-01', hora: '09:00', estado: 'pendiente' },
  ],
  rutinas: [
    { id: 'r1', clienteId: 'c1', nombre: 'R1', precio: 40, dias: [] },
    { id: 'r2', clienteId: 'c2', nombre: 'R2', precio: 60, dias: [] },
    { id: 'r3', clienteId: null, nombre: '', precio: 10, dias: [] },
  ],
  tablas: [
    { id: 't1', clienteId: 'c1', nombre: 'T1', filas: [] },
    { id: 't2', clienteId: 'c2', nombre: 'T2', filas: [] },
  ],
  pagos: [{ id: 'p1', clienteId: 'c1' }],
  accesos: [{ clienteId: 'c1', correo: 'x@y.z' }],
};

describe('estudio', () => {
  it('validarEstado rechaza elementos que no son objetos con id', () => {
    const base = { ...estado, accesos: [] };
    expect(validarEstado({ ...base, rutinas: [null] })).toBeNull();
    expect(validarEstado({ ...base, pagos: [{ clienteId: 'c1' }] })).toBeNull();
    expect(validarEstado({ ...base, citas: ['x'] })).toBeNull();
    expect(validarEstado({ ...base, rutinas: [{ id: 'r', dias: 'no' }] })).toBeNull();
    expect(validarEstado({ ...base, tablas: [{ id: 't', filas: {} }] })).toBeNull();
    expect(validarEstado({ ...base, rutinas: [{ id: 'r' }], tablas: [{ id: 't' }] })).not.toBeNull();
  });

  it('vistaCliente no devuelve pagos, notas, otros clientes ni precios', () => {
    const v = vistaCliente(estado, 'c1');
    expect(v.pagos).toEqual([]);
    expect(v.accesos).toEqual([]);
    expect(v.horario).toEqual({});
    expect(v.clientes.map((c) => c.id)).toEqual(['c1']);
    expect(v.clientes[0]).toMatchObject({ notas: '', telefono: '', correo: '', mensualidad: 0, objetivo: 'meta' });
    expect(v.citas.map((c) => c.id)).toEqual(['a1']);
    expect(v.rutinas.map((r) => [r.id, r.precio])).toEqual([['r1', 0]]);
    expect(v.tablas.map((t) => t.id)).toEqual(['t1']);
    expect(v.servicios.map((s) => [s.id, s.precio])).toEqual([['s1', 0]]);
    expect(JSON.stringify(v)).not.toContain('Beto');
  });

  it('validarEstado rechaza faltantes y vacía accesos', () => {
    expect(validarEstado(null)).toBeNull();
    expect(validarEstado({ ...estado, pagos: undefined })).toBeNull();
    expect(validarEstado({ ...estado, horario: [] })).toBeNull();
    expect(validarEstado({ ...estado, clientes: [{ nombre: 'sin id' }] })).toBeNull();
    expect(validarEstado(estado)?.accesos).toEqual([]);
  });

  it('estaVacio y filaPanel', () => {
    expect(estaVacio(ESTADO_VACIO)).toBe(true);
    expect(estaVacio(estado)).toBe(false);
    const f = filaPanel({ id: 'u', nombre: 'N', correo: 'n@n.n' }, estado);
    expect(f.total).toBe(110);
    expect(f.virtuales).toBe(2);
    expect(f.rutinas[2]).toMatchObject({ nombre: 'Rutina', cliente: 'Plantilla', modalidad: 'Plantilla' });
  });
});
