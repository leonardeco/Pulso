import { describe, expect, it } from 'vitest';
import { cercaDelLimite, estadoDeGuardado } from '../src/app/guardado';

const base = { pendiente: false, enVuelo: false, msEnVuelo: 0, conError: false };

describe('estado de guardado', () => {
  it('sin cambios ni envío en curso está al día', () => {
    expect(estadoDeGuardado(base)).toBe('al-dia');
  });

  it('con cambios sin enviar queda pendiente', () => {
    expect(estadoDeGuardado({ ...base, pendiente: true })).toBe('pendiente');
  });

  it('con el envío recién empezado sigue pendiente', () => {
    expect(estadoDeGuardado({ ...base, enVuelo: true, msEnVuelo: 999 })).toBe('pendiente');
  });

  it('con el envío en curso desde un segundo pasa a guardando', () => {
    expect(estadoDeGuardado({ ...base, enVuelo: true, msEnVuelo: 1000 })).toBe('guardando');
    expect(estadoDeGuardado({ ...base, pendiente: true, enVuelo: true, msEnVuelo: 5000 })).toBe('guardando');
  });

  it('con un error no se da por al día', () => {
    expect(estadoDeGuardado({ ...base, conError: true })).toBe('pendiente');
  });

  it('el tiempo sin envío en curso no cuenta como guardando', () => {
    expect(estadoDeGuardado({ ...base, msEnVuelo: 5000 })).toBe('al-dia');
  });
});

describe('cercanía del límite', () => {
  it('avisa desde el 90 % del límite', () => {
    expect(cercaDelLimite(900, 1000)).toBe(true);
    expect(cercaDelLimite(1000, 1000)).toBe(true);
  });

  it('no avisa por debajo del 90 %', () => {
    expect(cercaDelLimite(899, 1000)).toBe(false);
    expect(cercaDelLimite(0, 1000)).toBe(false);
  });
});
