import { describe, expect, it } from 'vitest';
import { correoUnico } from '../api/_lib/validar';

describe('correoUnico', () => {
  it('acepta una dirección simple y la deja recortada y en minúsculas', () => {
    expect(correoUnico('a@b.co')).toBe('a@b.co');
    expect(correoUnico('  Ana@Mail.COM ')).toBe('ana@mail.com');
  });

  it('rechaza listas de direcciones', () => {
    expect(correoUnico('a@x.com,b@y.com')).toBeNull();
    expect(correoUnico('a@x.com;b@y.com')).toBeNull();
    expect(correoUnico('Nombre <a@x.com>')).toBeNull();
  });

  it('rechaza espacios, dominios sin punto y valores que no son texto', () => {
    expect(correoUnico('a b@x.com')).toBeNull();
    expect(correoUnico('a@x.com b@y.com')).toBeNull();
    expect(correoUnico('a@localhost')).toBeNull();
    expect(correoUnico('sin-arroba')).toBeNull();
    expect(correoUnico(42)).toBeNull();
    expect(correoUnico(undefined)).toBeNull();
  });

  it('acepta 254 caracteres y rechaza 255', () => {
    const largo = (total: number) => `${'a'.repeat(total - '@x.com'.length)}@x.com`;
    expect(correoUnico(largo(254))).toBe(largo(254));
    expect(correoUnico(largo(255))).toBeNull();
  });
});
