import { sql } from './_lib/db';
import {
  ESTADO_VACIO,
  estaVacio,
  estadoDe,
  validarEstado,
  vistaCliente,
  type Estado,
} from './_lib/estudio';
import { ErrorHttp, aceptaOrigen, error, json, leerJson, manejar } from './_lib/http';
import { exigir } from './_lib/sesion';

const HEX64 = /^[0-9a-f]{64}$/;

async function accesosDe(entrenadorId: string) {
  const filas = await sql()`
    SELECT cliente_id, correo FROM acceso_cliente
    WHERE entrenador_id = ${entrenadorId}::uuid ORDER BY correo`;
  return filas.map((f) => ({ clienteId: String(f['cliente_id']), correo: String(f['correo']) }));
}

async function leer(entrenadorId: string): Promise<{ estado: Estado; version: number }> {
  const filas = await sql()`SELECT datos, version FROM estudio WHERE entrenador_id = ${entrenadorId}::uuid`;
  const f = filas[0];
  if (!f) return { estado: ESTADO_VACIO, version: 0 };
  return { estado: estadoDe(f['datos']), version: Number(f['version']) };
}

interface Legado {
  clienteId: string;
  correo: string;
  sal: string;
  hash: string;
}

function validarLegado(x: unknown, estado: Estado): Legado[] {
  if (x === undefined || x === null) return [];
  if (!Array.isArray(x)) throw new ErrorHttp(400, 'Datos no válidos.');
  const ids = new Set(estado.clientes.map((c) => c.id));
  return x.map((i) => {
    const o = (i ?? {}) as Record<string, unknown>;
    const clienteId = o['clienteId'];
    const sal = o['sal'];
    const hash = o['hash'];
    const correo = typeof o['correo'] === 'string' ? o['correo'].trim().toLowerCase() : '';
    if (
      typeof clienteId !== 'string' ||
      !ids.has(clienteId) ||
      typeof sal !== 'string' ||
      !sal ||
      typeof hash !== 'string' ||
      !HEX64.test(hash) ||
      !correo.includes('@') ||
      correo.length > 254
    ) {
      throw new ErrorHttp(400, 'Datos no válidos.');
    }
    return { clienteId, correo, sal, hash };
  });
}

export const GET = manejar(async (req: Request) => {
  const s = await exigir(req);
  const { estado, version } = await leer(s.cuentaId);
  if (s.rol === 'cliente') {
    return json({ estado: vistaCliente(estado, s.clienteId as string), version });
  }
  return json({ estado: { ...estado, accesos: await accesosDe(s.cuentaId) }, version });
});

export const PUT = manejar(async (req: Request) => {
  if (!aceptaOrigen(req)) return error('Origen no permitido.', 403);
  const s = await exigir(req, 'entrenador');
  const cuerpo = (await leerJson(req)) as { version?: unknown; estado?: unknown; accesosLegado?: unknown } | null;
  const version = cuerpo?.version;
  const estado = validarEstado(cuerpo?.estado);
  if (!estado || typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
    throw new ErrorHttp(400, 'Datos no válidos.');
  }

  const previo = await leer(s.cuentaId);
  const legado = estaVacio(previo.estado) ? validarLegado(cuerpo?.accesosLegado, estado) : [];

  const datos = JSON.stringify(estado);
  const ids = JSON.stringify(estado.clientes.map((c) => c.id));
  const filas = await sql()`
    WITH act AS (
      UPDATE estudio SET datos = ${datos}::jsonb, version = version + 1, actualizado_en = now()
      WHERE entrenador_id = ${s.cuentaId}::uuid AND version = ${version}::int
      RETURNING version
    ), borra AS (
      DELETE FROM acceso_cliente
      WHERE entrenador_id = ${s.cuentaId}::uuid
        AND EXISTS (SELECT 1 FROM act)
        AND cliente_id <> ALL(ARRAY(SELECT jsonb_array_elements_text(${ids}::jsonb)))
      RETURNING 1
    ), cierra AS (
      DELETE FROM sesion
      WHERE rol = 'cliente' AND cuenta_id = ${s.cuentaId}::uuid
        AND EXISTS (SELECT 1 FROM act)
        AND cliente_id <> ALL(ARRAY(SELECT jsonb_array_elements_text(${ids}::jsonb)))
      RETURNING 1
    )
    SELECT version FROM act`;
  if (!filas[0]) {
    const actual = await leer(s.cuentaId);
    return json(
      { estado: { ...actual.estado, accesos: await accesosDe(s.cuentaId) }, version: actual.version },
      409,
    );
  }

  for (const l of legado) {
    await sql()`
      INSERT INTO acceso_cliente (cliente_id, entrenador_id, correo, clave_hash)
      SELECT ${l.clienteId}::text, ${s.cuentaId}::uuid, ${l.correo}::text, ${`sha256$${l.sal}$${l.hash}`}::text
      WHERE NOT EXISTS (SELECT 1 FROM cuenta WHERE correo = ${l.correo}::text)
      ON CONFLICT DO NOTHING`;
  }
  return json({ version: Number(filas[0]['version']), accesos: await accesosDe(s.cuentaId) });
});
