import { createHash } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { expect, it } from 'vitest';
import { DELETE as quitar, PUT as acceso } from '../api/accesos';
import { POST as entrar } from '../api/entrar';
import { GET as panel } from '../api/panel';
import { POST as registro } from '../api/registro';
import { GET as verSesion } from '../api/sesion';
import { GET as leer, PUT as guardar } from '../api/estudio';
import { cookieDe, describeDb, pedido, prepararDb } from './ayuda';

const cli = (id: string, nombre: string) => ({
  id, nombre, telefono: '1', correo: 'a@b.c', objetivo: 'meta', notas: 'secreto',
  peso: '70', estatura: '170', mensualidad: 100, valoracionMensual: 50, modalidad: 'virtual',
});
const estadoCon = (...ids: string[]) => ({
  servicios: [{ id: 's1', nombre: 'Sesion', minutos: 60, precio: 30 }],
  horario: {},
  clientes: ids.map((i) => cli(i, `N${i}`)),
  citas: ids.map((i) => ({ id: `a${i}`, servicioId: 's1', clienteId: i, fecha: '2026-01-01', hora: '08:00', estado: 'pendiente' })),
  rutinas: [],
  tablas: [],
  pagos: [{ id: 'p1', clienteId: ids[0] }],
  accesos: [],
});

