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

async function abrirFichaRutina(page: Page, nombre: string): Promise<void> {
  await page.goto('/clientes');
  await page.getByRole('link', { name: new RegExp(nombre) }).click();
  await expect(page.getByRole('heading', { name: nombre })).toBeVisible();
  await page.getByRole('button', { name: 'Rutina', exact: true }).click();
  await expect(page.locator('app-editor-rutina')).toBeVisible();
}

// Crea la rutina desde el formulario de /rutinas; queda abierta en el acordeón.
async function crearRutina(page: Page, nombre: string, cliente = ''): Promise<void> {
  await page.goto('/rutinas');
  await page.locator('input[name=nombre]').fill(nombre);
  if (cliente) await page.locator('select[name=cliente]').selectOption({ label: cliente });
  await page.getByRole('button', { name: 'Crear rutina' }).click();
  await expect(page.locator('app-editor-rutina')).toBeVisible();
  await expect
    .poll(async () => (await rutinasEnServidor(page.context())).some((r) => r.nombre === nombre))
    .toBe(true);
}

async function abrirRutina(page: Page, nombre: string): Promise<Locator> {
  await page.goto('/rutinas');
  await page.getByRole('button', { name: new RegExp(nombre) }).click();
  const editor = page.locator('app-editor-rutina');
  await expect(editor).toBeVisible();
  return editor;
}

type RutinaServidor = {
  clienteId: string | null;
  nombre: string;
  precio: number;
  dias: {
    nombre: string;
    ejercicios: { nombre: string; series: string; reps: string; descanso: string; imagen?: boolean }[];
  }[];
};

// Lo que el servidor tiene de verdad: espera a que el guardado con retardo haya llegado.
async function rutinasEnServidor(ctx: BrowserContext): Promise<RutinaServidor[]> {
  const r = (await (await ctx.request.get('/api/estudio')).json()) as { estado: { rutinas: RutinaServidor[] } };
  return r.estado.rutinas;
}

