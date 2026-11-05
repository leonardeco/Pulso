import { describe, expect, it } from 'vitest';
import { MAX_CUERPO } from '../api/_lib/http';
import { LIMITE_CARACTERES } from '../src/app/guardado';

describe('límite de tamaño del estudio', () => {
  it('el límite que avisa el cliente es el mismo que rechaza el servidor', () => {
    expect(LIMITE_CARACTERES).toBe(MAX_CUERPO);
  });
});
