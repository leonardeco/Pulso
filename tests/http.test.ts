import { describe, expect, it } from 'vitest';
import { aceptaOrigen, cookieSesion, ErrorHttp, ipDe, leerJson } from '../api/_lib/http';

const req = (metodo: string, headers: Record<string, string> = {}, url = 'https://pulso.test/api/x') =>
  new Request(url, { method: metodo, headers, body: metodo === 'GET' ? undefined : '{}' });

describe('http', () => {
  it('aceptaOrigen permite GET y mismo host; rechaza otro host y sin Origin', () => {
    expect(aceptaOrigen(req('GET'))).toBe(true);
    expect(aceptaOrigen(req('POST', { origin: 'https://pulso.test', host: 'pulso.test' }))).toBe(true);
    expect(aceptaOrigen(req('POST', { origin: 'https://malo.test', host: 'pulso.test' }))).toBe(false);
    expect(aceptaOrigen(req('POST', { host: 'pulso.test' }))).toBe(false);
  });

  it('cookie es HttpOnly y Secure salvo en local', () => {
    const c = cookieSesion('t', req('GET'));
    expect(c).toContain('HttpOnly');
    expect(c).toContain('Secure');
    expect(cookieSesion('t', req('GET', {}, 'http://localhost:4300/api/x'))).not.toContain('Secure');
  });

  it('leerJson valida tipo, tamaño y formato', async () => {
    await expect(leerJson(req('POST', { 'content-type': 'text/plain' }))).rejects.toMatchObject({
      status: 415,
    });
    const cab = { 'content-type': 'application/json' };
    const mal = new Request('https://pulso.test/', { method: 'POST', headers: cab, body: '{' });
    await expect(leerJson(mal)).rejects.toBeInstanceOf(ErrorHttp);
    const grande = new Request('https://pulso.test/', {
      method: 'POST',
      headers: cab,
      body: 'x'.repeat(1024 * 1024 + 1),
    });
    await expect(leerJson(grande)).rejects.toMatchObject({ status: 413 });
  });

  it('ipDe toma el primer valor', () => {
    expect(ipDe(req('GET', { 'x-forwarded-for': '1.1.1.1, 2.2.2.2' }))).toBe('1.1.1.1');
    expect(ipDe(req('GET'))).toBe('local');
  });
});
