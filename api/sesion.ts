import { actual, cerrar } from './_lib/sesion';
import { aceptaOrigen, borrarCookie, error, json, manejar } from './_lib/http';

export const GET = manejar(async (req: Request) => {
  const s = await actual(req);
  if (!s) return json({ sesion: null });
  const entrenadorId = s.cuentaId;
  const sesion: Record<string, unknown> = {
    rol: s.rol,
    nombre: s.nombre,
    correo: s.correo,
    entrenadorId,
    esAdmin: s.esAdmin,
  };
  if (s.clienteId) sesion['clienteId'] = s.clienteId;
  return json({ sesion });
});

export const DELETE = manejar(async (req: Request) => {
  if (!aceptaOrigen(req)) return error('Origen no permitido.', 403);
  const s = await actual(req);
  if (s) await cerrar(s.tokenHash);
  return json({ ok: true }, 200, { 'Set-Cookie': borrarCookie(req) });
});
