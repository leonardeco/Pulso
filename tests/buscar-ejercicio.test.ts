import { describe, expect, it } from 'vitest';
import { EJERCICIOS, Rutina } from '../src/app/modelos';
import { ALIAS, buscarEjercicios, normalizar, recientes } from '../src/app/buscar-ejercicio';

const catalogoConEne = [...EJERCICIOS, 'Curl de muñeca'];

function nombres(consulta: string, previos: string[] = [], catalogo: readonly string[] = catalogoConEne, max?: number) {
  return buscarEjercicios({ consulta, recientes: previos, catalogo, max }).resultados.map((r) => r.nombre);
}

function rutinaCon(id: string, dias: string[][]): Rutina {
  return {
    id,
    clienteId: null,
    nombre: id,
    precio: 0,
    dias: dias.map((nombresDia, i) => ({
      id: `${id}-d${i}`,
      nombre: `Día ${i}`,
      ejercicios: nombresDia.map((nombre, j) => ({
        id: `${id}-d${i}-e${j}`,
        nombre,
        series: '3',
        reps: '10',
        descanso: '60s',
      })),
    })),
  };
}

describe('normalizar', () => {
  it('quita tildes, pasa a minúsculas y recorta', () => {
    expect(normalizar('  Jalón AL Pecho ')).toBe('jalon al pecho');
  });

  it('trata la ñ como n', () => {
    expect(normalizar('Muñeca')).toBe('muneca');
  });
});

describe('alias', () => {
  it('solo existen para ejercicios del catálogo', () => {
    for (const nombre of Object.keys(ALIAS)) expect(EJERCICIOS).toContain(nombre);
  });
});

describe('recientes', () => {
  it('pone primero el último ejercicio de la última rutina', () => {
    const rutinas = [
      rutinaCon('a', [['Sentadilla', 'Prensa']]),
      rutinaCon('b', [['Plancha'], ['Zancada', 'Fondos']]),
    ];
    expect(recientes(rutinas)).toEqual(['Fondos', 'Zancada', 'Plancha', 'Prensa', 'Sentadilla']);
  });

  it('no repite nombres aunque cambien tildes o mayúsculas', () => {
    const rutinas = [rutinaCon('a', [['Jalón al pecho', 'jalon AL pecho', 'Plancha']])];
    expect(recientes(rutinas)).toEqual(['Plancha', 'jalon AL pecho']);
  });

  it('ignora los nombres vacíos', () => {
    const rutinas = [rutinaCon('a', [['', '   ', 'Prensa']])];
    expect(recientes(rutinas)).toEqual(['Prensa']);
  });

  it('devuelve una lista vacía sin rutinas', () => {
    expect(recientes([])).toEqual([]);
  });
});

