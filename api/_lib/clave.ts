import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const N = 32768;
const R = 8;
const P = 1;
const LARGO = 32;
const MAXMEM = 64 * 1024 * 1024;

export const HASH_FALSO = `scrypt$${'0'.repeat(32)}$${'0'.repeat(64)}`;

function derivar(clave: string, sal: Buffer): Promise<Buffer> {
  return new Promise((resolver, rechazar) => {
    scrypt(clave, sal, LARGO, { N, r: R, p: P, maxmem: MAXMEM }, (err, llave) => {
      if (err) rechazar(err);
      else resolver(llave);
    });
  });
}

function iguales(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function crearHash(clave: string): Promise<string> {
  const sal = randomBytes(16);
  const llave = await derivar(clave, sal);
  return `scrypt$${sal.toString('hex')}$${llave.toString('hex')}`;
}

export async function verificar(
  clave: string,
  guardado: string,
): Promise<{ ok: boolean; actualizar: boolean }> {
  const partes = guardado.split('$');
  if (partes.length !== 3 || !/^[0-9a-f]+$/.test(partes[2]) || partes[2].length % 2 !== 0) {
    return { ok: false, actualizar: false };
  }
  const [formato, sal, hash] = partes;
  const esperado = Buffer.from(hash, 'hex');
  if (formato === 'scrypt') {
    if (!/^[0-9a-f]*$/.test(sal) || sal.length % 2 !== 0) return { ok: false, actualizar: false };
    const llave = await derivar(clave, Buffer.from(sal, 'hex'));
    return { ok: iguales(llave, esperado), actualizar: false };
  }
  if (formato === 'sha256') {
    const calculado = createHash('sha256').update(`${sal}:${clave}`).digest();
    const ok = iguales(calculado, esperado);
    return { ok, actualizar: ok };
  }
  return { ok: false, actualizar: false };
}
