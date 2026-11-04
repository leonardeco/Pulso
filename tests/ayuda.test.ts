import { describe, expect, it } from 'vitest';
import { verificarBasePruebas } from './ayuda';

describe('guarda de la base de pruebas', () => {
  it('aborta con error claro si la URL de pruebas es la real', () => {
    expect(() => verificarBasePruebas('postgres://x/db', 'postgres://x/db')).toThrow(/igual a DATABASE_URL/);
  });
  it('deja pasar URLs distintas o ausentes', () => {
    expect(() => verificarBasePruebas('postgres://x/test', 'postgres://x/db')).not.toThrow();
    expect(() => verificarBasePruebas('', 'postgres://x/db')).not.toThrow();
    expect(() => verificarBasePruebas('postgres://x/test', '')).not.toThrow();
  });
});
