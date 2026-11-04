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
  const put = async (cookie: string, version: number, estado: unknown, extra: object = {}) => {
    const ses = (await sesionDe(cookie)) as { entrenadorId?: string } | null;
    return guardar(pedido('PUT', '/api/estudio', { entrenadorId: ses?.entrenadorId, version, estado, ...extra }, cookie));
  };
  const get = async (cookie: string) =>
    (await (await leer(pedido('GET', '/api/estudio', undefined, cookie))).json()) as {
      estado: ReturnType<typeof estadoCon> & { accesos: unknown[] };
      version: number;
    };
  const dar = (cookie: string, clienteId: string, correo: string) =>
    acceso(pedido('PUT', '/api/accesos', { clienteId, correo, clave: 'clavecli123' }, cookie));
  const sesionDe = async (cookie: string) =>
    ((await (await verSesion(pedido('GET', '/api/sesion', undefined, cookie))).json()) as { sesion: unknown }).sesion;
  const idDe = async (cookie: string) => ((await sesionDe(cookie)) as { entrenadorId: string }).entrenadorId;
  const db = () => neon(process.env['DATABASE_URL'] as string);

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

  it('el mismo clienteId en dos estudios no interfiere', async () => {
    const a = await nuevo('dup1@x.com');
    const b = await nuevo('dup2@x.com');
    await put(a, 0, estadoCon('k1'));
    await put(b, 0, estadoCon('k1'));
    expect((await dar(a, 'k1', 'ka@x.com')).status).toBe(200);
    expect((await dar(b, 'k1', 'kb@x.com')).status).toBe(200);
    const ca = (await login('ka@x.com', 'clavecli123')).cookie;
    const cb = (await login('kb@x.com', 'clavecli123')).cookie;
    expect(await idDe(ca)).toBe(await idDe(a));
    expect(await idDe(cb)).toBe(await idDe(b));
    expect((await get(a)).estado.accesos).toEqual([{ clienteId: 'k1', correo: 'ka@x.com' }]);
    expect((await get(b)).estado.accesos).toEqual([{ clienteId: 'k1', correo: 'kb@x.com' }]);
    expect((await dar(b, 'k1', 'ka@x.com')).status).toBe(409);
    expect((await quitar(pedido('DELETE', '/api/accesos', { clienteId: 'k1' }, a))).status).toBe(200);
    expect(await sesionDe(ca)).toBeNull();
    expect(await sesionDe(cb)).not.toBeNull();
    expect((await get(b)).estado.accesos).toHaveLength(1);
  }, 60000);

  it('entrenadorId ajeno: 401 sin tocar datos ni accesos; PUT sin entrenadorId da 400', async () => {
    const a = await nuevo('ent1@x.com');
    const b = await nuevo('ent2@x.com');
    await put(a, 0, estadoCon('e1'));
    await dar(a, 'e1', 'e1@x.com');
    const antes = await get(a);
    const ajeno = await idDe(b);
    const r = await put(a, antes.version, estadoCon('e1', 'e9'), { entrenadorId: ajeno });
    expect(r.status).toBe(401);
    expect(((await r.json()) as { error: string }).error).toBe('Tu sesión venció. Entra de nuevo.');
    const despues = await get(a);
    expect(despues.version).toBe(antes.version);
    expect(despues.estado.clientes).toHaveLength(1);
    expect(despues.estado.accesos).toHaveLength(1);
    const sin = await guardar(pedido('PUT', '/api/estudio', { version: antes.version, estado: estadoCon('e1') }, a));
    expect(sin.status).toBe(400);
    expect((await leer(pedido('GET', `/api/estudio?entrenadorId=${ajeno}`, undefined, a))).status).toBe(401);
    const propio = await idDe(a);
    expect((await leer(pedido('GET', `/api/estudio?entrenadorId=${propio}`, undefined, a))).status).toBe(200);
    const cc = (await login('e1@x.com', 'clavecli123')).cookie;
    expect((await leer(pedido('GET', `/api/estudio?entrenadorId=${ajeno}`, undefined, cc))).status).toBe(401);
    expect((await leer(pedido('GET', `/api/estudio?entrenadorId=${propio}`, undefined, cc))).status).toBe(200);
  }, 60000);

  it('accesosLegado: correo ya usado se omite y el estado queda guardado', async () => {
    const sal = 'sal-1';
    const hash = createHash('sha256').update(`${sal}:viejaclave`).digest('hex');
    await nuevo('leg1@x.com');
    const a = await nuevo('leg2@x.com');
    const lista = [
      { clienteId: 'o1', correo: 'leg1@x.com', sal, hash },
      { clienteId: 'o2', correo: 'libre@x.com', sal, hash },
    ];
    const r = await put(a, 0, estadoCon('o1', 'o2'), { accesosLegado: lista });
    expect(r.status).toBe(200);
    const c = (await r.json()) as { accesos: unknown[]; accesosOmitidos: string[] };
    expect(c.accesosOmitidos).toEqual(['leg1@x.com']);
    expect(c.accesos).toEqual([{ clienteId: 'o2', correo: 'libre@x.com' }]);
    expect((await get(a)).estado.clientes).toHaveLength(2);
    const malaSal = await put(await nuevo('leg3@x.com'), 0, estadoCon('o1'), {
      accesosLegado: [{ clienteId: 'o1', correo: 'z@x.com', sal: 'a$b', hash }],
    });
    expect(malaSal.status).toBe(400);
    const muchos = Array.from({ length: 501 }, (_, i) => ({ clienteId: 'o1', correo: `m${i}@x.com`, sal, hash }));
    expect((await put(await nuevo('leg4@x.com'), 0, estadoCon('o1'), { accesosLegado: muchos })).status).toBe(400);
  }, 60000);

  it('estado con elementos nulos da 400', async () => {
    const a = await nuevo('nulo@x.com');
    expect((await put(a, 0, { ...estadoCon('n1'), rutinas: [null] })).status).toBe(400);
  });

  it('dar y quitar acceso suben la versión del estudio', async () => {
    const a = await nuevo('ver@x.com');
    await put(a, 0, estadoCon('v1'));
    const v0 = (await get(a)).version;
    const r1 = await dar(a, 'v1', 'v1@x.com');
    expect(((await r1.json()) as { version: number }).version).toBe(v0 + 1);
    expect((await get(a)).version).toBe(v0 + 1);
    const r2 = await quitar(pedido('DELETE', '/api/accesos', { clienteId: 'v1' }, a));
    expect(((await r2.json()) as { version: number }).version).toBe(v0 + 2);
    expect((await get(a)).version).toBe(v0 + 2);
  }, 60000);

  it('cliente no puede usar accesos ni panel (403)', async () => {
    const a = await nuevo('perm@x.com');
    await put(a, 0, estadoCon('q1'));
    await dar(a, 'q1', 'q1@x.com');
    const cc = (await login('q1@x.com', 'clavecli123')).cookie;
    expect((await dar(cc, 'q1', 'otro@x.com')).status).toBe(403);
    expect((await quitar(pedido('DELETE', '/api/accesos', { clienteId: 'q1' }, cc))).status).toBe(403);
    expect((await panel(pedido('GET', '/api/panel', undefined, cc))).status).toBe(403);
  }, 60000);

  it('un 409 no borra accesos de clientes quitados', async () => {
    const a = await nuevo('c409@x.com');
    await put(a, 0, estadoCon('w1', 'w2'));
    await dar(a, 'w1', 'w1@x.com');
    await dar(a, 'w2', 'w2@x.com');
    const t = await get(a);
    const viejo = await put(a, t.version - 1, estadoCon('w2'));
    expect(viejo.status).toBe(409);
    expect((await get(a)).estado.accesos).toHaveLength(2);
  }, 60000);

  it('sesión vencida da 401', async () => {
    const a = await nuevo('venc@x.com');
    await db()`UPDATE sesion SET expira = now() - interval '1 day' WHERE cuenta_id = ${await idDe(a)}::uuid`;
    expect((await leer(pedido('GET', '/api/estudio', undefined, a))).status).toBe(401);
  });

  it('el 11.º registro desde la misma IP da 429', async () => {
    const ip = { 'x-forwarded-for': '6.6.6.6' };
    for (let i = 0; i < 10; i++) {
      const r = await registro(pedido('POST', '/api/registro', { nombre: 'X', correo: 'no', clave: 'c' }, undefined, ip));
      expect(r.status).toBe(400);
    }
    const r = await registro(
      pedido('POST', '/api/registro', { nombre: 'Xx', correo: 'ok@x.com', clave: 'secreta123' }, undefined, ip),
    );
    expect(r.status).toBe(429);
  }, 60000);

  it('GET /api/sesion de cliente devuelve clienteId, entrenadorId y esAdmin:false', async () => {
    const a = await nuevo('sc@x.com');
    await put(a, 0, estadoCon('s9'));
    await dar(a, 's9', 's9@x.com');
    const cc = (await login('s9@x.com', 'clavecli123')).cookie;
    expect(await sesionDe(cc)).toMatchObject({
      rol: 'cliente',
      clienteId: 's9',
      entrenadorId: await idDe(a),
      esAdmin: false,
    });
  }, 60000);

  it('TC-2.2 dos guardados seguidos dan N+1 y N+2 sin 409', async () => {
    const a = await nuevo('dobles@x.com');
    const antes = (await get(a)).version;
    const r1 = await put(a, antes, estadoCon('g1'));
    expect(r1.status).toBe(200);
    const v1 = ((await r1.json()) as { version: number }).version;
    expect(v1).toBe(antes + 1);
    const r2 = await put(a, v1, estadoCon('g1', 'g2'));
    expect(r2.status).toBe(200);
    expect(((await r2.json()) as { version: number }).version).toBe(antes + 2);
    const final = await get(a);
    expect(final.version).toBe(antes + 2);
    expect(final.estado.clientes.map((c) => c.id)).toEqual(['g1', 'g2']);
  }, 60000);
});
