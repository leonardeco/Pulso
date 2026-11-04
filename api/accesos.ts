import { crearHash } from './_lib/clave';
import { sql } from './_lib/db';
import { estadoDe } from './_lib/estudio';
import { ErrorHttp, aceptaOrigen, error, json, leerJson, manejar } from './_lib/http';
import { exigir } from './_lib/sesion';

export const PUT = manejar(async (req: Request) => {
  if (!aceptaOrigen(req)) return error('Origen no permitido.', 403);
  const s = await exigir(req, 'entrenador');
  const cuerpo = (await leerJson(req)) as { clienteId?: unknown; correo?: unknown; clave?: unknown } | null;
  const clienteId = typeof cuerpo?.clienteId === 'string' ? cuerpo.clienteId : '';
  const correo = typeof cuerpo?.correo === 'string' ? cuerpo.correo.trim().toLowerCase() : '';
  const clave = typeof cuerpo?.clave === 'string' ? cuerpo.clave : '';
  if (!correo.includes('@') || correo.length > 254) throw new ErrorHttp(400, 'Escribe un correo válido.');
  if (clave.length < 8 || clave.length > 200) {
    throw new ErrorHttp(400, 'La contraseña necesita al menos 8 caracteres.');
  }

  const est = await sql()`SELECT datos FROM estudio WHERE entrenador_id = ${s.cuentaId}::uuid`;
  const existe = est[0] && estadoDe(est[0]['datos']).clientes.some((c) => c.id === clienteId);
  if (!clienteId || !existe) throw new ErrorHttp(404, 'No encuentro ese cliente.');

  if ((await sql()`SELECT 1 FROM cuenta WHERE correo = ${correo}`)[0]) {
    throw new ErrorHttp(409, 'Ese correo ya es de un entrenador. Usa otro.');
  }
  const otro = await sql()`
    SELECT 1 FROM acceso_cliente
    WHERE correo = ${correo} AND NOT (entrenador_id = ${s.cuentaId}::uuid AND cliente_id = ${clienteId})`;
  if (otro[0]) throw new ErrorHttp(409, 'Ese correo ya lo usa otro cliente.');

  const hash = await crearHash(clave);
  const filas = await sql()`
    WITH ins AS (
      INSERT INTO acceso_cliente (cliente_id, entrenador_id, correo, clave_hash)
      VALUES (${clienteId}, ${s.cuentaId}::uuid, ${correo}, ${hash})
      ON CONFLICT (entrenador_id, cliente_id) DO UPDATE
        SET correo = EXCLUDED.correo, clave_hash = EXCLUDED.clave_hash
      RETURNING cliente_id
    ), cierra AS (
      DELETE FROM sesion
      WHERE rol = 'cliente' AND cuenta_id = ${s.cuentaId}::uuid AND cliente_id = ${clienteId}
        AND EXISTS (SELECT 1 FROM ins)
      RETURNING 1
    ), sube AS (
      UPDATE estudio SET version = version + 1, actualizado_en = now()
      WHERE entrenador_id = ${s.cuentaId}::uuid AND EXISTS (SELECT 1 FROM ins)
      RETURNING version
    )
    SELECT version FROM sube`;
  if (!filas[0]) throw new ErrorHttp(404, 'No encuentro ese cliente.');
  return json({ clienteId, correo, version: Number(filas[0]['version']) });
});

export const DELETE = manejar(async (req: Request) => {
  if (!aceptaOrigen(req)) return error('Origen no permitido.', 403);
  const s = await exigir(req, 'entrenador');
  const cuerpo = (await leerJson(req)) as { clienteId?: unknown } | null;
  const clienteId = typeof cuerpo?.clienteId === 'string' ? cuerpo.clienteId : '';
  if (!clienteId) throw new ErrorHttp(400, 'Datos no válidos.');
  const filas = await sql()`
    WITH borra AS (
      DELETE FROM acceso_cliente
      WHERE cliente_id = ${clienteId} AND entrenador_id = ${s.cuentaId}::uuid
      RETURNING 1
    ), cierra AS (
      DELETE FROM sesion
      WHERE rol = 'cliente' AND cuenta_id = ${s.cuentaId}::uuid AND cliente_id = ${clienteId}
      RETURNING 1
    ), sube AS (
      UPDATE estudio SET version = version + 1, actualizado_en = now()
      WHERE entrenador_id = ${s.cuentaId}::uuid AND EXISTS (SELECT 1 FROM borra)
      RETURNING version
    )
    SELECT COALESCE(
      (SELECT version FROM sube),
      (SELECT version FROM estudio WHERE entrenador_id = ${s.cuentaId}::uuid)
    ) AS version`;
  return json({ ok: true, version: Number(filas[0]?.['version'] ?? 0) });
});
