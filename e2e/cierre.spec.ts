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
async function dispositivo(browser: Browser, viewport = { width: 390, height: 844 }): Promise<BrowserContext> {
  const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;
  const ctx = await browser.newContext({ baseURL: BASE, viewport });
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

async function entrar(page: Page, mail: string): Promise<void> {
  await page.goto('/entrar');
  await page.locator('input[name=correo]').fill(mail);
  const boton = page.getByRole('button', { name: 'Entrar', exact: true });
  await escribirClave(page.locator('input[name=clave]'), CLAVE, boton);
  await boton.click();
  await page.waitForURL((u) => !u.pathname.startsWith('/entrar'));
}

type EjercicioServidor = { id: string; nombre: string };
type RutinaServidor = {
  nombre: string;
  dias: { id: string; nombre: string; ejercicios: EjercicioServidor[] }[];
};

async function rutinasEnServidor(ctx: BrowserContext): Promise<RutinaServidor[]> {
  const r = (await (await ctx.request.get('/api/estudio')).json()) as { estado: { rutinas: RutinaServidor[] } };
  return r.estado.rutinas;
}

const ordenEnServidor = async (ctx: BrowserContext): Promise<string[][]> =>
  ((await rutinasEnServidor(ctx))[0]?.dias ?? []).map((d) => d.ejercicios.map((e) => e.nombre));

async function crearCliente(page: Page, nombre: string): Promise<void> {
  await page.goto('/clientes');
  await page.getByRole('button', { name: 'Nuevo' }).click();
  await page.locator('input[name=nombre]').fill(nombre);
  await page.locator('input[name=telefono]').fill(`300${Date.now().toString().slice(-7)}`);
  const guardado = page.waitForResponse(
    (r) => r.url().endsWith('/api/estudio') && r.request().method() === 'PUT' && r.status() === 200,
  );
  await page.getByRole('button', { name: 'Guardar cliente' }).click();
  await guardado;
}

async function darAcceso(page: Page, cliente: string, mailCliente: string): Promise<void> {
  await page.goto('/clientes');
  await page.getByRole('link', { name: new RegExp(cliente) }).click();
  await expect(page.getByRole('heading', { name: cliente })).toBeVisible();
  await page.locator('input[name=accesoCorreo]').fill(mailCliente);
  const crearAcceso = page.getByRole('button', { name: 'Crear acceso' });
  await escribirClave(page.locator('input[name=accesoClave]'), CLAVE, page.locator('input[name=accesoConfirma]'));
  await escribirClave(page.locator('input[name=accesoConfirma]'), CLAVE, crearAcceso);
  await crearAcceso.click();
  await expect(page.getByText('Listo. Con ese correo entra')).toBeVisible();
}

async function crearRutina(page: Page, ctx: BrowserContext, nombre: string, cliente = ''): Promise<Locator> {
  await page.goto('/rutinas');
  await page.locator('input[name=nombre]').fill(nombre);
  if (cliente) await page.locator('select[name=cliente]').selectOption({ label: cliente });
  await page.getByRole('button', { name: 'Crear rutina' }).click();
  const editor = page.locator('app-editor-rutina');
  await expect(editor).toBeVisible();
  await expect.poll(async () => (await rutinasEnServidor(ctx)).some((r) => r.nombre === nombre)).toBe(true);
  return editor;
}

// Abre la hoja de ejercicios, elige el ejercicio por su nombre (o lo crea si no existe) y espera a que se cierre.
async function agregarEjercicio(editor: Locator, nombre: string, dia: Locator): Promise<void> {
  await dia.getByRole('button', { name: 'Agregar ejercicio' }).click();
  const hoja = editor.locator('app-selector-ejercicio');
  await expect(hoja.getByRole('heading', { name: 'Elegir ejercicio' })).toBeVisible();
  await hoja.getByRole('searchbox', { name: 'Buscar ejercicio' }).fill(nombre);
  await hoja
    .getByRole('button', { name: nombre, exact: true })
    .or(hoja.getByRole('button', { name: `Crear «${nombre}»`, exact: true }))
    .click();
  await expect(hoja).toHaveCount(0);
}

async function ponerEjercicios(editor: Locator, nombres: string[], indiceDia = 0): Promise<void> {
  const dia = editor.locator('.dia-rutina').nth(indiceDia);
  for (let i = 0; i < nombres.length; i++) {
    await agregarEjercicio(editor, nombres[i], dia);
    await expect(dia.locator('.ejercicio')).toHaveCount(i + 1);
  }
}

async function nombrarDia(editor: Locator, indice: number, nombre: string): Promise<void> {
  const campo = editor.locator('.dia-rutina').nth(indice).getByLabel('Día', { exact: true });
  await campo.fill(nombre);
  await campo.blur();
}

// Solo hay una fila abierta a la vez: abre la del ejercicio y espera a que exista su cuerpo.
async function abrirEjercicio(ejercicio: Locator): Promise<Locator> {
  const cabecera = ejercicio.locator('button[aria-expanded]');
  if ((await cabecera.getAttribute('aria-expanded')) !== 'true') await cabecera.click();
  await expect(cabecera).toHaveAttribute('aria-expanded', 'true');
  await expect(ejercicio.getByLabel('Ejercicio', { exact: true })).toBeVisible();
  return ejercicio;
}

test('en el plan del cliente cada ejercicio conserva su relleno de 12 px y su separación de 8 px', async ({ browser }) => {
  const entrenadora = await dispositivo(browser);
  const dispCliente = await dispositivo(browser);
  const page = await entrenadora.newPage();
  const mailCliente = correo('cierre-cli');
  await registrar(page, correo('cierre1'));
  await crearCliente(page, 'Cliente Del Plan');
  const editor = await crearRutina(page, entrenadora, 'Rutina del plan', 'Cliente Del Plan');
  await ponerEjercicios(editor, ['Press banca', 'Remo con barra'], 0);
  await expect.poll(() => ordenEnServidor(entrenadora)).toEqual([['Press banca', 'Remo con barra']]);
  await darAcceso(page, 'Cliente Del Plan', mailCliente);

  const pc = await dispCliente.newPage();
  await entrar(pc, mailCliente);
  await expect(pc).toHaveURL(/\/mi-plan$/);
  const ejercicios = pc.locator('app-mi-plan .ejercicio');
  await expect(ejercicios).toHaveCount(2);

  // Valores de la regla original de .ejercicio (base 37fb9c2): rejilla, gap 8px y padding 12px.
  for (let i = 0; i < 2; i++) {
    const estilo = await ejercicios.nth(i).evaluate((el) => {
      const c = getComputedStyle(el);
      return {
        display: c.display,
        rowGap: c.rowGap,
        columnGap: c.columnGap,
        top: c.paddingTop,
        right: c.paddingRight,
        bottom: c.paddingBottom,
        left: c.paddingLeft,
      };
    });
    expect(estilo, `estilo del ejercicio ${i + 1} en el plan del cliente`).toEqual({
      display: 'grid',
      rowGap: '8px',
      columnGap: '8px',
      top: '12px',
      right: '12px',
      bottom: '12px',
      left: '12px',
    });
  }
  await entrenadora.close();
  await dispCliente.close();
});

test('elegir un día en «Mover al día…» sin pulsar Mover no borra la fila de quitado y Deshacer sigue funcionando', async ({
  browser,
}) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('cierre2'));
  const editor = await crearRutina(page, ctx, 'Rutina para quitar y elegir día');
  await nombrarDia(editor, 0, 'Lunes');
  await ponerEjercicios(editor, ['Press banca', 'Remo con barra'], 0);
  await editor.getByRole('button', { name: 'Agregar día' }).click();
  await expect(editor.locator('.dia-rutina')).toHaveCount(2);
  await nombrarDia(editor, 1, 'Martes');
  await expect.poll(() => ordenEnServidor(ctx)).toEqual([['Press banca', 'Remo con barra'], []]);

  const lunes = editor.locator('.dia-rutina').nth(0);
  const primero = await abrirEjercicio(lunes.locator('.ejercicio').nth(0));
  await primero.getByRole('button', { name: 'Quitar ejercicio' }).click();
  const fila = editor.locator('.fila-quitado');
  await expect(fila).toHaveText(/Quitado · Press banca/);
  await expect.poll(() => ordenEnServidor(ctx)).toEqual([['Remo con barra'], []]);

  // El ejercicio que queda se abre y, en él, se elige un día sin mover nada.
  const restante = await abrirEjercicio(lunes.locator('.ejercicio').nth(0));
  await restante.locator('select[data-orden=dia]').selectOption({ label: 'Martes' });
  await expect(restante.locator('select[data-orden=dia]')).toHaveValue(/.+/);
  await expect(fila).toHaveText(/Quitado · Press banca/);
  await expect(editor.getByRole('button', { name: 'Deshacer: Press banca' })).toBeVisible();

  await editor.getByRole('button', { name: 'Deshacer: Press banca' }).click();
  await expect(fila).toHaveCount(0);
  await expect(lunes.locator('.ejercicio')).toHaveCount(2);
  await expect.poll(() => ordenEnServidor(ctx)).toEqual([['Press banca', 'Remo con barra'], []]);
  await ctx.close();
});

test('el campo Ejercicio de la fila abierta limita el nombre a 80 caracteres', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('cierre3'));
  const editor = await crearRutina(page, ctx, 'Rutina de nombre largo');
  await ponerEjercicios(editor, ['Press banca'], 0);
  await expect.poll(() => ordenEnServidor(ctx)).toEqual([['Press banca']]);

  const ejercicio = await abrirEjercicio(editor.locator('.dia-rutina').first().locator('.ejercicio').first());
  const nombre = ejercicio.getByLabel('Ejercicio', { exact: true });
  await expect(nombre).toHaveAttribute('maxlength', '80');

  const largo = 'Z'.repeat(120);
  await nombre.fill(largo);
  await expect(nombre).toHaveValue('Z'.repeat(80));
  await expect.poll(async () => (await ordenEnServidor(ctx))[0]?.[0]).toBe('Z'.repeat(80));
  await ctx.close();
});
