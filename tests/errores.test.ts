import { afterEach, expect, it, vi } from 'vitest';
import { pedido } from './ayuda';

const CORREO = 'secreto.persona@privado.test';
const CLAVE = 'clave-super-secreta-77';

vi.mock('../api/_lib/db', () => ({
  sql: () => async () => {
    // Un fallo de la base cuyo mensaje arrastra datos del usuario, como podría pasar con un driver real.
    throw Object.assign(new Error(`falló la consulta para ${CORREO} con ${CLAVE}`), { code: '08006' });
  },
}));

afterEach(() => vi.restoreAllMocks());

it('TC-X.1 una excepción interna da 500 genérico y el log no lleva correo ni clave', async () => {
  const { POST: entrar } = await import('../api/entrar');
  const { POST: registro } = await import('../api/registro');
  const espias = (['error', 'warn', 'log', 'info'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));

  const respuestas = [
    await entrar(pedido('POST', '/api/entrar', { correo: CORREO, clave: CLAVE })),
    await registro(pedido('POST', '/api/registro', { nombre: 'Ana', correo: CORREO, clave: CLAVE })),
  ];
  for (const r of respuestas) {
    expect(r.status).toBe(500);
    const texto = await r.text();
    expect(JSON.parse(texto)).toEqual({ error: 'Algo falló. Inténtalo de nuevo.' });
    for (const prohibido of [CORREO, CLAVE, 'clave_hash', 'hash', 'sal']) {
      expect(texto).not.toContain(prohibido);
    }
  }

  const registrado = espias.flatMap((e) => e.mock.calls).map((args) => args.map(String).join(' ')).join('\n');
  expect(registrado.length).toBeGreaterThan(0); // el fallo sí se registra
  expect(registrado).not.toContain(CORREO);
  expect(registrado).not.toContain(CLAVE);
  expect(registrado).not.toContain('secreto.persona');
});
