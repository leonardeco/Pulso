export type EstadoGuardado = 'al-dia' | 'pendiente' | 'guardando';

export const LIMITE_CARACTERES = 1024 * 1024;
export const MS_PARA_GUARDANDO = 1000;

export function estadoDeGuardado(e: {
  pendiente: boolean;
  enVuelo: boolean;
  msEnVuelo: number;
  conError: boolean;
}): EstadoGuardado {
  if (e.enVuelo && e.msEnVuelo >= MS_PARA_GUARDANDO) return 'guardando';
  if (e.pendiente || e.enVuelo || e.conError) return 'pendiente';
  return 'al-dia';
}

export function cercaDelLimite(caracteres: number, limite: number): boolean {
  return caracteres >= 0.9 * limite;
}