describeDb('rutas del estudio', () => {
  prepararDb();
  let n = 0;
  const nuevo = async (correo: string) => {
    n += 1;
    const ip = { 'x-forwarded-for': `9.9.9.${n}` };
    const r = await registro(pedido('POST', '/api/registro', { nombre: 'Ent', correo, clave: 'secreta123' }, undefined, ip));
    expect(r.status).toBe(200);
    return cookieDe(r);
  };
  const login = async (correo: string, clave: string) => {
    n += 1;
    const r = await entrar(pedido('POST', '/api/entrar', { correo, clave }, undefined, { 'x-forwarded-for': `8.8.8.${n}` }));
    return { r, cookie: cookieDe(r) };
  };
  const put = (cookie: string, version: number, estado: unknown, extra: object = {}) =>
    guardar(pedido('PUT', '/api/estudio', { version, estado, ...extra }, cookie));
  const get = async (cookie: string) =>
    (await (await leer(pedido('GET', '/api/estudio', undefined, cookie))).json()) as {
      estado: ReturnType<typeof estadoCon> & { accesos: unknown[] };
      version: number;
    };
  const dar = (cookie: string, clienteId: string, correo: string) =>
    acceso(pedido('PUT', '/api/accesos', { clienteId, correo, clave: 'clavecli123' }, cookie));
  const sesionDe = async (cookie: string) =>
    ((await (await verSesion(pedido('GET', '/api/sesion', undefined, cookie))).json()) as { sesion: unknown }).sesion;

  it('A guarda y B lee igual; versión vieja da 409 sin cambios', async () => {
    const a = await nuevo('uno@x.com');
    const b = (await login('uno@x.com', 'secreta123')).cookie;
    const r = await put(a, 0, estadoCon('c1'));
    expect(r.status).toBe(200);
    expect(((await r.json()) as { version: number }).version).toBe(1);
    const v = await get(b);
    expect(v.version).toBe(1);
    expect(v.estado.clientes.map((c) => c.id)).toEqual(['c1']);

    const viejo = await put(b, 0, estadoCon('c1', 'c9'));
    expect(viejo.status).toBe(409);
    const c = (await viejo.json()) as { estado: { clientes: unknown[] }; version: number };
    expect(c.version).toBe(1);
    expect(c.estado.clientes).toHaveLength(1);
    expect((await get(a)).estado.clientes).toHaveLength(1);
    expect((await put(a, 1, { nada: 1 })).status).toBe(400);
  });

  it('cliente: GET sin pagos ni notas, PUT 403; IDOR 404; quitar cliente borra acceso y sesión', async () => {
    const a = await nuevo('dos@x.com');
    const otro = await nuevo('tres@x.com');
    await put(a, 0, estadoCon('d1', 'd2'));
    await put(otro, 0, estadoCon('z1'));
    expect((await dar(a, 'd1', 'cli1@x.com')).status).toBe(200);
    expect((await dar(a, 'd1', 'dos@x.com')).status).toBe(409);
    expect((await dar(a, 'd2', 'cli1@x.com')).status).toBe(409);
    expect((await dar(a, 'z1', 'cli9@x.com')).status).toBe(404);
    expect((await dar(otro, 'd1', 'cli8@x.com')).status).toBe(404);

    const { r, cookie: cc } = await login('cli1@x.com', 'clavecli123');
    expect(r.status).toBe(200);
    const g = await leer(pedido('GET', '/api/estudio', undefined, cc));
    const txt = await g.text();
    expect(txt).not.toContain('secreto');
    const vc = JSON.parse(txt) as { estado: { pagos: unknown[]; clientes: { id: string }[] } };
    expect(vc.estado.pagos).toEqual([]);
    expect(vc.estado.clientes.map((c) => c.id)).toEqual(['d1']);
    expect((await put(cc, 1, estadoCon('d1'))).status).toBe(403);

    const ta = await get(a);
    expect(ta.estado.accesos).toEqual([{ clienteId: 'd1', correo: 'cli1@x.com' }]);
    expect(await sesionDe(cc)).not.toBeNull();
    expect((await put(a, ta.version, estadoCon('d2'))).status).toBe(200);
    expect(await sesionDe(cc)).toBeNull();
    expect((await leer(pedido('GET', '/api/estudio', undefined, cc))).status).toBe(401);
    expect((await get(a)).estado.accesos).toEqual([]);

    await dar(a, 'd2', 'cli2@x.com');
    const c2 = (await login('cli2@x.com', 'clavecli123')).cookie;
    expect((await quitar(pedido('DELETE', '/api/accesos', { clienteId: 'd2' }, a))).status).toBe(200);
    expect((await leer(pedido('GET', '/api/estudio', undefined, c2))).status).toBe(401);
  }, 60000);

  it('accesosLegado: ignorado si hay datos; con vacío entra con hash legado y pasa a scrypt', async () => {
    const sal = 'abc';
    const hash = createHash('sha256').update(`${sal}:viejaclave`).digest('hex');
    const legado = [{ clienteId: 'l1', correo: 'Leg@x.com', sal, hash }];
    const a = await nuevo('cuatro@x.com');
    expect((await put(a, 0, estadoCon('l1'), { accesosLegado: [{ ...legado[0], hash: 'zz' }] })).status).toBe(400);
    const ok = await put(a, 0, estadoCon('l1'), { accesosLegado: legado });
    expect(ok.status).toBe(200);
    const cuerpo = await ok.text();
    expect(JSON.parse(cuerpo).accesos).toEqual([{ clienteId: 'l1', correo: 'leg@x.com' }]);
    expect(cuerpo).not.toContain(hash);
    const { r } = await login('leg@x.com', 'viejaclave');
    expect(r.status).toBe(200);
    const db = neon(process.env['DATABASE_URL'] as string);
    const f = await db`SELECT clave_hash FROM acceso_cliente WHERE cliente_id = 'l1'`;
    expect(String(f[0]['clave_hash'])).toMatch(/^scrypt\$/);

    const b = await nuevo('cinco@x.com');
    await put(b, 0, estadoCon('m1'));
    const ign = await put(b, 1, estadoCon('m1'), { accesosLegado: [{ clienteId: 'm1', correo: 'm1@x.com', sal, hash }] });
    expect(ign.status).toBe(200);
    expect((await get(b)).estado.accesos).toEqual([]);
  }, 60000);

  it('panel: 403 sin es_admin, 200 con él y sin secretos', async () => {
    const a = await nuevo('seis@x.com');
    expect((await panel(pedido('GET', '/api/panel', undefined, a))).status).toBe(403);
    const db = neon(process.env['DATABASE_URL'] as string);
    await db`UPDATE cuenta SET es_admin = true WHERE correo = 'seis@x.com'`;
    const r = await panel(pedido('GET', '/api/panel', undefined, a));
    expect(r.status).toBe(200);
    const t = await r.text();
    const lista = (JSON.parse(t) as { entrenadores: unknown[] }).entrenadores;
    expect(lista.length).toBeGreaterThan(1);
    for (const palabra of ['clave_hash', '"hash"', '"sal"']) expect(t).not.toContain(palabra);
  });
});
