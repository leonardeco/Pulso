import { HASH_FALSO, crearHash, verificar } from './_lib/clave';
import { sql } from './_lib/db';
import { aceptaOrigen, cookieSesion, error, ipDe, json, leerJson, manejar } from './_lib/http';
import { bloqueado, fallo, limpiar } from './_lib/intentos';
import { abrir } from './_lib/sesion';

const MAX = 8;
const MINUTOS = 15;

export const POST = manejar(async (req: Request) => {
  if (!aceptaOrigen(req)) return error('Origen no permitido.', 403);
  const cuerpo = (await leerJson(req)) as { correo?: unknown; clave?: unknown } | null;
  const correo = typeof cuerpo?.correo === 'string' ? cuerpo.correo.trim().toLowerCase() : '';
  const clave = typeof cuerpo?.clave === 'string' ? cuerpo.clave : '';
  const llave = `entrar:${ipDe(req)}:${correo}`;
  if (await bloqueado(llave, MAX)) return error('Demasiados intentos. Espera 15 minutos.', 429);

  const cuentas = await sql()`
    SELECT id, nombre, correo, clave_hash, es_admin FROM cuenta WHERE correo = ${correo}`;
  const accesos = cuentas[0]
    ? []
    : await sql()`
        SELECT cliente_id, entrenador_id, correo, clave_hash FROM acceso_cliente WHERE correo = ${correo}`;
  const cuenta = cuentas[0];
  const acceso = accesos[0];
  const guardado = cuenta ? String(cuenta['clave_hash']) : acceso ? String(acceso['clave_hash']) : HASH_FALSO;
  const r = await verificar(clave, guardado);
  if (!r.ok || (!cuenta && !acceso)) {
    await fallo(llave, MAX, MINUTOS);
    return error('Correo o contraseña no coinciden.', 401);
  }
  await limpiar(llave);

  if (cuenta) {
    const id = String(cuenta['id']);
    if (r.actualizar) {
      await sql()`UPDATE cuenta SET clave_hash = ${await crearHash(clave)} WHERE id = ${id}::uuid`;
    }
    const token = await abrir('entrenador', id);
    return json(
      {
        sesion: {
          rol: 'entrenador',
          nombre: String(cuenta['nombre']),
          correo: String(cuenta['correo']),
          entrenadorId: id,
          esAdmin: Boolean(cuenta['es_admin']),
        },
      },
      200,
      { 'Set-Cookie': cookieSesion(token, req) },
    );
  }

  const clienteId = String(acceso['cliente_id']);
  const entrenadorId = String(acceso['entrenador_id']);
  if (r.actualizar) {
    await sql()`UPDATE acceso_cliente SET clave_hash = ${await crearHash(clave)} WHERE cliente_id = ${clienteId} AND entrenador_id = ${entrenadorId}::uuid`;
  }
  const token = await abrir('cliente', entrenadorId, clienteId);
  const est = await sql()`SELECT datos FROM estudio WHERE entrenador_id = ${entrenadorId}::uuid`;
  const datos = est[0]?.['datos'] as { clientes?: { id: string; nombre: string }[] } | undefined;
  const nombre = datos?.clientes?.find((c) => c.id === clienteId)?.nombre ?? '';
  return json(
    {
      sesion: {
        rol: 'cliente',
        nombre,
        correo: String(acceso['correo']),
        entrenadorId,
        clienteId,
        esAdmin: false,
      },
    },
    200,
    { 'Set-Cookie': cookieSesion(token, req) },
  );
});
