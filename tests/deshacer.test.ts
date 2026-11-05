import { describe, expect, it } from 'vitest';
import { devolver, sacarDia, sacarEjercicio } from '../src/app/deshacer';
import { Rutina } from '../src/app/modelos';

function ejemplo(): Rutina[] {
  const ej = (id: string, nombre: string) => ({ id, nombre, series: '3', reps: '10', descanso: '60' });
  return [
    {
      id: 'r1',
      clienteId: null,
      nombre: 'Fuerza',
      precio: 0,
      dias: [
        { id: 'd1', nombre: 'Lunes', ejercicios: [ej('e1', 'Sentadilla'), ej('e2', 'Prensa'), ej('e3', 'Zancada')] },
        { id: 'd2', nombre: 'Martes', ejercicios: [ej('e4', 'Plancha')] },
        { id: 'd3', nombre: 'Jueves', ejercicios: [] },
      ],
    },
    { id: 'r2', clienteId: 'c1', nombre: 'Otra', precio: 0, dias: [] },
  ];
}

describe('quitar y devolver', () => {
  it('quitar un ejercicio guarda su posición y su nombre', () => {
    const res = sacarEjercicio(ejemplo(), 'r1', 'd1', 'e2')!;
    expect(res.quitado).toMatchObject({ tipo: 'ejercicio', rutinaId: 'r1', diaId: 'd1', indice: 1, nombre: 'Prensa' });
    expect(res.rutinas[0].dias[0].ejercicios.map((e) => e.id)).toEqual(['e1', 'e3']);
  });

  it('devolver un ejercicio lo deja en su posición original', () => {
    const res = sacarEjercicio(ejemplo(), 'r1', 'd1', 'e2')!;
    expect(devolver(res.rutinas, res.quitado)).toEqual(ejemplo());
  });

  it('devolver el primer y el último ejercicio respeta los extremos', () => {
    for (const id of ['e1', 'e3']) {
      const res = sacarEjercicio(ejemplo(), 'r1', 'd1', id)!;
      expect(devolver(res.rutinas, res.quitado)).toEqual(ejemplo());
    }
  });

  it('quitar un día guarda el día con todos sus ejercicios', () => {
    const res = sacarDia(ejemplo(), 'r1', 'd1')!;
    expect(res.quitado).toMatchObject({ tipo: 'dia', rutinaId: 'r1', diaId: 'd1', indice: 0, nombre: 'Lunes' });
    expect(res.rutinas[0].dias.map((d) => d.id)).toEqual(['d2', 'd3']);
    expect((res.quitado.elemento as { ejercicios: unknown[] }).ejercicios).toHaveLength(3);
  });

  it('devolver un día lo deja en su lugar con todos sus ejercicios', () => {
    const res = sacarDia(ejemplo(), 'r1', 'd2')!;
    expect(devolver(res.rutinas, res.quitado)).toEqual(ejemplo());
  });

  it('con un id inexistente no quita nada', () => {
    const rutinas = ejemplo();
    expect(sacarEjercicio(rutinas, 'r1', 'd1', 'nada')).toBeNull();
    expect(sacarEjercicio(rutinas, 'r1', 'nada', 'e1')).toBeNull();
    expect(sacarEjercicio(rutinas, 'nada', 'd1', 'e1')).toBeNull();
    expect(sacarDia(rutinas, 'r1', 'nada')).toBeNull();
    expect(sacarDia(rutinas, 'nada', 'd1')).toBeNull();
  });

  it('si la rutina ya fue borrada devolver no cambia nada', () => {
    const res = sacarEjercicio(ejemplo(), 'r1', 'd1', 'e1')!;
    const sinRutina = res.rutinas.filter((r) => r.id !== 'r1');
    expect(devolver(sinRutina, res.quitado)).toEqual(sinRutina);
    const dia = sacarDia(ejemplo(), 'r1', 'd1')!;
    expect(devolver(sinRutina, dia.quitado)).toEqual(sinRutina);
  });

  it('si el día del ejercicio ya fue borrado devolver no cambia nada', () => {
    const res = sacarEjercicio(ejemplo(), 'r1', 'd1', 'e1')!;
    const sinDia = sacarDia(res.rutinas, 'r1', 'd1')!.rutinas;
    expect(devolver(sinDia, res.quitado)).toEqual(sinDia);
  });

  it('acota la posición al largo actual si la lista quedó más corta', () => {
    const ultimo = sacarEjercicio(ejemplo(), 'r1', 'd1', 'e3')!;
    const sinSegundo = sacarEjercicio(ultimo.rutinas, 'r1', 'd1', 'e2')!;
    const sinPrimero = sacarEjercicio(sinSegundo.rutinas, 'r1', 'd1', 'e1')!;
    const vuelto = devolver(sinPrimero.rutinas, ultimo.quitado);
    expect(vuelto[0].dias[0].ejercicios.map((e) => e.id)).toEqual(['e3']);
  });

  it('no duplica un ejercicio ni un día que ya existen', () => {
    const rutinas = ejemplo();
    const ejercicio = sacarEjercicio(rutinas, 'r1', 'd1', 'e1')!;
    const una = devolver(ejercicio.rutinas, ejercicio.quitado);
    expect(devolver(una, ejercicio.quitado)).toEqual(ejemplo());
    const dia = sacarDia(rutinas, 'r1', 'd1')!;
    const unaDia = devolver(dia.rutinas, dia.quitado);
    expect(devolver(unaDia, dia.quitado)).toEqual(ejemplo());
  });

  it('no modifica los arreglos de entrada', () => {
    const rutinas = ejemplo();
    const copia = structuredClone(rutinas);
    const ej = sacarEjercicio(rutinas, 'r1', 'd1', 'e2')!;
    const dia = sacarDia(rutinas, 'r1', 'd1')!;
    expect(rutinas).toEqual(copia);
    const sacados = structuredClone([ej.rutinas, dia.rutinas]);
    devolver(ej.rutinas, ej.quitado);
    devolver(dia.rutinas, dia.quitado);
    expect([ej.rutinas, dia.rutinas]).toEqual(sacados);
  });
});
