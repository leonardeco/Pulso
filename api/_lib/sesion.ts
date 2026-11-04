import { createHash, randomBytes } from 'node:crypto';
import { sql } from './db';
import { ErrorHttp } from './http';
import { estadoDe } from './estudio';

export interface SesionActual {
  tokenHash: string;
  rol: 'entrenador' | 'cliente';
  cuentaId: string;
  clienteId: string | null;
  nombre: string;
  correo: string;
  esAdmin: boolean;
}

function sha(texto: string): string {
  return createHash('sha256').update(texto).digest('hex');
}

export async function abrir(
  rol: 'entrenador' | 'cliente',
  cuentaId: string,
  clienteId?: string,
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await sql()`DELETE FROM sesion WHERE expira < now()`;
  await sql()`
    INSERT INTO sesion (token_hash, rol, cuenta_id, cliente_id, expira)
    VALUES (${sha(token)}, ${rol}, ${cuentaId}, ${clienteId ?? null}, now() + interval '30 days')`;
  return token;
}

function tokenDe(req: Request): string | null {
  const cookie = req.headers.get('cookie') ?? '';
  for (const parte of cookie.split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === 'pulso_sesion') return v.join('=') || null;
  }
  return null;
}

export async function actual(req: Request): Promise<SesionActual | null> {
  const token = tokenDe(req);
  if (!token) return null;
  const tokenHash = sha(token);
  const filas = await sql()`
    SELECT s.rol, s.cuenta_id, s.cliente_id, c.nombre, c.correo, c.es_admin
    FROM sesion s JOIN cuenta c ON c.id = s.cuenta_id
    WHERE s.token_hash = ${tokenHash} AND s.expira > now()`;
  const f = filas[0];
  if (!f) return null;
  if (f['rol'] === 'entrenador') {
    return {
      tokenHash,
      rol: 'entrenador',
      cuentaId: String(f['cuenta_id']),
      clienteId: null,
      nombre: String(f['nombre']),
      correo: String(f['correo']),
      esAdmin: Boolean(f['es_admin']),
    };
  }
  const clienteId = f['cliente_id'] == null ? null : String(f['cliente_id']);
  if (!clienteId) return null;
  const acceso = await sql()`
    SELECT a.correo, e.datos
    FROM acceso_cliente a LEFT JOIN estudio e ON e.entrenador_id = a.entrenador_id
    WHERE a.entrenador_id = ${String(f['cuenta_id'])} AND a.cliente_id = ${clienteId}`;
  if (!acceso[0]) return null;
  let nombre = '';
  if (acceso[0]['datos']) {
    nombre = estadoDe(acceso[0]['datos']).clientes.find((c) => c.id === clienteId)?.nombre ?? '';
  }
  return {
    tokenHash,
    rol: 'cliente',
    cuentaId: String(f['cuenta_id']),
    clienteId,
    nombre,
    correo: String(acceso[0]['correo']),
    esAdmin: false,
  };
}

export async function cerrar(tokenHash: string): Promise<void> {
  await sql()`DELETE FROM sesion WHERE token_hash = ${tokenHash}`;
}

export async function exigir(req: Request, rol?: 'entrenador' | 'cliente'): Promise<SesionActual> {
  const s = await actual(req);
  if (!s) throw new ErrorHttp(401, 'Entra para continuar.');
  if (rol && s.rol !== rol) throw new ErrorHttp(403, 'No tienes permiso para esto.');
  return s;
}
