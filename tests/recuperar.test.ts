import { beforeEach, describe, expect, it, vi } from 'vitest';

const correos = vi.hoisted(() => ({
  enviados: [] as { para: string; codigo: string }[],
  configurado: true,
  falla: false,
}));

vi.mock('../api/_lib/correo', () => ({
  correoConfigurado: () => correos.configurado,
  enviarCodigo: async (para: string, codigo: string) => {
    if (correos.falla) throw new Error('sin-red');
    correos.enviados.push({ para, codigo });
  },
}));

import { sql } from '../api/_lib/db';
import { POST as entrar } from '../api/entrar';
import { POST as recuperar } from '../api/recuperar';
import { POST as registro } from '../api/registro';
import { GET as sesion } from '../api/sesion';
import { cookieDe, describeDb, pedido, prepararDb } from './ayuda';

let contador = 0;
function ipNueva(): string {
  contador += 1;
  return `10.20.${Math.floor(contador / 250)}.${(contador % 250) + 1}`;
}

describeDb('recuperar contraseña', () => {
  prepararDb();
  vi.setConfig({ testTimeout: 30000 });

  beforeEach(() => {
    correos.enviados.length = 0;
    correos.configurado = true;
    correos.falla = false;
  });

  const llamar = (cuerpo: unknown, ip: string, extra: Record<string, string> = {}) =>
    recuperar(pedido('POST', '/api/recuperar', cuerpo, undefined, { 'x-forwarded-for': ip, ...extra }));
  const texto = async (r: Response) =>
    (await r.json()) as { error?: string; ok?: boolean; sesion?: { correo: string } };

  async function crearCuenta(clave = 'secreta123'): Promise<{ correo: string; cookie: string }> {
    contador += 1;
    const correo = `ent${contador}@mail.com`;
    const r = await registro(
      pedido('POST', '/api/registro', { nombre: 'Ana', correo, clave }, undefined, {
        'x-forwarded-for': ipNueva(),
      }),
    );
    expect(r.status).toBe(200);
    return { correo, cookie: cookieDe(r) };
  }

  async function pedirCodigo(correo: string, ip = ipNueva()): Promise<string> {
    const antes = correos.enviados.length;
    const r = await llamar({ accion: 'pedir', correo }, ip);
    expect(r.status).toBe(200);
    expect(correos.enviados.length).toBe(antes + 1);
    return correos.enviados[antes].codigo;
  }

  const malo = (codigo: string) => (codigo === '000000' ? '111111' : '000000');
  const filas = async (correo: string) =>
    sql()`SELECT r.* FROM recuperacion r JOIN cuenta c ON c.id = r.cuenta_id WHERE c.correo = ${correo}`;
  const estadoSesion = async (cookie: string) =>
    ((await (await sesion(pedido('GET', '/api/sesion', undefined, cookie))).json()) as { sesion: unknown })
      .sesion;

  it('envía un código de 6 números y la respuesta no lo trae', async () => {
    const { correo } = await crearCuenta();
    const r = await llamar({ accion: 'pedir', correo: ` ${correo.toUpperCase()} ` }, ipNueva());
    const cuerpo = await r.text();
    expect(r.status).toBe(200);
    expect(correos.enviados).toHaveLength(1);
    expect(correos.enviados[0].para).toBe(correo);
    expect(correos.enviados[0].codigo).toMatch(/^\d{6}$/);
    expect(cuerpo).toBe('{"ok":true}');
    expect(cuerpo).not.toContain(correos.enviados[0].codigo);
    const fila = (await filas(correo))[0];
    expect(String(fila['codigo_hash'])).not.toContain(correos.enviados[0].codigo);
  });

  it('un correo sin cuenta recibe la misma respuesta y no se envía nada', async () => {
    const { correo } = await crearCuenta();
    const ip = ipNueva();
    const real = await llamar({ accion: 'pedir', correo }, ip);
    const nada = await llamar({ accion: 'pedir', correo: 'nadie@mail.com' }, ip);
    expect(nada.status).toBe(real.status);
    expect(await nada.text()).toBe(await real.text());
    expect(correos.enviados).toHaveLength(1);
    expect(correos.enviados[0].para).toBe(correo);
  });

  it('el correo de un cliente se trata como una cuenta que no existe', async () => {
    const { correo: entrenador } = await crearCuenta();
    const id = String((await sql()`SELECT id FROM cuenta WHERE correo = ${entrenador}`)[0]['id']);
    const cliente = `cli${contador}@mail.com`;
    await sql()`INSERT INTO acceso_cliente (cliente_id, entrenador_id, correo, clave_hash) VALUES ('c1', ${id}::uuid, ${cliente}, 'x')`;
    const r = await llamar({ accion: 'pedir', correo: cliente }, ipNueva());
    expect(r.status).toBe(200);
    expect(correos.enviados).toHaveLength(0);
  });

  it('una segunda petición dentro de 60 segundos no envía otro correo', async () => {
    const { correo } = await crearCuenta();
    await pedirCodigo(correo);
    const r = await llamar({ accion: 'pedir', correo }, ipNueva());
    expect(r.status).toBe(200);
    expect(correos.enviados).toHaveLength(1);
  });

  it('cinco códigos malos invalidan el código y el correcto ya no sirve', async () => {
    const { correo } = await crearCuenta();
    const codigo = await pedirCodigo(correo);
    const ip = ipNueva();
    for (let i = 0; i < 5; i++) {
      const r = await llamar({ accion: 'confirmar', correo, codigo: malo(codigo) }, ip);
      expect(r.status).toBe(400);
      expect((await texto(r)).error).toBe('Ese código no coincide o venció. Pide otro.');
    }
    expect(await filas(correo)).toHaveLength(0);
    expect((await llamar({ accion: 'confirmar', correo, codigo }, ip)).status).toBe(400);
  });

  it('el quinto intento correcto tras cuatro fallos todavía sirve', async () => {
    const { correo } = await crearCuenta();
    const codigo = await pedirCodigo(correo);
    const ip = ipNueva();
    for (let i = 0; i < 4; i++) {
      expect((await llamar({ accion: 'confirmar', correo, codigo: malo(codigo) }, ip)).status).toBe(400);
    }
    expect((await llamar({ accion: 'confirmar', correo, codigo }, ip)).status).toBe(200);
  });

  it('un código vencido falla', async () => {
    const { correo } = await crearCuenta();
    const codigo = await pedirCodigo(correo);
    await sql()`UPDATE recuperacion SET expira = now() - interval '1 minute'
      WHERE cuenta_id = (SELECT id FROM cuenta WHERE correo = ${correo})`;
    const r = await llamar({ accion: 'confirmar', correo, codigo }, ipNueva());
    expect(r.status).toBe(400);
    expect((await texto(r)).error).toBe('Ese código no coincide o venció. Pide otro.');
  });

  it('confirmar con el código correcto no lo consume', async () => {
    const { correo } = await crearCuenta();
    const codigo = await pedirCodigo(correo);
    const ip = ipNueva();
    expect((await llamar({ accion: 'confirmar', correo, codigo }, ip)).status).toBe(200);
    expect(await filas(correo)).toHaveLength(1);
    expect((await llamar({ accion: 'confirmar', correo, codigo }, ip)).status).toBe(200);
  });

  it('cambiar la clave deja entrar con la nueva, cierra las sesiones viejas y abre una nueva', async () => {
    const { correo, cookie } = await crearCuenta('vieja12345');
    expect(await estadoSesion(cookie)).not.toBeNull();
    const codigo = await pedirCodigo(correo);
    const r = await llamar({ accion: 'cambiar', correo, codigo, clave: 'nueva123456' }, ipNueva());
    expect(r.status).toBe(200);
    const nueva = cookieDe(r);
    const cuerpo = await texto(r);
    expect(cuerpo.sesion?.correo).toBe(correo);
    expect(JSON.stringify(cuerpo)).not.toContain(codigo);
    expect(await estadoSesion(cookie)).toBeNull();
    expect(await estadoSesion(nueva)).not.toBeNull();

    const conNueva = await entrar(
      pedido('POST', '/api/entrar', { correo, clave: 'nueva123456' }, undefined, {
        'x-forwarded-for': ipNueva(),
      }),
    );
    expect(conNueva.status).toBe(200);
    const conVieja = await entrar(
      pedido('POST', '/api/entrar', { correo, clave: 'vieja12345' }, undefined, {
        'x-forwarded-for': ipNueva(),
      }),
    );
    expect(conVieja.status).toBe(401);
  });

  it('el mismo código usado dos veces falla la segunda', async () => {
    const { correo } = await crearCuenta();
    const codigo = await pedirCodigo(correo);
    const ip = ipNueva();
    expect((await llamar({ accion: 'cambiar', correo, codigo, clave: 'nueva123456' }, ip)).status).toBe(200);
    expect((await llamar({ accion: 'cambiar', correo, codigo, clave: 'otra1234567' }, ip)).status).toBe(400);
  });

  it('una clave de 7 caracteres da 400 y el código sigue sirviendo', async () => {
    const { correo } = await crearCuenta();
    const codigo = await pedirCodigo(correo);
    const ip = ipNueva();
    const corta = await llamar({ accion: 'cambiar', correo, codigo, clave: '1234567' }, ip);
    expect(corta.status).toBe(400);
    expect((await texto(corta)).error).toBe('La contraseña necesita al menos 8 caracteres.');
    const conMalo = await llamar({ accion: 'cambiar', correo, codigo: malo(codigo), clave: '1234567' }, ip);
    expect((await texto(conMalo)).error).toBe('La contraseña necesita al menos 8 caracteres.');
    expect((await filas(correo))[0]['intentos']).toBe(0);
    expect((await llamar({ accion: 'cambiar', correo, codigo, clave: 'nueva123456' }, ip)).status).toBe(200);
  });

  it('una clave de 200 caracteres sirve y la de 201 da 400', async () => {
    const { correo } = await crearCuenta();
    const codigo = await pedirCodigo(correo);
    const ip = ipNueva();
    expect((await llamar({ accion: 'cambiar', correo, codigo, clave: 'a'.repeat(201) }, ip)).status).toBe(400);
    expect((await llamar({ accion: 'cambiar', correo, codigo, clave: 'a'.repeat(200) }, ip)).status).toBe(200);
  });

  it('un origen ajeno da 403', async () => {
    const { correo } = await crearCuenta();
    const r = await llamar({ accion: 'pedir', correo }, ipNueva(), { origin: 'https://otro.test' });
    expect(r.status).toBe(403);
    expect(correos.enviados).toHaveLength(0);
  });

  it('valida el correo, la acción y el formato del código', async () => {
    const ip = ipNueva();
    expect((await llamar({ accion: 'pedir', correo: 'sin-arroba' }, ip)).status).toBe(400);
    expect((await llamar({ accion: 'pedir', correo: `${'a'.repeat(250)}@m.com` }, ip)).status).toBe(400);
    const r = await llamar({ accion: 'borrar', correo: 'a@b.com' }, ip);
    expect(r.status).toBe(400);
    expect((await texto(r)).error).toBe('Acción no válida.');
    const c = await llamar({ accion: 'confirmar', correo: 'a@b.com', codigo: '12345' }, ip);
    expect((await texto(c)).error).toBe('El código tiene 6 números.');
  });

  it('sin correo configurado da 503 y no crea ninguna fila', async () => {
    const { correo } = await crearCuenta();
    correos.configurado = false;
    const r = await llamar({ accion: 'pedir', correo }, ipNueva());
    expect(r.status).toBe(503);
    expect((await texto(r)).error).toBe('El envío de correo no está disponible por ahora.');
    expect(await filas(correo)).toHaveLength(0);
  });

  it('si el envío falla da 503, no deja fila y no escribe datos en el registro', async () => {
    const { correo } = await crearCuenta();
    correos.falla = true;
    const registroErrores = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = await llamar({ accion: 'pedir', correo }, ipNueva());
    const mensajes = JSON.stringify(registroErrores.mock.calls);
    registroErrores.mockRestore();
    expect(r.status).toBe(503);
    expect((await texto(r)).error).toBe('No pude enviar el correo ahora. Inténtalo en unos minutos.');
    expect(await filas(correo)).toHaveLength(0);
    expect(mensajes).toBe('[["recuperar: no se pudo enviar"]]');
  });

  it('diez fallos seguidos dan 429', async () => {
    const { correo } = await crearCuenta();
    const codigo = await pedirCodigo(correo);
    const ip = ipNueva();
    for (let i = 0; i < 10; i++) {
      expect((await llamar({ accion: 'confirmar', correo, codigo: malo(codigo) }, ip)).status).toBe(400);
    }
    const r = await llamar({ accion: 'confirmar', correo, codigo }, ip);
    expect(r.status).toBe(429);
    expect((await texto(r)).error).toBe('Demasiados intentos. Espera 15 minutos.');
  });

  it('el cuarto pedido en una hora no envía y los tres primeros sí', async () => {
    const { correo } = await crearCuenta();
    for (let i = 0; i < 4; i++) {
      await sql()`UPDATE recuperacion SET enviado_en = now() - interval '2 minutes'
        WHERE cuenta_id = (SELECT id FROM cuenta WHERE correo = ${correo})`;
      const r = await llamar({ accion: 'pedir', correo }, ipNueva());
      expect(r.status).toBe(200);
    }
    expect(correos.enviados).toHaveLength(3);
  });

  it('dos cambios a la vez con el mismo código dan un solo 200', async () => {
    const { correo } = await crearCuenta();
    const codigo = await pedirCodigo(correo);
    const [a, b] = await Promise.all([
      llamar({ accion: 'cambiar', correo, codigo, clave: 'primera12345' }, ipNueva()),
      llamar({ accion: 'cambiar', correo, codigo, clave: 'segunda12345' }, ipNueva()),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
  });
});

describe('correoConfigurado', () => {
  const claves = ['PULSO_CORREO_ARCHIVO', 'VERCEL', 'CORREO_USUARIO', 'CORREO_CLAVE'] as const;
  const guardado: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of claves) {
      guardado[k] = process.env[k];
      delete process.env[k];
    }
    return () => {
      for (const k of claves) {
        if (guardado[k] === undefined) delete process.env[k];
        else process.env[k] = guardado[k];
      }
    };
  });
  const real = async () =>
    (await vi.importActual<typeof import('../api/_lib/correo')>('../api/_lib/correo')).correoConfigurado;

  it('es falso con el archivo de pruebas dentro de Vercel y sin variables de correo', async () => {
    process.env['PULSO_CORREO_ARCHIVO'] = 'test-results/correos.jsonl';
    process.env['VERCEL'] = '1';
    expect((await real())()).toBe(false);
  });

  it('es falso con las variables vacías o solo espacios', async () => {
    process.env['CORREO_USUARIO'] = '  ';
    process.env['CORREO_CLAVE'] = '';
    expect((await real())()).toBe(false);
  });

  it('es cierto con el archivo de pruebas fuera de Vercel o con las dos variables', async () => {
    process.env['PULSO_CORREO_ARCHIVO'] = 'test-results/correos.jsonl';
    expect((await real())()).toBe(true);
    delete process.env['PULSO_CORREO_ARCHIVO'];
    process.env['CORREO_USUARIO'] = 'a@gmail.com';
    process.env['CORREO_CLAVE'] = 'abcd';
    expect((await real())()).toBe(true);
  });
});
