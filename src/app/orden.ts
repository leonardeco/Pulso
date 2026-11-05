import { DiaRutina, Ejercicio, Rutina } from './modelos';

export type ResultadoOrden = {
  rutinas: Rutina[];
  id?: string;
  posicion?: number;
  total?: number;
};

type NuevoId = () => string;

function insertar<T>(lista: T[], indice: number, elemento: T): T[] {
  const posicion = Math.min(Math.max(indice, 0), lista.length);
  return [...lista.slice(0, posicion), elemento, ...lista.slice(posicion)];
}

function copiarEjercicio(ejercicio: Ejercicio, nuevoId: NuevoId): Ejercicio {
  return { ...ejercicio, id: nuevoId() };
}

function copiarDia(dia: DiaRutina, nuevoId: NuevoId, nombre: string): DiaRutina {
  const id = nuevoId();
  return {
    ...dia,
    id,
    nombre,
    ejercicios: dia.ejercicios.map((ejercicio) => copiarEjercicio(ejercicio, nuevoId)),
  };
}

function cambiarDia(
  rutinas: Rutina[],
  rutinaId: string,
  cambio: (dias: DiaRutina[]) => DiaRutina[],
): Rutina[] {
  return rutinas.map((r) => (r.id !== rutinaId ? r : { ...r, dias: cambio(r.dias) }));
}

export function duplicarEjercicio(
  rutinas: Rutina[],
  rutinaId: string,
  diaId: string,
  ejercicioId: string,
  nuevoId: NuevoId,
): ResultadoOrden | null {
  const dia = rutinas.find((item) => item.id === rutinaId)?.dias.find((item) => item.id === diaId);
  const indice = dia ? dia.ejercicios.findIndex((item) => item.id === ejercicioId) : -1;
  if (!dia || indice < 0) return null;

  const copia = copiarEjercicio(dia.ejercicios[indice], nuevoId);
  const ejercicios = insertar(dia.ejercicios, indice + 1, copia);
  return {
    rutinas: cambiarDia(rutinas, rutinaId, (dias) => dias.map((d) => (d.id !== diaId ? d : { ...d, ejercicios }))),
    id: copia.id,
    posicion: indice + 2,
    total: ejercicios.length,
  };
}

export function duplicarDia(
  rutinas: Rutina[],
  rutinaId: string,
  diaId: string,
  nuevoId: NuevoId,
): ResultadoOrden | null {
  const rutina = rutinas.find((item) => item.id === rutinaId);
  const indice = rutina ? rutina.dias.findIndex((item) => item.id === diaId) : -1;
  if (!rutina || indice < 0) return null;

  const copia = copiarDia(rutina.dias[indice], nuevoId, `${rutina.dias[indice].nombre.trim() || 'Sin nombre'} (copia)`);
  return {
    rutinas: cambiarDia(rutinas, rutinaId, (dias) => insertar(dias, indice + 1, copia)),
    id: copia.id,
    posicion: indice + 2,
    total: rutina.dias.length + 1,
  };
}

export function duplicarRutina(rutinas: Rutina[], rutinaId: string, nuevoId: NuevoId): ResultadoOrden | null {
  const indice = rutinas.findIndex((item) => item.id === rutinaId);
  if (indice < 0) return null;

  const origen = rutinas[indice];
  const id = nuevoId();
  const copia: Rutina = {
    ...origen,
    id,
    nombre: `${origen.nombre.trim() || 'Sin nombre'} (copia)`,
    dias: origen.dias.map((dia) => copiarDia(dia, nuevoId, dia.nombre)),
  };
  return {
    rutinas: insertar(rutinas, indice + 1, copia),
    id,
    posicion: indice + 2,
    total: rutinas.length + 1,
  };
}

export function moverEjercicio(
  rutinas: Rutina[],
  rutinaId: string,
  diaId: string,
  ejercicioId: string,
  delta: -1 | 1,
): ResultadoOrden | null {
  const dia = rutinas.find((item) => item.id === rutinaId)?.dias.find((item) => item.id === diaId);
  const indice = dia ? dia.ejercicios.findIndex((item) => item.id === ejercicioId) : -1;
  if (!dia || indice < 0) return null;

  const destino = indice + delta;
  if (destino < 0 || destino >= dia.ejercicios.length) return null;

  const ejercicios = [...dia.ejercicios];
  [ejercicios[indice], ejercicios[destino]] = [ejercicios[destino], ejercicios[indice]];
  return {
    rutinas: cambiarDia(rutinas, rutinaId, (dias) => dias.map((d) => (d.id !== diaId ? d : { ...d, ejercicios }))),
    id: ejercicioId,
    posicion: destino + 1,
    total: ejercicios.length,
  };
}

export function moverEjercicioADia(
  rutinas: Rutina[],
  rutinaId: string,
  diaId: string,
  ejercicioId: string,
  diaDestinoId: string,
): ResultadoOrden | null {
  if (diaId === diaDestinoId) return null;
  const rutina = rutinas.find((item) => item.id === rutinaId);
  const origen = rutina?.dias.find((item) => item.id === diaId);
  const destino = rutina?.dias.find((item) => item.id === diaDestinoId);
  const indice = origen ? origen.ejercicios.findIndex((item) => item.id === ejercicioId) : -1;
  if (!origen || !destino || indice < 0) return null;

  const ejercicio = origen.ejercicios[indice];
  return {
    rutinas: cambiarDia(rutinas, rutinaId, (dias) =>
      dias.map((d) => {
        if (d.id === diaId) return { ...d, ejercicios: d.ejercicios.filter((e) => e.id !== ejercicioId) };
        if (d.id === diaDestinoId) return { ...d, ejercicios: [...d.ejercicios, ejercicio] };
        return d;
      }),
    ),
    id: ejercicioId,
    posicion: destino.ejercicios.length + 1,
    total: destino.ejercicios.length + 1,
  };
}
