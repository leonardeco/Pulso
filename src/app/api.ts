export type Respuesta<T> =
  | { ok: true; datos: T }
  | { ok: false; status: number; error: string; datos?: T };

export const SIN_RED = 'No pude conectar. Revisa tu internet e inténtalo de nuevo.';

export async function pedir<T>(
  metodo: string,
  ruta: string,
  cuerpo?: unknown,
  opciones: { keepalive?: boolean } = {},
): Promise<Respuesta<T>> {
  const cabeceras: Record<string, string> = {};
  const init: RequestInit = { method: metodo, credentials: 'same-origin', headers: cabeceras };
  if (cuerpo !== undefined) {
    cabeceras['Content-Type'] = 'application/json';
    init.body = JSON.stringify(cuerpo);
  }
  if (opciones.keepalive) init.keepalive = true;
  else init.signal = AbortSignal.timeout(15000);

  let res: Response;
  try {
    res = await fetch(ruta, init);
  } catch {
    return { ok: false, status: 0, error: SIN_RED };
  }

  let datos: unknown;
  try {
    datos = await res.json();
  } catch {
    datos = undefined;
  }
  if (res.ok) return { ok: true, datos: datos as T };
  const msg = (datos as { error?: unknown } | undefined)?.error;
  return {
    ok: false,
    status: res.status,
    error: typeof msg === 'string' && msg ? msg : 'Algo salió mal. Inténtalo de nuevo.',
    datos: datos as T | undefined,
  };
}
