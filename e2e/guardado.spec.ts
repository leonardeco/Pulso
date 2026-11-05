import { randomUUID } from 'node:crypto';
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';

const BASE = 'http://127.0.0.1:4300';
const CLAVE = 'clave-larga-123';
let contador = 0;

function correo(prefijo: string): string {
  contador += 1;
  return `${prefijo}-${Date.now()}-${contador}-${randomUUID().slice(0, 6)}@e2e.test`;
}

// Cada contexto es un dispositivo; la IP propia evita compartir el límite de registros.
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

async function registrar(page: Page, mail: string): Promise<void> {
  await page.goto('/registro');
  await page.locator('input[name=nombre]').fill('Entrenadora Prueba');
  await page.locator('input[name=correo]').fill(mail);
  const crear = page.getByRole('button', { name: 'Crear cuenta' });
  await escribirClave(page.locator('input[name=clave]'), CLAVE, page.locator('input[name=confirma]'));
  await escribirClave(page.locator('input[name=confirma]'), CLAVE, crear);
  await crear.click();
  await expect(page.getByRole('link', { name: 'Clientes', exact: true })).toBeVisible();
}

async function nombresDeRutinas(ctx: BrowserContext): Promise<string[]> {
  const r = (await (await ctx.request.get('/api/estudio')).json()) as { estado: { rutinas: { nombre: string }[] } };
  return r.estado.rutinas.map((x) => x.nombre);
}

// Deja una rutina creada, abierta y ya guardada en el servidor, lista para editarla.
async function prepararRutina(browser: Browser, prefijo: string): Promise<{ ctx: BrowserContext; page: Page; editor: Locator; indicador: Locator }> {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo(prefijo));
  await page.goto('/rutinas');
  await page.locator('input[name=nombre]').fill('Rutina base');
  await page.getByRole('button', { name: 'Crear rutina' }).click();
  const editor = page.locator('app-editor-rutina');
  await expect(editor).toBeVisible();
  await expect.poll(async () => (await nombresDeRutinas(ctx)).includes('Rutina base')).toBe(true);
  const indicador = page.locator('p.indicador-guardado');
  await expect(indicador).toHaveText(/^\s*Guardado\s*$/);
  return { ctx, page, editor, indicador };
}

async function cambiarNombre(editor: Locator, nombre: string): Promise<void> {
  const input = editor.getByLabel('Nombre de la rutina', { exact: true });
  await input.fill(nombre);
  await input.blur();
}

// Retiene el guardado hasta que la prueba lo libere; avisa cuando el servidor lo recibiría.
async function retenerGuardado(page: Page): Promise<{ llego: Promise<void>; liberar: () => void }> {
  let avisar!: () => void;
  let soltar!: () => void;
  const llego = new Promise<void>((ok) => (avisar = ok));
  const puerta = new Promise<void>((ok) => (soltar = ok));
  await page.route('**/api/estudio', async (ruta) => {
    if (ruta.request().method() !== 'PUT') return ruta.fallback();
    avisar();
    await puerta;
    return ruta.fallback();
  });
  return { llego, liberar: soltar };
}

const GUARDADO = /^\s*Guardado\s*$/;

test('mientras el servidor no responde el indicador no dice Guardado y al responder sí', async ({ browser }) => {
  const { ctx, page, editor, indicador } = await prepararRutina(browser, 'gu1');
  const retenido = await retenerGuardado(page);

  await cambiarNombre(editor, 'Rutina editada');
  await retenido.llego;
  await expect(indicador).not.toHaveText(GUARDADO);
  await expect(indicador).toContainText(/Cambios sin guardar|Guardando…/);
  expect(await nombresDeRutinas(ctx)).not.toContain('Rutina editada');

  retenido.liberar();
  await expect(indicador).toHaveText(GUARDADO);
  await expect.poll(async () => nombresDeRutinas(ctx)).toContain('Rutina editada');
  await ctx.close();
});

test('con el servidor ya respondido el indicador muestra icono y texto de Guardado', async ({ browser }) => {
  const { ctx, editor, indicador } = await prepararRutina(browser, 'gu2');

  await cambiarNombre(editor, 'Rutina confirmada');
  await expect.poll(async () => nombresDeRutinas(ctx)).toContain('Rutina confirmada');
  await expect(indicador).toHaveText(GUARDADO);
  await expect(indicador.locator('svg')).toBeVisible();
  await expect(indicador).toHaveAttribute('role', 'status');
  await ctx.close();
});

