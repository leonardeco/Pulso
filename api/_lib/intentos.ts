import { createHash } from 'node:crypto';
import { sql } from './db';

function id(clave: string): string {
  return createHash('sha256').update(clave).digest('hex');
}

export async function bloqueado(clave: string, max: number): Promise<boolean> {
  const filas = await sql()`SELECT fallos FROM intento WHERE clave = ${id(clave)} AND hasta >= now()`;
  return filas.length > 0 && Number(filas[0]['fallos']) >= max;
}

export async function fallo(clave: string, max: number, minutos: number): Promise<boolean> {
  const filas = await sql()`
    INSERT INTO intento (clave, fallos, hasta)
    VALUES (${id(clave)}, 1, now() + make_interval(mins => ${minutos}))
    ON CONFLICT (clave) DO UPDATE SET
      fallos = CASE WHEN intento.hasta < now() THEN 1 ELSE intento.fallos + 1 END,
      hasta = CASE WHEN intento.hasta < now() THEN now() + make_interval(mins => ${minutos}) ELSE intento.hasta END
    RETURNING fallos`;
  return Number(filas[0]['fallos']) >= max;
}

export async function limpiar(clave: string): Promise<void> {
  await sql()`DELETE FROM intento WHERE clave = ${id(clave)}`;
}
