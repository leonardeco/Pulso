import { randomInt } from 'node:crypto';
import { HASH_FALSO, crearHash, verificar } from './_lib/clave';
import { correoConfigurado, enviarCodigo } from './_lib/correo';
import { sql } from './_lib/db';
import { aceptaOrigen, cookieSesion, error, ipDe, json, leerJson, manejar } from './_lib/http';
import { bloqueado, fallo, limpiar } from './_lib/intentos';
import { abrir } from './_lib/sesion';

const NO_COINCIDE = 'Ese código no coincide o venció. Pide otro.';

export const POST = manejar(async (req: Request) => {
  if (!aceptaOrigen(req)) return error('Origen no permitido.', 403);
  const cuerpo = (await leerJson(req)) as {
    accion?: unknown;
    correo?: unknown;
    codigo?: unknown;
    clave?: unknown;
  } | null;
  const correo = typeof cuerpo?.correo === 'string' ? cuerpo.correo.trim().toLowerCase() : '';
  if (!correo.includes('@') || correo.length > 254) return error('Escribe un correo válido.', 400);
  const accion = cuerpo?.accion;
  if (accion !== 'pedir' && accion !== 'confirmar' && accion !== 'cambiar') {
    return error('Acción no válida.', 400);
  }

  if (accion === 'pedir') return pedir(req, correo);

  const llave = `recuperar:${ipDe(req)}:${correo}`;
  if (await bloqueado(llave, 10)) return error('Demasiados intentos. Espera 15 minutos.', 429);
  const codigo = typeof cuerpo?.codigo === 'string' ? cuerpo.codigo : '';
  if (!/^\d{6}$/.test(codigo)) return error('El código tiene 6 números.', 400);
  const clave = typeof cuerpo?.clave === 'string' ? cuerpo.clave : '';
  if (accion === 'cambiar' && (clave.length < 8 || clave.length > 200)) {
    return error('La contraseña necesita al menos 8 caracteres.', 400);
  }

  const filas = await sql()`
    SELECT r.cuenta_id, r.codigo_hash
    FROM recuperacion r JOIN cuenta c ON c.id = r.cuenta_id
    WHERE c.correo = ${correo} AND r.expira > now()`;
  const fila = filas[0];
  const r = await verificar(codigo, fila ? String(fila['codigo_hash']) : HASH_FALSO);
  if (!fila || !r.ok) {
    if (fila) {
      const cuentaId = String(fila['cuenta_id']);
      const usos = await sql()`
        UPDATE recuperacion SET intentos = intentos + 1 WHERE cuenta_id = ${cuentaId}::uuid RETURNING intentos`;
      if (usos[0] && Number(usos[0]['intentos']) >= 5) {
        await sql()`DELETE FROM recuperacion WHERE cuenta_id = ${cuentaId}::uuid`;
      }
    }
    await fallo(llave, 10, 15);
    return error(NO_COINCIDE, 400);
  }

  if (accion === 'confirmar') return json({ ok: true });

  const cuentaId = String(fila['cuenta_id']);
  const nuevo = await crearHash(clave);
  const cambio = await sql()`
    WITH usado AS (
      DELETE FROM recuperacion
      WHERE cuenta_id = ${cuentaId}::uuid AND codigo_hash = ${String(fila['codigo_hash'])} AND expira > now()
      RETURNING cuenta_id
    ),
    nueva AS (
      UPDATE cuenta SET clave_hash = ${nuevo}
      WHERE id IN (SELECT cuenta_id FROM usado)
      RETURNING id, nombre, correo, es_admin
    ),
    cerradas AS (
      DELETE FROM sesion WHERE cuenta_id IN (SELECT id FROM nueva)
    )
    SELECT id, nombre, correo, es_admin FROM nueva`;
  const c = cambio[0];
  if (!c) {
    await fallo(llave, 10, 15);
    return error(NO_COINCIDE, 400);
  }
  await limpiar(llave);
  const id = String(c['id']);
  const token = await abrir('entrenador', id);
  return json(
    {
      sesion: {
        rol: 'entrenador',
        nombre: String(c['nombre']),
        correo: String(c['correo']),
        entrenadorId: id,
        esAdmin: Boolean(c['es_admin']),
      },
    },
    200,
    { 'Set-Cookie': cookieSesion(token, req) },
  );
});

async function pedir(req: Request, correo: string): Promise<Response> {
  if (await fallo(`pedir:${ipDe(req)}`, 10, 60)) {
    return error('Demasiados intentos. Inténtalo más tarde.', 429);
  }
  if (!correoConfigurado()) return error('El envío de correo no está disponible por ahora.', 503);

  const cuentas = await sql()`SELECT id FROM cuenta WHERE correo = ${correo}`;
  if (!cuentas[0]) return json({ ok: true });
  const cuentaId = String(cuentas[0]['id']);

  const reciente = await sql()`
    SELECT 1 FROM recuperacion
    WHERE cuenta_id = ${cuentaId}::uuid AND enviado_en > now() - interval '60 seconds'`;
  if (reciente[0]) return json({ ok: true });
  // Se envían los 3 primeros de la hora; el 4.º ya no.
  if (await fallo(`pedircorreo:${correo}`, 4, 60)) return json({ ok: true });

  const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const hash = await crearHash(codigo);
  await sql()`
    INSERT INTO recuperacion (cuenta_id, codigo_hash, expira, intentos, enviado_en)
    VALUES (${cuentaId}::uuid, ${hash}, now() + interval '10 minutes', 0, now())
    ON CONFLICT (cuenta_id) DO UPDATE SET
      codigo_hash = EXCLUDED.codigo_hash, expira = EXCLUDED.expira, intentos = 0, enviado_en = EXCLUDED.enviado_en`;
  try {
    await enviarCodigo(correo, codigo);
  } catch {
    await sql()`DELETE FROM recuperacion WHERE cuenta_id = ${cuentaId}::uuid`;
    console.error('recuperar: no se pudo enviar');
    return error('No pude enviar el correo ahora. Inténtalo en unos minutos.', 503);
  }
  return json({ ok: true });
}