test('con el guardado retenido más de un segundo el indicador dice Guardando…', async ({ browser }) => {
  const { ctx, page, editor, indicador } = await prepararRutina(browser, 'gu3');
  const retenido = await retenerGuardado(page);

  await cambiarNombre(editor, 'Rutina lenta');
  await retenido.llego;
  await expect(indicador).toContainText('Guardando…');
  await expect(indicador.locator('svg')).toBeVisible();

  retenido.liberar();
  await expect(indicador).toHaveText(GUARDADO);
  await ctx.close();
});

test('con el servidor respondiendo error 500 el indicador no dice Guardado y sale el aviso de conexión', async ({ browser }) => {
  const { ctx, page, editor, indicador } = await prepararRutina(browser, 'gu4');
  await page.route('**/api/estudio', (ruta) =>
    ruta.request().method() === 'PUT'
      ? ruta.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Falla del servidor' }) })
      : ruta.fallback(),
  );

  await cambiarNombre(editor, 'Rutina con falla');
  await expect(page.locator('p.estado-sync.alerta', { hasText: 'Sin conexión' })).toBeVisible();
  await expect(indicador).not.toHaveText(GUARDADO);
  await expect(indicador).toContainText('Cambios sin guardar');
  expect(await nombresDeRutinas(ctx)).not.toContain('Rutina con falla');
  await ctx.close();
});

test('con un corte de red al guardar el indicador no dice Guardado y sale el aviso de conexión', async ({ browser }) => {
  const { ctx, page, editor, indicador } = await prepararRutina(browser, 'gu5');
  await page.route('**/api/estudio', (ruta) =>
    ruta.request().method() === 'PUT' ? ruta.abort('connectionfailed') : ruta.fallback(),
  );

  await cambiarNombre(editor, 'Rutina sin red');
  await expect(page.locator('p.estado-sync.alerta', { hasText: 'Sin conexión' })).toBeVisible();
  await expect(indicador).not.toHaveText(GUARDADO);
  await expect(indicador).toContainText('Cambios sin guardar');
  await ctx.close();
});

test('con un conflicto de versión el indicador no dice Guardado y sale el aviso de conflicto', async ({ browser }) => {
  const { ctx, page, editor, indicador } = await prepararRutina(browser, 'gu6');
  const servidor = (await (await ctx.request.get('/api/estudio')).json()) as {
    estado: { rutinas: { nombre: string }[] };
    version: number;
  };
  const copia = {
    ...servidor,
    version: servidor.version + 1,
    estado: {
      ...servidor.estado,
      rutinas: servidor.estado.rutinas.map((r) => ({ ...r, nombre: 'Rutina del otro dispositivo' })),
    },
  };
  await page.route('**/api/estudio', (ruta) =>
    ruta.request().method() === 'PUT'
      ? ruta.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify(copia) })
      : ruta.fallback(),
  );

  await cambiarNombre(editor, 'Rutina con conflicto');
  await expect(page.locator('p.estado-sync.alerta', { hasText: 'Este estudio cambió en otro dispositivo' })).toBeVisible();
  await expect(indicador).not.toHaveText(GUARDADO);
  await expect(indicador).toContainText('Cambios sin guardar');
  expect(await nombresDeRutinas(ctx)).not.toContain('Rutina con conflicto');
  await ctx.close();
});

test('con la carga de datos fallando tras recargar el indicador no dice Guardado y sale el aviso de carga', async ({ browser }) => {
  const { ctx, page, indicador } = await prepararRutina(browser, 'gu7');
  await page.route(/\/api\/estudio(\?.*)?$/, (ruta) =>
    ruta.request().method() === 'GET'
      ? ruta.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Falla del servidor' }) })
      : ruta.fallback(),
  );

  await page.reload();
  await expect(page.getByText('No pude traer tus datos')).toBeVisible();
  await expect(indicador).not.toHaveText(GUARDADO);
  await expect(indicador).toContainText('Cambios sin guardar');
  await ctx.close();
});
