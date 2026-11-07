import { describe, expect, it } from 'vitest';
import { resumenEjercicio } from '../src/app/resumen-ejercicio';

describe('resumenEjercicio', () => {
  it('une series, repeticiones y descanso cuando están completos', () => {
    expect(resumenEjercicio({ series: '3', reps: '10', descanso: '60s' })).toBe('3 × 10 · 60s');
  });

  it('respeta el texto libre como 8-12 o AMRAP', () => {
    expect(resumenEjercicio({ series: '4', reps: '8-12', descanso: '90s' })).toBe('4 × 8-12 · 90s');
    expect(resumenEjercicio({ series: '2', reps: 'AMRAP', descanso: '60s' })).toBe('2 × AMRAP · 60s');
  });

  it('omite el descanso vacío sin dejar separadores sueltos', () => {
    expect(resumenEjercicio({ series: '3', reps: '10', descanso: '' })).toBe('3 × 10');
  });

  it('omite las repeticiones vacías sin dejar separadores sueltos', () => {
    expect(resumenEjercicio({ series: '3', reps: '', descanso: '60s' })).toBe('3 · 60s');
  });

  it('omite las series vacías sin dejar separadores sueltos', () => {
    expect(resumenEjercicio({ series: '', reps: '10', descanso: '60s' })).toBe('10 · 60s');
  });

  it('muestra solo el descanso cuando es lo único escrito', () => {
    expect(resumenEjercicio({ series: '', reps: '', descanso: '90s' })).toBe('90s');
  });

  it('ignora los espacios al inicio y al final de cada parte', () => {
    expect(resumenEjercicio({ series: ' 3 ', reps: ' 10', descanso: '60s ' })).toBe('3 × 10 · 60s');
  });

  it('dice Sin datos cuando todo está vacío o en blanco', () => {
    expect(resumenEjercicio({ series: '', reps: '', descanso: '' })).toBe('Sin datos');
    expect(resumenEjercicio({ series: '  ', reps: ' ', descanso: '   ' })).toBe('Sin datos');
    expect(resumenEjercicio({})).toBe('Sin datos');
  });

  it('recorta cada parte a 12 caracteres con puntos suspensivos', () => {
    const resumen = resumenEjercicio({ series: '3', reps: 'hasta el fallo muscular', descanso: '60s' });
    expect(resumen).toBe('3 × hasta el fa… · 60s');
  });

  it('no recorta una parte que mide exactamente 12 caracteres', () => {
    expect(resumenEjercicio({ series: '3', reps: '123456789012', descanso: '' })).toBe('3 × 123456789012');
  });
});
