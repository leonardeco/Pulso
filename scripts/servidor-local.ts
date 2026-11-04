import { existsSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PUERTO = 4300;
const RAIZ = resolve(import.meta.dirname, '..');
const ESTATICOS = join(RAIZ, 'dist', 'pulso', 'browser');

if (process.env['PULSO_TEST_DATABASE_URL']) {
  process.env['DATABASE_URL'] = process.env['PULSO_TEST_DATABASE_URL'];
}

const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

async function cuerpoDe(req: IncomingMessage): Promise<Buffer> {
  const partes: Buffer[] = [];
  for await (const p of req) partes.push(p as Buffer);
  return Buffer.concat(partes);
}

async function api(nombre: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const archivo = join(RAIZ, 'api', `${nombre}.ts`);
  if (!/^[a-z]+$/.test(nombre) || !existsSync(archivo)) {
    res.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'No existe.' }));
    return;
  }
  const modulo = (await import(pathToFileURL(archivo).href)) as Record<string, unknown>;
  const metodo = (req.method ?? 'GET').toUpperCase();
  const manejador = modulo[metodo];
  if (typeof manejador !== 'function') {
    res.writeHead(405, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Método no permitido.' }));
    return;
  }
  const cabeceras = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) v.forEach((x) => cabeceras.append(k, x));
    else if (v !== undefined) cabeceras.set(k, v);
  }
  const init: RequestInit = { method: metodo, headers: cabeceras };
  if (metodo !== 'GET' && metodo !== 'HEAD') init.body = new Uint8Array(await cuerpoDe(req));
  const peticion = new Request(`http://${req.headers.host ?? `127.0.0.1:${PUERTO}`}${req.url}`, init);
  const respuesta: Response = await (manejador as (r: Request) => Promise<Response>)(peticion);
  const salida: Record<string, string | string[]> = {};
  respuesta.headers.forEach((v, k) => {
    if (k !== 'set-cookie') salida[k] = v;
  });
  const cookies = respuesta.headers.getSetCookie();
  if (cookies.length) salida['set-cookie'] = cookies;
  res.writeHead(respuesta.status, salida).end(Buffer.from(await respuesta.arrayBuffer()));
}

function estatico(ruta: string, res: ServerResponse): void {
  let archivo = normalize(join(ESTATICOS, ruta));
  if (!archivo.startsWith(ESTATICOS) || !existsSync(archivo) || extname(archivo) === '') {
    archivo = join(ESTATICOS, 'index.html');
  }
  res
    .writeHead(200, { 'Content-Type': TIPOS[extname(archivo)] ?? 'application/octet-stream' })
    .end(readFileSync(archivo));
}

createServer((req, res) => {
  const ruta = new URL(req.url ?? '/', 'http://local').pathname;
  const coincide = /^\/api\/([^/]+)$/.exec(ruta);
  const tarea = coincide ? api(coincide[1], req, res) : Promise.resolve(estatico(ruta, res));
  tarea.catch(() => {
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Algo falló. Inténtalo de nuevo.' }));
  });
}).listen(PUERTO, '127.0.0.1', () => console.log(`Pulso local en http://127.0.0.1:${PUERTO}`));
