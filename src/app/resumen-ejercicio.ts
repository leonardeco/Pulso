export type DatosResumen = {
  series?: string | null;
  reps?: string | null;
  descanso?: string | null;
};

const MAXIMO = 12;

function limpiar(texto: string | null | undefined): string {
  const limpio = (texto ?? '').trim();
  return limpio.length > MAXIMO ? `${limpio.slice(0, MAXIMO - 1)}…` : limpio;
}

export function resumenEjercicio({ series, reps, descanso }: DatosResumen): string {
  const s = limpiar(series);
  const r = limpiar(reps);
  const d = limpiar(descanso);

  const carga = [s, r].filter(Boolean).join(' × ');
  const resumen = [carga, d].filter(Boolean).join(' · ');
  return resumen || 'Sin datos';
}
