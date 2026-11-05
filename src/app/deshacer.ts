import { DiaRutina, Ejercicio, Rutina } from './modelos';

export type Quitado = {
  tipo: 'ejercicio' | 'dia';
  rutinaId: string;
  diaId: string | null;
  indice: number;
  elemento: Ejercicio | DiaRutina;
  nombre: string;
};

export type ResultadoQuitar = { rutinas: Rutina[]; quitado: Quitado };

function insertar<T>(lista: T[], indice: number, elemento: T): T[] {
  const posicion = Math.min(Math.max(indice, 0), lista.length);
  return [...lista.slice(0, posicion), elemento, ...lista.slice(posicion)];
}

export function sacarEjercicio(
  rutinas: Rutina[],
  rutinaId: string,
  diaId: string,
  ejercicioId: string,
): ResultadoQuitar | null {
  const rutina = rutinas.find((item) => item.id === rutinaId);
  const dia = rutina?.dias.find((item) => item.id === diaId);
  const indice = dia ? dia.ejercicios.findIndex((item) => item.id === ejercicioId) : -1;
  if (!rutina || !dia || indice < 0) return null;

  const ejercicio = dia.ejercicios[indice];
  return {
    rutinas: rutinas.map((r) =>
      r.id !== rutinaId
        ? r
        : {
            ...r,
            dias: r.dias.map((d) =>
              d.id !== diaId ? d : { ...d, ejercicios: d.ejercicios.filter((e) => e.id !== ejercicioId) },
            ),
          },
    ),
    quitado: { tipo: 'ejercicio', rutinaId, diaId, indice, elemento: ejercicio, nombre: ejercicio.nombre },
  };
}

export function sacarDia(rutinas: Rutina[], rutinaId: string, diaId: string): ResultadoQuitar | null {
  const rutina = rutinas.find((item) => item.id === rutinaId);
  const indice = rutina ? rutina.dias.findIndex((item) => item.id === diaId) : -1;
  if (!rutina || indice < 0) return null;

  const dia = rutina.dias[indice];
  return {
    rutinas: rutinas.map((r) =>
      r.id !== rutinaId ? r : { ...r, dias: r.dias.filter((d) => d.id !== diaId) },
    ),
    quitado: { tipo: 'dia', rutinaId, diaId, indice, elemento: dia, nombre: dia.nombre },
  };
}

export function devolver(rutinas: Rutina[], quitado: Quitado): Rutina[] {
  const rutina = rutinas.find((item) => item.id === quitado.rutinaId);
  if (!rutina) return rutinas;

  if (quitado.tipo === 'dia') {
    const dia = quitado.elemento as DiaRutina;
    if (rutina.dias.some((item) => item.id === dia.id)) return rutinas;
    return rutinas.map((r) =>
      r.id !== rutina.id ? r : { ...r, dias: insertar(r.dias, quitado.indice, dia) },
    );
  }

  const ejercicio = quitado.elemento as Ejercicio;
  const dia = rutina.dias.find((item) => item.id === quitado.diaId);
  if (!dia || dia.ejercicios.some((item) => item.id === ejercicio.id)) return rutinas;
  return rutinas.map((r) =>
    r.id !== rutina.id
      ? r
      : {
          ...r,
          dias: r.dias.map((d) =>
            d.id !== dia.id ? d : { ...d, ejercicios: insertar(d.ejercicios, quitado.indice, ejercicio) },
          ),
        },
  );
}
