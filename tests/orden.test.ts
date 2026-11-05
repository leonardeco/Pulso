import { describe, expect, it } from 'vitest';
import { Rutina } from '../src/app/modelos';
import {
  duplicarDia,
  duplicarEjercicio,
  duplicarRutina,
  moverEjercicio,
  moverEjercicioADia,
} from '../src/app/orden';

function ejemplo(): Rutina[] {
  const ej = (id: string, nombre: string) => ({ id, nombre, series: '3', reps: '10', descanso: '60' });
  return [
    {
      id: 'r1',
      clienteId: 'c1',
      nombre: 'Fuerza',
      precio: 50,
      dias: [
        { id: 'd1', nombre: 'Lunes', ejercicios: [ej('e1', 'Sentadilla'), ej('e2', 'Prensa'), ej('e3', 'Zancada')] },
        { id: 'd2', nombre: 'Martes', ejercicios: [ej('e4', 'Plancha')] },
        { id: 'd3', nombre: 'Jueves', ejercicios: [] },
      ],
    },
    { id: 'r2', clienteId: null, nombre: 'Otra', precio: 0, dias: [] },
  ];
}

function contador(): () => string {
  let n = 0;
  return () => `nuevo${++n}`;
}

function todosLosIds(rutinas: Rutina[]): string[] {
  return rutinas.flatMap((r) => [r.id, ...r.dias.flatMap((d) => [d.id, ...d.ejercicios.map((e) => e.id)])]);
}

describe('duplicar un ejercicio', () => {
  it('deja la copia justo debajo con un id nuevo y los mismos datos', () => {
    const res = duplicarEjercicio(ejemplo(), 'r1', 'd1', 'e2', contador())!;
    const lista = res.rutinas[0].dias[0].ejercicios;
    expect(lista.map((e) => e.id)).toEqual(['e1', 'e2', 'nuevo1', 'e3']);
    expect(lista[2]).toEqual({ ...lista[1], id: 'nuevo1' });
    expect(res).toMatchObject({ id: 'nuevo1', posicion: 3, total: 4 });
  });

  it('duplicar el último ejercicio deja la copia al final', () => {
    const res = duplicarEjercicio(ejemplo(), 'r1', 'd1', 'e3', contador())!;
    expect(res.rutinas[0].dias[0].ejercicios.map((e) => e.id)).toEqual(['e1', 'e2', 'e3', 'nuevo1']);
    expect(res).toMatchObject({ posicion: 4, total: 4 });
  });

  it('no cambia las otras rutinas ni los otros días', () => {
    const res = duplicarEjercicio(ejemplo(), 'r1', 'd1', 'e1', contador())!;
    expect(res.rutinas[1]).toEqual(ejemplo()[1]);
    expect(res.rutinas[0].dias[1]).toEqual(ejemplo()[0].dias[1]);
  });

  it('devuelve null si la rutina, el día o el ejercicio no existen', () => {
    expect(duplicarEjercicio(ejemplo(), 'nada', 'd1', 'e1', contador())).toBeNull();
    expect(duplicarEjercicio(ejemplo(), 'r1', 'nada', 'e1', contador())).toBeNull();
    expect(duplicarEjercicio(ejemplo(), 'r1', 'd1', 'nada', contador())).toBeNull();
  });

  it('no muta la entrada', () => {
    const entrada = ejemplo();
    duplicarEjercicio(entrada, 'r1', 'd1', 'e2', contador());
    expect(entrada).toEqual(ejemplo());
  });
});