describe('buscarEjercicios', () => {
  it('sin consulta muestra primero los recientes y luego el catálogo sin repetir', () => {
    const { resultados, crear } = buscarEjercicios({
      consulta: '',
      recientes: ['Prensa', 'Curl de muñeca'],
      catalogo: catalogoConEne,
      max: 5,
    });
    expect(resultados).toEqual([
      { nombre: 'Prensa', origen: 'reciente' },
      { nombre: 'Curl de muñeca', origen: 'reciente' },
      { nombre: 'Sentadilla', origen: 'catalogo' },
      { nombre: 'Sentadilla goblet', origen: 'catalogo' },
      { nombre: 'Sentadilla búlgara', origen: 'catalogo' },
    ]);
    expect(crear).toBeNull();
  });

  it('encuentra con tildes aunque la consulta no las lleve', () => {
    expect(nombres('bulgara')).toEqual(['Sentadilla búlgara']);
    expect(nombres('JALÓN')).toEqual(['Jalón al pecho', 'Face pull']);
  });

  it('encuentra una ñ escribiendo n', () => {
    expect(nombres('muneca')).toEqual(['Curl de muñeca']);
    expect(nombres('muñeca')).toEqual(['Curl de muñeca']);
  });

  it('no distingue mayúsculas', () => {
    expect(nombres('PESO MUERTO')).toEqual(['Peso muerto', 'Peso muerto rumano']);
  });

  it('encuentra por alias en inglés', () => {
    expect(nombres('deadlift')).toEqual(['Peso muerto', 'Peso muerto rumano']);
    expect(nombres('bench press')).toEqual(['Press banca']);
    expect(nombres('pull up')).toEqual(['Dominadas']);
    expect(nombres('lat pulldown')).toEqual(['Jalón al pecho']);
    expect(nombres('squat')).toContain('Sentadilla');
  });

  it('pone primero los que empiezan por la consulta y luego los que la contienen', () => {
    expect(nombres('press')).toEqual(['Press banca', 'Press militar', 'Prensa', 'Pallof']);
    const lista = nombres('curl');
    expect(lista[0]).toBe('Curl de bíceps');
    expect(lista).toContain('Curl de muñeca');
    const contiene = nombres('pecho');
    expect(contiene).toEqual(['Jalón al pecho']);
    const mezcla = nombres('remo', [], ['Press remo', 'Remo con barra']);
    expect(mezcla).toEqual(['Remo con barra', 'Press remo']);
  });

  it('muestra los recientes antes que el catálogo y los marca como recientes', () => {
    const { resultados } = buscarEjercicios({
      consulta: 'sentadilla',
      recientes: ['Sentadilla búlgara'],
      catalogo: EJERCICIOS,
    });
    expect(resultados[0]).toEqual({ nombre: 'Sentadilla búlgara', origen: 'reciente' });
    expect(resultados.filter((r) => r.nombre === 'Sentadilla búlgara')).toHaveLength(1);
    expect(resultados.slice(1).every((r) => r.origen === 'catalogo')).toBe(true);
  });

  it('no repite un reciente que ya está en el catálogo con otras mayúsculas', () => {
    const lista = nombres('', ['peso MUERTO']);
    expect(lista.filter((n) => normalizar(n) === 'peso muerto')).toHaveLength(1);
    expect(lista[0]).toBe('peso MUERTO');
  });

  it('respeta el máximo de resultados', () => {
    expect(nombres('', [], EJERCICIOS)).toHaveLength(8);
    expect(nombres('', [], EJERCICIOS, 3)).toHaveLength(3);
    expect(nombres('sentadilla', [], EJERCICIOS, 2)).toHaveLength(2);
  });

  it('propone crear la consulta recortada cuando no hay coincidencia exacta', () => {
    expect(buscarEjercicios({ consulta: '  Curl martillo ', recientes: [], catalogo: EJERCICIOS }).crear).toBe(
      'Curl martillo',
    );
    expect(buscarEjercicios({ consulta: 'sentad', recientes: [], catalogo: EJERCICIOS }).crear).toBe('sentad');
  });

  it('no propone crear cuando hay coincidencia exacta normalizada', () => {
    expect(buscarEjercicios({ consulta: 'sentadilla BULGARA', recientes: [], catalogo: EJERCICIOS }).crear).toBeNull();
    expect(buscarEjercicios({ consulta: 'muneca', recientes: [], catalogo: ['Muñeca'] }).crear).toBeNull();
    expect(buscarEjercicios({ consulta: 'Mi ejercicio', recientes: ['mi ejercicio'], catalogo: EJERCICIOS }).crear).toBeNull();
  });

  it('no propone crear sin consulta', () => {
    expect(buscarEjercicios({ consulta: '   ', recientes: [], catalogo: EJERCICIOS }).crear).toBeNull();
  });

  it('devuelve resultados vacíos y crear cuando nada coincide', () => {
    expect(buscarEjercicios({ consulta: 'zzzz', recientes: [], catalogo: EJERCICIOS })).toEqual({
      resultados: [],
      crear: 'zzzz',
    });
  });
});
