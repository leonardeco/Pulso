import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';

const BASE = 'http://127.0.0.1:4300';
const CLAVE = 'clave-larga-123';
const CLAVE_NUEVA = 'clave-nueva-456';
const ARCHIVO = 'test-results/correos.jsonl';
let contador = 0;

function correo(prefijo: string): string {
  contador += 1;
  return `${prefijo}-${Date.now()}-${contador}-${randomUUID().slice(0, 6)}@e2e.test`;
}

// Cada contexto es un dispositivo; la IP propia evita compartir los límites.
async function dispositivo(browser: Browser): Promise<BrowserContext> {
  const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 390, height: 844 } });
  await ctx.route('**/api/**', (ruta) =>
    ruta.continue({ headers: { ...ruta.request().headers(), 'x-forwarded-for': ip } }),
  );
  return ctx;
}

// En móvil, enfocar una contraseña oculta el resto del formulario hasta soltar el foco.
async function escribirClave(campo: Locator, valor: string, visible: Locator): Promise<void> {
  await campo.fill(valor);
  await campo.blur();
  await expect(visible).toBeVisible();
}

async function registrar(page: Page, mail: string, clave = CLAVE): Promise<void> {
  await page.goto('/registro');
  await page.locator('input[name=nombre]').fill('Entrenadora Prueba');
  await page.locator('input[name=correo]').fill(mail);
  const crear = page.getByRole('button', { name: 'Crear cuenta' });
  await escribirClave(page.locator('input[name=clave]'), clave, page.locator('input[name=confirma]'));
  await escribirClave(page.locator('input[name=confirma]'), clave, crear);
  await crear.click();
  await expect(page.getByRole('link', { name: 'Clientes', exact: true })).toBeVisible();
}

async function entrar(page: Page, mail: string, clave = CLAVE): Promise<void> {
  await page.goto('/entrar');
  await page.locator('input[name=correo]').fill(mail);
  const boton = page.getByRole('button', { name: 'Entrar', exact: true });
  await escribirClave(page.locator('input[name=clave]'), clave, boton);
  await boton.click();
  const alerta = page.getByRole('alert');
  await Promise.race([
    page.waitForURL((u) => !u.pathname.startsWith('/entrar')),
    alerta.waitFor().then(async () => {
      throw new Error(`La entrada fue rechazada: ${await alerta.innerText()}`);
    }),
  ]);
}

function correosDe(mail: string): { para: string; codigo: string }[] {
  if (!existsSync(ARCHIVO)) return [];
  return readFileSync(ARCHIVO, 'utf8')
    .split('\n')
    .filter((linea) => linea.trim())
    .map((linea) => JSON.parse(linea) as { para: string; codigo: string })
    .filter((c) => c.para === mail);
}

async function codigoEnviado(mail: string): Promise<string> {
  await expect.poll(() => correosDe(mail).length).toBeGreaterThan(0);
  return correosDe(mail).at(-1)!.codigo;
}

async function pedirCodigo(page: Page, mail: string): Promise<void> {
  await page.goto('/recuperar');
  await page.locator('input[name=correo]').fill(mail);
  await page.getByRole('button', { name: 'Enviar código' }).click();
  await expect(page.locator('input[name=codigo]')).toBeVisible();
}

async function fijarClaveNueva(page: Page, codigo: string, clave: string): Promise<void> {
  await page.locator('input[name=codigo]').fill(codigo);
  await page.getByRole('button', { name: 'Continuar' }).click();
  const guardar = page.getByRole('button', { name: 'Guardar contraseña' });
  await escribirClave(page.locator('input[name=clave]'), clave, page.locator('input[name=confirma]'));
  await escribirClave(page.locator('input[name=confirma]'), clave, guardar);
  await guardar.click();
  await expect(page.getByRole('link', { name: 'Clientes', exact: true })).toBeVisible();
}

test.describe('recuperar contraseña en el navegador', () => {
  test('pide el código desde otro dispositivo, fija la clave nueva y la vieja deja de servir', async ({ browser }) => {
    const mail = correo('recuperar');
    const a = await dispositivo(browser);
    const b = await dispositivo(browser);
    const c = await dispositivo(browser);
    try {
      await registrar(await a.newPage(), mail);

      const paginaB = await b.newPage();
      await pedirCodigo(paginaB, mail);
      await fijarClaveNueva(paginaB, await codigoEnviado(mail), CLAVE_NUEVA);

      const paginaC = await c.newPage();
      await paginaC.goto('/entrar');
      await paginaC.locator('input[name=correo]').fill(mail);
      const boton = paginaC.getByRole('button', { name: 'Entrar', exact: true });
      await escribirClave(paginaC.locator('input[name=clave]'), CLAVE, boton);
      await boton.click();
      await expect(paginaC.getByRole('alert')).toBeVisible();
      await expect(paginaC).toHaveURL(/\/entrar/);

      await entrar(paginaC, mail, CLAVE_NUEVA);
      await expect(paginaC.getByRole('link', { name: 'Clientes', exact: true })).toBeVisible();
    } finally {
      await Promise.all([a.close(), b.close(), c.close()]);
    }
  });

  test('un correo sin cuenta llega al paso del código y no se envía nada', async ({ browser }) => {
    const mail = correo('sin-cuenta');
    const ctx = await dispositivo(browser);
    try {
      const page = await ctx.newPage();
      await pedirCodigo(page, mail);
      await expect(page.getByText('Si ese correo tiene cuenta, te llegó un código.')).toBeVisible();
      expect(correosDe(mail)).toHaveLength(0);
    } finally {
      await ctx.close();
    }
  });

  test('un código equivocado muestra que no coincide o venció', async ({ browser }) => {
    const mail = correo('equivocado');
    const a = await dispositivo(browser);
    const b = await dispositivo(browser);
    try {
      await registrar(await a.newPage(), mail);
      const page = await b.newPage();
      await pedirCodigo(page, mail);
      const real = await codigoEnviado(mail);
      const malo = real === '000000' ? '111111' : '000000';
      await page.locator('input[name=codigo]').fill(malo);
      await page.getByRole('button', { name: 'Continuar' }).click();
      await expect(page.getByRole('alert')).toHaveText('Ese código no coincide o venció. Pide otro.');
      await expect(page.locator('input[name=codigo]')).toBeVisible();
    } finally {
      await Promise.all([a.close(), b.close()]);
    }
  });

  test('al recuperar la clave se cierra la sesión abierta en otro dispositivo', async ({ browser }) => {
    const mail = correo('sesion-cerrada');
    const a = await dispositivo(browser);
    const b = await dispositivo(browser);
    try {
      const paginaA = await a.newPage();
      await registrar(paginaA, mail);
      const antes = (await (await a.request.get('/api/sesion')).json()) as { sesion: unknown };
      expect(antes.sesion).not.toBeNull();

      const paginaB = await b.newPage();
      await pedirCodigo(paginaB, mail);
      await fijarClaveNueva(paginaB, await codigoEnviado(mail), CLAVE_NUEVA);

      await paginaA.reload();
      await expect(paginaA).toHaveURL(/\/entrar/);
      const despues = (await (await a.request.get('/api/sesion')).json()) as { sesion: unknown };
      expect(despues.sesion).toBeNull();
    } finally {
      await Promise.all([a.close(), b.close()]);
    }
  });
});