// Abre la hoja de ejercicios, elige el ejercicio por su nombre (o lo crea si no existe) y espera a que se cierre.
async function agregarEjercicio(editor: Locator, nombre: string, dia: Locator = editor): Promise<void> {
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

async function campo(editor: Locator, etiqueta: string, valor: string): Promise<void> {
  const input = editor.getByLabel(etiqueta, { exact: true });
  await input.fill(valor);
  await input.blur();
}

test('en rutinas, nombre, precio, día y ejercicio editados persisten tras recargar', async ({ browser }) => {
  const a = await dispositivo(browser);
  const pa = await a.newPage();
  await registrar(pa, correo('ed1'));
  await crearCliente(pa, 'Cliente Editor');
  await crearRutina(pa, 'Fuerza', 'Cliente Editor');

  const editor = pa.locator('app-editor-rutina');
  await campo(editor, 'Nombre de la rutina', 'Fuerza tren inferior');
  await campo(editor, 'Precio', '45000');
  await campo(editor, 'Día', 'Lunes');
  await agregarEjercicio(editor, 'Sentadilla');
  await expect(editor.locator('.ejercicio')).toHaveCount(1);
  await editor.getByLabel('Ejercicio', { exact: true }).fill('Peso muerto');
  await campo(editor, 'Series', '4');
  await campo(editor, 'Reps', '8-10');
  await campo(editor, 'Descanso', '90s');

  await expect
    .poll(async () => {
      const [rutina] = await rutinasEnServidor(a);
      const ejercicio = rutina?.dias[0]?.ejercicios[0];
      return [rutina?.nombre, rutina?.precio, rutina?.dias[0]?.nombre, ejercicio?.nombre, ejercicio?.series, ejercicio?.reps, ejercicio?.descanso];
    })
    .toEqual(['Fuerza tren inferior', 45000, 'Lunes', 'Peso muerto', '4', '8-10', '90s']);

  const abierto = await abrirRutina(pa, 'Fuerza tren inferior');
  await expect(abierto.getByLabel('Nombre de la rutina')).toHaveValue('Fuerza tren inferior');
  await expect(abierto.getByLabel('Precio', { exact: true })).toHaveValue('45000');
  await expect(abierto.getByLabel('Día', { exact: true })).toHaveValue('Lunes');
  await expect(abierto.getByLabel('Ejercicio', { exact: true })).toHaveValue('Peso muerto');
  await expect(abierto.getByLabel('Series', { exact: true })).toHaveValue('4');
  await expect(abierto.getByLabel('Reps', { exact: true })).toHaveValue('8-10');
  await expect(abierto.getByLabel('Descanso', { exact: true })).toHaveValue('90s');
  await a.close();
});

test('en la ficha del cliente, un ejercicio agregado y quitado queda igual que en rutinas', async ({ browser }) => {
  const a = await dispositivo(browser);
  const pa = await a.newPage();
  await registrar(pa, correo('ed2'));
  await crearCliente(pa, 'Cliente Ficha');
  await crearRutina(pa, 'Rutina de ficha', 'Cliente Ficha');

  await abrirFichaRutina(pa, 'Cliente Ficha');
  const editor = pa.locator('app-editor-rutina');
  await expect(editor.locator('.ejercicio')).toHaveCount(0);
  await agregarEjercicio(editor, 'Sentadilla');
  await expect(editor.locator('.ejercicio')).toHaveCount(1);
  await expect
    .poll(async () => (await rutinasEnServidor(a))[0]?.dias[0]?.ejercicios.length)
    .toBe(1);

  const desdeRutinas = await abrirRutina(pa, 'Rutina de ficha');
  await expect(desdeRutinas.locator('.ejercicio')).toHaveCount(1);
  await expect(desdeRutinas.getByLabel('Ejercicio', { exact: true })).toHaveValue('Sentadilla');

  await abrirFichaRutina(pa, 'Cliente Ficha');
  await pa.locator('app-editor-rutina').getByRole('button', { name: 'Quitar ejercicio' }).click();
  await expect(pa.locator('app-editor-rutina .ejercicio')).toHaveCount(0);
  await expect
    .poll(async () => (await rutinasEnServidor(a))[0]?.dias[0]?.ejercicios.length)
    .toBe(0);

  const trasQuitar = await abrirRutina(pa, 'Rutina de ficha');
  await expect(trasQuitar.locator('.ejercicio')).toHaveCount(0);
  await a.close();
});

test('agregar y quitar un día actualiza la lista y se guarda', async ({ browser }) => {
  const a = await dispositivo(browser);
  const pa = await a.newPage();
  await registrar(pa, correo('ed3'));
  await crearRutina(pa, 'Rutina de días');

  const editor = pa.locator('app-editor-rutina');
  await expect(editor.locator('.dia-rutina')).toHaveCount(1);
  await editor.getByRole('button', { name: 'Agregar día' }).click();
  await expect(editor.locator('.dia-rutina')).toHaveCount(2);
  await expect(editor.locator('.dia-rutina').nth(1).getByLabel('Día', { exact: true })).toHaveValue('Día nuevo');
  await expect.poll(async () => (await rutinasEnServidor(a))[0]?.dias.length).toBe(2);

  const recargado = await abrirRutina(pa, 'Rutina de días');
  await expect(recargado.locator('.dia-rutina')).toHaveCount(2);

  await recargado.locator('.dia-rutina').nth(1).getByRole('button', { name: 'Quitar día' }).click();
  await expect(recargado.locator('.dia-rutina')).toHaveCount(1);
  await expect(recargado.getByLabel('Día', { exact: true })).toHaveValue('Día 1');
  await expect.poll(async () => (await rutinasEnServidor(a))[0]?.dias.length).toBe(1);

  const trasQuitar = await abrirRutina(pa, 'Rutina de días');
  await expect(trasQuitar.locator('.dia-rutina')).toHaveCount(1);
  await a.close();
});

test('Sentadilla muestra su foto y un nombre desconocido no', async ({ browser }) => {
  const a = await dispositivo(browser);
  const pa = await a.newPage();
  await registrar(pa, correo('ed4'));
  await crearRutina(pa, 'Rutina con fotos');

  const editor = pa.locator('app-editor-rutina');
  await agregarEjercicio(editor, 'Sentadilla');
  const foto = editor.locator('img.foto-ejercicio');
  await expect(editor.getByLabel('Ejercicio', { exact: true })).toHaveValue('Sentadilla');
  await expect(foto).toHaveCount(1);
  await expect(foto).toHaveAttribute('alt', 'Sentadilla');
  await expect.poll(() => foto.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

  await editor.getByRole('button', { name: 'Quitar imagen' }).click();
  await expect(foto).toHaveCount(0);
  await expect(editor.getByRole('button', { name: 'Poner imagen' })).toBeVisible();
  await editor.getByRole('button', { name: 'Poner imagen' }).click();
  await expect(foto).toHaveCount(1);

  await editor.getByLabel('Ejercicio', { exact: true }).fill('Ejercicio inventado');
  await expect(foto).toHaveCount(0);
  await expect(editor.getByRole('button', { name: 'Quitar imagen' })).toHaveCount(0);
  await expect(editor.getByRole('button', { name: 'Poner imagen' })).toHaveCount(0);
  await a.close();
});

test('la rutina de un cliente ofrece guardar como plantilla y enlace a la ficha; la plantilla no', async ({ browser }) => {
  const a = await dispositivo(browser);
  const pa = await a.newPage();
  await registrar(pa, correo('ed5'));
  await crearCliente(pa, 'Cliente Plantilla');
  await crearRutina(pa, 'Rutina del cliente', 'Cliente Plantilla');

  const conCliente = pa.locator('app-editor-rutina');
  await expect(conCliente.getByRole('button', { name: 'Guardar como plantilla' })).toBeVisible();
  await expect(conCliente.getByRole('link', { name: 'Ver ficha del cliente' })).toBeVisible();

  await abrirFichaRutina(pa, 'Cliente Plantilla');
  const enFicha = pa.locator('app-editor-rutina');
  await expect(enFicha.getByRole('button', { name: 'Guardar como plantilla' })).toBeVisible();
  await expect(enFicha.getByRole('link', { name: 'Ver ficha del cliente' })).toHaveCount(0);

  await crearRutina(pa, 'Solo plantilla');
  const plantilla = pa.locator('app-editor-rutina');
  await expect(plantilla.getByRole('button', { name: 'Guardar como plantilla' })).toHaveCount(0);
  await expect(plantilla.getByRole('link', { name: 'Ver ficha del cliente' })).toHaveCount(0);
  await a.close();
});
