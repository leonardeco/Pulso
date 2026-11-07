import { describe, expect, it } from 'vitest';
import type { Rutina } from '../src/app/modelos';
import { htmlRutinas } from '../src/app/exportar';

const rutina = (nombreEjercicio: string): Rutina => ({
  id: 'r1',
  clienteId: null,
  nombre: 'Fuerza',
  precio: 0,
  dias: [
    {
      id: 'd1',
      nombre: 'Lunes',
      ejercicios: [{ id: 'e1', nombre: nombreEjercicio, series: '3', reps: '10', descanso: '60s' }],
    },
  ],
});

describe('htmlRutinas', () => {
  it('escapa < y " en el nombre del ejercicio para que no entren como etiquetas', () => {
    const html = htmlRutinas('Ana', [rutina('<img src=x onerror="alert(1)">')]);
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('onerror="alert(1)"');
  });

  it('no emite ninguna imagen para ningún ejercicio, ni siquiera uno con el campo antiguo imagen', () => {
    const conCampoAntiguo = rutina('Sentadilla');
    Object.assign(conCampoAntiguo.dias[0].ejercicios[0], { imagen: true });
    const html = htmlRutinas('Ana', [conCampoAntiguo, rutina('Plancha'), rutina('Press banca')]);
    expect(html).not.toContain('<img');
  });

  it('conserva un nombre sin caracteres especiales tal cual', () => {
    const html = htmlRutinas('Ana', [rutina('Sentadilla búlgara')]);
    expect(html).toContain('<strong>Sentadilla búlgara</strong>');
  });
});
