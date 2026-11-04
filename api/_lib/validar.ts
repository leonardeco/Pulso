const UNA_DIRECCION = /^[^\s@,;<>"()[\]\\]+@[^\s@,;<>"()[\]\\]+\.[^\s@,;<>"()[\]\\]+$/;

/** Devuelve el correo recortado y en minúsculas si es una sola dirección válida; si no, null. */
export function correoUnico(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const correo = valor.trim().toLowerCase();
  return correo.length <= 254 && UNA_DIRECCION.test(correo) ? correo : null;
}
