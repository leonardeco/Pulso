export class ErrorHttp extends Error {
  constructor(
    public status: number,
    public texto: string,
  ) {
    super(texto);
    this.name = 'ErrorHttp';
  }
}

const MAX_CUERPO = 1024 * 1024;
const COOKIE = 'pulso_sesion';

export function json(data: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

export function error(texto: string, status: number): Response {
  return json({ error: texto }, status);
}

export async function leerJson(req: Request): Promise<unknown> {
  const tipo = req.headers.get('content-type') ?? '';
  if (!tipo.toLowerCase().includes('application/json')) {
    throw new ErrorHttp(415, 'Formato no admitido.');
  }
  const texto = await req.text();
  if (texto.length > MAX_CUERPO) throw new ErrorHttp(413, 'Los datos son demasiado grandes.');
  try {
    return JSON.parse(texto);
  } catch {
    throw new ErrorHttp(400, 'Datos no válidos.');
  }
}

export function aceptaOrigen(req: Request): boolean {
  if (req.method === 'GET') return true;
  const origen = req.headers.get('origin');
  if (!origen) return false;
  const host = req.headers.get('host') ?? new URL(req.url).host;
  try {
    return new URL(origen).host === host;
  } catch {
    return false;
  }
}

function esLocal(req: Request): boolean {
  const url = req.url;
  return url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1');
}

export function cookieSesion(token: string, req: Request): string {
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${esLocal(req) ? '' : '; Secure'}`;
}

export function borrarCookie(req: Request): string {
  return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${esLocal(req) ? '' : '; Secure'}`;
}

export function ipDe(req: Request): string {
  const valor = req.headers.get('x-forwarded-for');
  const primero = valor?.split(',')[0]?.trim();
  return primero || 'local';
}

export function manejar(fn: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req) => {
    try {
      return await fn(req);
    } catch (e) {
      if (e instanceof ErrorHttp) return error(e.texto, e.status);
      console.error(e instanceof Error ? e.name : 'Error');
      return error('Algo falló. Inténtalo de nuevo.', 500);
    }
  };
}
