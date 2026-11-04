import { expect, it } from 'vitest';
import { POST as entrar } from '../api/entrar';
import { POST as registro } from '../api/registro';
import { DELETE as salir, GET as sesion } from '../api/sesion';
import { cookieDe, describeDb, pedido, prepararDb } from './ayuda';

describeDb('cuenta', () => {
  prepararDb();
  const ip = (n: string) => ({ 'x-forwarded-for': n });
  const ver = async (cookie?: string) =>
    ((await (await sesion(pedido('GET', '/api/sesion', undefined, cookie))).json()) as {
      sesion: { rol: string; correo: string } | null;
    }).sesion;

  it('registra, entra desde otro dispositivo y sale', async () => {
    const r = await registro(
      pedido('POST', '/api/registro', { nombre: 'Ana', correo: ' Ana@Mail.com ', clave: 'secreta123' }, undefined, ip('1.1.1.1')),
    );
    expect(r.status).toBe(200);
    expect(r.headers.get('set-cookie')).toContain('HttpOnly');
    const c1 = cookieDe(r);
    expect(JSON.stringify(await r.json())).not.toContain('clave_hash');

    const e = await entrar(
      pedido('POST', '/api/entrar', { correo: 'ana@mail.com', clave: 'secreta123' }, undefined, ip('2.2.2.2')),
    );
    expect(e.status).toBe(200);
    expect(e.headers.get('set-cookie')).toContain('HttpOnly');
    const c2 = cookieDe(e);
    expect(c2).not.toBe(c1);
    const s = await ver(c2);
    expect(s?.rol).toBe('entrenador');
    expect(s?.correo).toBe('ana@mail.com');

    expect((await salir(pedido('DELETE', '/api/sesion', undefined, c2))).status).toBe(200);
    expect(await ver(c2)).toBeNull();
    expect(await ver(c1)).not.toBeNull();
    expect(await ver()).toBeNull();
  });

  it('correo duplicado da 409', async () => {
    const r = await registro(
      pedido('POST', '/api/registro', { nombre: 'Ana', correo: 'ana@mail.com', clave: 'otraclave99' }, undefined, ip('3.3.3.3')),
    );
    expect(r.status).toBe(409);
  });

  it('valida el registro', async () => {
    const r = await registro(
      pedido('POST', '/api/registro', { nombre: 'Ana', correo: 'x@y.com', clave: 'corta' }, undefined, ip('4.4.4.4')),
    );
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toBe('La contraseña necesita al menos 8 caracteres.');
  });

  it('clave mala y correo inexistente dan el mismo 401; 8 fallos bloquean', async () => {
    const intento = (correo: string) =>
      entrar(pedido('POST', '/api/entrar', { correo, clave: 'incorrecta1' }, undefined, ip('5.5.5.5')));
    const mala = await intento('ana@mail.com');
    const nada = await intento('nadie@mail.com');
    expect(mala.status).toBe(401);
    expect(nada.status).toBe(401);
    expect(await mala.json()).toEqual(await nada.json());
    for (let i = 0; i < 7; i++) await intento('ana@mail.com');
    expect((await intento('ana@mail.com')).status).toBe(429);
  }, 60000);

  it('Origin ajeno da 403', async () => {
    const malo = { origin: 'https://malo.test' };
    const a = pedido('POST', '/api/entrar', { correo: 'a@b.c', clave: 'x' }, undefined, malo);
    expect((await entrar(a)).status).toBe(403);
    const b = pedido('POST', '/api/registro', { nombre: 'Ana', correo: 'a@b.c', clave: 'x' }, undefined, malo);
    expect((await registro(b)).status).toBe(403);
    const c = pedido('DELETE', '/api/sesion', undefined, undefined, malo);
    expect((await salir(c)).status).toBe(403);
  });
});
