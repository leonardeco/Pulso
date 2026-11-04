import { randomUUID } from 'node:crypto';
import { crearHash } from './_lib/clave';
import { sql } from './_lib/db';
import { ESTADO_VACIO } from './_lib/estudio';
import { ErrorHttp, aceptaOrigen, cookieSesion, error, ipDe, json, leerJson, manejar } from './_lib/http';
import { bloqueado, fallo } from './_lib/intentos';
import { abrir } from './_lib/sesion';
import { correoUnico } from './_lib/validar';

const MAX = 10;
const MINUTOS = 60;

export const POST = manejar(async (req: Request) => {
  if (!aceptaOrigen(req)) return error('Origen no permitido.', 403);
  const cuerpo = (await leerJson(req)) as { nombre?: unknown; correo?: unknown; clave?: unknown } | null;
  const llave = `registro:${ipDe(req)}`;
  if (await bloqueado(llave, MAX)) return error('Demasiados intentos. Inténtalo más tarde.', 429);
  await fallo(llave, MAX, MINUTOS);

  const nombre = typeof cuerpo?.nombre === 'string' ? cuerpo.nombre.trim() : '';
  const correo = correoUnico(cuerpo?.correo);
  const clave = typeof cuerpo?.clave === 'string' ? cuerpo.clave : '';
  if (nombre.length < 2 || nombre.length > 120) throw new ErrorHttp(400, 'Escribe tu nombre.');
  if (!correo) throw new ErrorHttp(400, 'Escribe un correo válido.');
  if (clave.length < 8 || clave.length > 200) {
    throw new ErrorHttp(400, 'La contraseña necesita al menos 8 caracteres.');
  }

  const id = randomUUID();
  const hash = await crearHash(clave);
  const vacio = JSON.stringify(ESTADO_VACIO);
  const filas = await sql()`
    WITH nueva AS (
      INSERT INTO cuenta (id, nombre, correo, clave_hash)
      SELECT ${id}::uuid, ${nombre}::text, ${correo}::text, ${hash}::text
      WHERE NOT EXISTS (SELECT 1 FROM acceso_cliente WHERE correo = ${correo}::text)
      ON CONFLICT DO NOTHING
      RETURNING id
    ), est AS (
      INSERT INTO estudio (entrenador_id, datos, version)
      SELECT id, ${vacio}::jsonb, 0 FROM nueva
    )
    SELECT id FROM nueva`;
  if (!filas[0]) throw new ErrorHttp(409, 'Ese correo ya tiene una cuenta. Entra con él.');

  const token = await abrir('entrenador', id);
  return json(
    { sesion: { rol: 'entrenador', nombre, correo, entrenadorId: id, esAdmin: false } },
    200,
    { 'Set-Cookie': cookieSesion(token, req) },
  );
});