describe('duplicar un día', () => {
  it('copia el día con ids nuevos en el día y en cada ejercicio, justo después', () => {
    const res = duplicarDia(ejemplo(), 'r1', 'd1', contador())!;
    const dias = res.rutinas[0].dias;
    expect(dias.map((d) => d.id)).toEqual(['d1', 'nuevo1', 'd2', 'd3']);
    expect(dias[1].nombre).toBe('Lunes (copia)');
    expect(dias[1].ejercicios.map((e) => e.nombre)).toEqual(['Sentadilla', 'Prensa', 'Zancada']);
    expect(dias[1].ejercicios.map((e) => e.id)).toEqual(['nuevo2', 'nuevo3', 'nuevo4']);
    expect(res).toMatchObject({ id: 'nuevo1', posicion: 2, total: 4 });
  });

  it('no deja ids repetidos en toda la lista', () => {
    const ids = todosLosIds(duplicarDia(ejemplo(), 'r1', 'd1', contador())!.rutinas);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('duplicar el último día deja la copia al final', () => {
    const res = duplicarDia(ejemplo(), 'r1', 'd3', contador())!;
    expect(res.rutinas[0].dias.map((d) => d.id)).toEqual(['d1', 'd2', 'd3', 'nuevo1']);
    expect(res).toMatchObject({ posicion: 4, total: 4 });
  });

  it('devuelve null si la rutina o el día no existen', () => {
    expect(duplicarDia(ejemplo(), 'nada', 'd1', contador())).toBeNull();
    expect(duplicarDia(ejemplo(), 'r1', 'nada', contador())).toBeNull();
  });

  it('no muta la entrada', () => {
    const entrada = ejemplo();
    duplicarDia(entrada, 'r1', 'd1', contador());
    expect(entrada).toEqual(ejemplo());
  });
});

describe('duplicar una rutina', () => {
  it('deja la copia justo después, con el mismo cliente y el nombre con (copia)', () => {
    const res = duplicarRutina(ejemplo(), 'r1', contador())!;
    expect(res.rutinas.map((r) => r.nombre)).toEqual(['Fuerza', 'Fuerza (copia)', 'Otra']);
    expect(res.rutinas[1]).toMatchObject({ clienteId: 'c1', precio: 50 });
    expect(res).toMatchObject({ id: res.rutinas[1].id, posicion: 2, total: 3 });
  });

  it('da ids nuevos a la rutina, a los días y a los ejercicios sin repetir ninguno', () => {
    const res = duplicarRutina(ejemplo(), 'r1', contador())!;
    const copia = res.rutinas[1];
    expect(copia.dias.map((d) => d.nombre)).toEqual(['Lunes', 'Martes', 'Jueves']);
    expect(copia.dias.map((d) => d.ejercicios.length)).toEqual([3, 1, 0]);
    const ids = todosLosIds(res.rutinas);
    expect(new Set(ids).size).toBe(ids.length);
    expect(todosLosIds([copia]).every((id) => id.startsWith('nuevo'))).toBe(true);
  });

  it('devuelve null si la rutina no existe', () => {
    expect(duplicarRutina(ejemplo(), 'nada', contador())).toBeNull();
  });

  it('no muta la entrada', () => {
    const entrada = ejemplo();
    duplicarRutina(entrada, 'r1', contador());
    expect(entrada).toEqual(ejemplo());
  });
});

describe('mover un ejercicio dentro del día', () => {
  it('subir lo deja una posición antes', () => {
    const res = moverEjercicio(ejemplo(), 'r1', 'd1', 'e2', -1)!;
    expect(res.rutinas[0].dias[0].ejercicios.map((e) => e.id)).toEqual(['e2', 'e1', 'e3']);
    expect(res).toMatchObject({ id: 'e2', posicion: 1, total: 3 });
  });

  it('bajar lo deja una posición después', () => {
    const res = moverEjercicio(ejemplo(), 'r1', 'd1', 'e2', 1)!;
    expect(res.rutinas[0].dias[0].ejercicios.map((e) => e.id)).toEqual(['e1', 'e3', 'e2']);
    expect(res).toMatchObject({ posicion: 3, total: 3 });
  });

  it('subir el primero y bajar el último devuelven null', () => {
    expect(moverEjercicio(ejemplo(), 'r1', 'd1', 'e1', -1)).toBeNull();
    expect(moverEjercicio(ejemplo(), 'r1', 'd1', 'e3', 1)).toBeNull();
  });

  it('un día con un solo ejercicio no se puede mover en ningún sentido', () => {
    expect(moverEjercicio(ejemplo(), 'r1', 'd2', 'e4', -1)).toBeNull();
    expect(moverEjercicio(ejemplo(), 'r1', 'd2', 'e4', 1)).toBeNull();
  });

  it('devuelve null si algo no existe', () => {
    expect(moverEjercicio(ejemplo(), 'nada', 'd1', 'e1', 1)).toBeNull();
    expect(moverEjercicio(ejemplo(), 'r1', 'nada', 'e1', 1)).toBeNull();
    expect(moverEjercicio(ejemplo(), 'r1', 'd1', 'nada', 1)).toBeNull();
  });

  it('no muta la entrada', () => {
    const entrada = ejemplo();
    moverEjercicio(entrada, 'r1', 'd1', 'e2', 1);
    expect(entrada).toEqual(ejemplo());
  });
});

describe('mover un ejercicio a otro día', () => {
  it('lo pasa al final del día destino y lo saca del día de origen', () => {
    const res = moverEjercicioADia(ejemplo(), 'r1', 'd1', 'e2', 'd2')!;
    const dias = res.rutinas[0].dias;
    expect(dias[0].ejercicios.map((e) => e.id)).toEqual(['e1', 'e3']);
    expect(dias[1].ejercicios.map((e) => e.id)).toEqual(['e4', 'e2']);
    expect(res).toMatchObject({ id: 'e2', posicion: 2, total: 2 });
  });

  it('funciona hacia un día vacío', () => {
    const res = moverEjercicioADia(ejemplo(), 'r1', 'd1', 'e1', 'd3')!;
    expect(res.rutinas[0].dias[2].ejercicios.map((e) => e.id)).toEqual(['e1']);
    expect(res).toMatchObject({ posicion: 1, total: 1 });
  });

  it('devuelve null si el día destino no existe o es el mismo día', () => {
    expect(moverEjercicioADia(ejemplo(), 'r1', 'd1', 'e1', 'nada')).toBeNull();
    expect(moverEjercicioADia(ejemplo(), 'r1', 'd1', 'e1', 'd1')).toBeNull();
  });

  it('devuelve null si la rutina, el día de origen o el ejercicio no existen', () => {
    expect(moverEjercicioADia(ejemplo(), 'nada', 'd1', 'e1', 'd2')).toBeNull();
    expect(moverEjercicioADia(ejemplo(), 'r1', 'nada', 'e1', 'd2')).toBeNull();
    expect(moverEjercicioADia(ejemplo(), 'r1', 'd1', 'nada', 'd2')).toBeNull();
  });

  it('no muta la entrada', () => {
    const entrada = ejemplo();
    moverEjercicioADia(entrada, 'r1', 'd1', 'e2', 'd2');
    expect(entrada).toEqual(ejemplo());
  });
});
