import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { crearHash, HASH_FALSO, verificar } from '../api/_lib/clave';

describe('clave', () => {
  it('acepta la clave correcta y rechaza la incorrecta', async () => {
    const h = await crearHash('secreta123');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(await verificar('secreta123', h)).toEqual({ ok: true, actualizar: false });
    expect((await verificar('otra', h)).ok).toBe(false);
  });

  it('acepta el hash legado sha256 y pide actualizar', async () => {
    const hash = createHash('sha256').update('sal1:clave1').digest('hex');
    expect(await verificar('clave1', `sha256$sal1$${hash}`)).toEqual({ ok: true, actualizar: true });
    expect((await verificar('mala', `sha256$sal1$${hash}`)).ok).toBe(false);
  });

  it('formato desconocido o hash falso no pasa', async () => {
    expect((await verificar('x', 'md5$a$b')).ok).toBe(false);
    expect((await verificar('x', 'basura')).ok).toBe(false);
    expect((await verificar('x', HASH_FALSO)).ok).toBe(false);
  });
});
