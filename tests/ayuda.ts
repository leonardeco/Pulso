import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { neon } from '@neondatabase/serverless';
import { beforeAll, describe } from 'vitest';

const URL_PRUEBAS = process.env['PULSO_TEST_DATABASE_URL'] ?? '';
if (!URL_PRUEBAS && process.env['CI']) {
  throw new Error('Falta PULSO_TEST_DATABASE_URL: en CI las pruebas de base de datos no se omiten.');
}

export function verificarBasePruebas(prueba: string, real: string): void {
  if (prueba && real && prueba.trim() === real.trim()) {
    throw new Error(
      'PULSO_TEST_DATABASE_URL es igual a DATABASE_URL: las pruebas vacían tablas y no pueden correr contra la base real. Usa una base aparte.',
    );
  }
}

verificarBasePruebas(URL_PRUEBAS, process.env['DATABASE_URL'] ?? '');
if (URL_PRUEBAS) process.env['DATABASE_URL'] = URL_PRUEBAS;

export const describeDb: typeof describe = (URL_PRUEBAS ? describe : describe.skip) as typeof describe;

export function prepararDb(): void {
  beforeAll(async () => {
    const db = neon(URL_PRUEBAS);
    const migracion = readFileSync(join(process.cwd(), 'db', 'migraciones', '001_cuentas_estudio.sql'), 'utf8');
    for (const sentencia of migracion.split(';').map((s) => s.trim()).filter(Boolean)) {
      await db.query(sentencia);
    }
    await db`TRUNCATE cuenta, acceso_cliente, sesion, estudio, intento CASCADE`;
  }, 60000);
}

export function pedido(
  metodo: string,
  ruta: string,
  cuerpo?: unknown,
  cookie?: string,
  extra: Record<string, string> = {},
): Request {
  const headers: Record<string, string> = { host: 'pulso.test', ...extra };
  if (metodo !== 'GET') headers['origin'] = headers['origin'] ?? 'https://pulso.test';
  if (cuerpo !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers['cookie'] = cookie;
  return new Request(`https://pulso.test${ruta}`, {
    method: metodo,
    headers,
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
}

export function cookieDe(res: Response): string {
  const c = res.headers.get('set-cookie') ?? '';
  return c.split(';')[0] ?? '';
}
