import { sql } from './_lib/db';
import { filaPanel, validarEstado } from './_lib/estudio';
import { ErrorHttp, json, manejar } from './_lib/http';
import { exigir } from './_lib/sesion';

export const GET = manejar(async (req: Request) => {
  const s = await exigir(req, 'entrenador');
  if (!s.esAdmin) throw new ErrorHttp(403, 'No tienes permiso para esto.');
  const filas = await sql()`
    SELECT c.id, c.nombre, c.correo, e.datos
    FROM cuenta c LEFT JOIN estudio e ON e.entrenador_id = c.id
    ORDER BY c.creada_en`;
  const entrenadores = filas.map((f) =>
    filaPanel(
      { id: String(f['id']), nombre: String(f['nombre']), correo: String(f['correo']) },
      f['datos'] ? validarEstado(f['datos']) : null,
    ),
  );
  return json({ entrenadores });
});
