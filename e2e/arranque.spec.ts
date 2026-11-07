import { randomUUID } from 'node:crypto';
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';

const BASE = 'http://127.0.0.1:4300';
const CLAVE = 'clave-larga-123';
// Interacciones (clics y escrituras) que cuesta hoy tener una rutina creada con un cliente nuevo pasando por /rutinas.
const LINEA_BASE_INTERACCIONES = 12;
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

type RutinaServidor = {
  id: string;
  clienteId: string | null;
  nombre: string;
  dias: { nombre: string; ejercicios: { nombre: string }[] }[];
};

async function rutinasEnServidor(ctx: BrowserContext): Promise<RutinaServidor[]> {
  const r = (await (await ctx.request.get('/api/estudio')).json()) as { estado: { rutinas: RutinaServidor[] } };
  return r.estado.rutinas;
}

// Crea el cliente desde /clientes; al guardar, la app abre su ficha.
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
  await expect(page).toHaveURL(/\/clientes\/[^/]+$/);
}

// Crea una rutina desde el formulario de /rutinas; con cliente vacío es una plantilla.
async function crearRutina(page: Page, ctx: BrowserContext, nombre: string, cliente = ''): Promise<void> {
  await page.goto('/rutinas');
  await page.locator('input[name=nombre]').fill(nombre);
  if (cliente) await page.locator('select[name=cliente]').selectOption({ label: cliente });
  await page.getByRole('button', { name: 'Crear rutina' }).click();
  await expect(page.locator('app-editor-rutina')).toBeVisible();
  await expect.poll(async () => (await rutinasEnServidor(ctx)).some((r) => r.nombre === nombre)).toBe(true);
}

// Abre la ficha del cliente en la pestaña Rutina.
async function abrirFichaRutina(page: Page, nombre: string): Promise<void> {
  await page.goto('/clientes');
  await page.getByRole('link', { name: new RegExp(nombre) }).click();
  await expect(page.getByRole('heading', { name: nombre })).toBeVisible();
  await page.getByRole('button', { name: 'Rutina', exact: true }).click();
  await expect(pestanaRutina(page)).toHaveClass(/activa/);
}

const pestanaRutina = (page: Page): Locator => page.locator('.pestanas').getByRole('button', { name: 'Rutina', exact: true });
const nuevaRutina = (page: Page): Locator => page.getByRole('button', { name: 'Nueva rutina', exact: true });
const idDeCliente = (page: Page): string => new URL(page.url()).pathname.split('/').pop() ?? '';

// Abre la hoja de ejercicios, elige el ejercicio por su nombre (o lo crea) y espera a que se cierre.
async function agregarEjercicio(editor: Locator, nombre: string): Promise<void> {
  await editor.getByRole('button', { name: 'Agregar ejercicio' }).click();
  const hoja = editor.locator('app-selector-ejercicio');
  await expect(hoja.getByRole('heading', { name: 'Elegir ejercicio' })).toBeVisible();
  await hoja.getByRole('searchbox', { name: 'Buscar ejercicio' }).fill(nombre);
  await hoja
    .getByRole('button', { name: nombre, exact: true })
    .or(hoja.getByRole('button', { name: `Crear «${nombre}»`, exact: true }))
    .click();
  await expect(hoja).toHaveCount(0);
}

// El campo "Nombre de la rutina" de la rutina con ese id.
const nombreDe = (page: Page, id: string): Locator => page.locator(`label[data-id="${id}"] input`);

test('Nueva rutina en la ficha crea la rutina con ese cliente sin cambiar de página ni salir de la pestaña Rutina', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('arr1'));
  await crearCliente(page, 'Cliente Recién Creado');
  const clienteId = idDeCliente(page);
  await page.getByRole('button', { name: 'Rutina', exact: true }).click();
  const urlAntes = page.url();

  await nuevaRutina(page).click();

  await expect(page.locator('app-editor-rutina')).toHaveCount(1);
  await expect
    .poll(async () => (await rutinasEnServidor(ctx)).map((r) => [r.clienteId, r.nombre]))
    .toEqual([[clienteId, 'Rutina nueva']]);
  expect(page.url()).toBe(urlAntes);
  await expect(page).toHaveURL(new RegExp(`/clientes/${clienteId}$`));
  await expect(pestanaRutina(page)).toHaveClass(/activa/);
  await expect(page.getByRole('heading', { name: 'Rutinas' })).toBeVisible();
  await ctx.close();
});

test('la rutina nueva queda a la vista con el foco en Nombre de la rutina aunque el cliente ya tenga otra larga', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('arr2'));
  await crearCliente(page, 'Cliente Con Rutina Larga');
  await crearRutina(page, ctx, 'Rutina previa', 'Cliente Con Rutina Larga');
  const previa = page.locator('app-editor-rutina');
  for (const ejercicio of ['Press banca', 'Remo con barra', 'Peso muerto', 'Dominadas', 'Sentadilla']) {
    await agregarEjercicio(previa, ejercicio);
  }
  await expect(previa.locator('.ejercicio')).toHaveCount(5);
  await expect.poll(async () => (await rutinasEnServidor(ctx))[0]?.dias[0]?.ejercicios.length).toBe(5);

  await abrirFichaRutina(page, 'Cliente Con Rutina Larga');
  await expect(page.locator('app-editor-rutina')).toHaveCount(1);
  await nuevaRutina(page).click();

  await expect(page.locator('app-editor-rutina')).toHaveCount(2);
  await expect.poll(async () => (await rutinasEnServidor(ctx)).map((r) => r.nombre)).toEqual(['Rutina previa', 'Rutina nueva']);
  const nueva = (await rutinasEnServidor(ctx)).find((r) => r.nombre === 'Rutina nueva');
  const campoNombre = nombreDe(page, nueva?.id ?? 'sin-id');
  await expect(campoNombre).toHaveValue('Rutina nueva');
  await expect(campoNombre).toBeFocused();
  await expect(campoNombre).toBeInViewport();
  await expect(pestanaRutina(page)).toHaveClass(/activa/);
  await ctx.close();
});

test('copiar una plantilla desde la ficha deja la copia a la vista, con el foco en su nombre y en la pestaña Rutina', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('arr3'));
  await crearRutina(page, ctx, 'Plantilla de fuerza');
  await crearCliente(page, 'Cliente De La Copia');
  const clienteId = idDeCliente(page);
  await page.getByRole('button', { name: 'Rutina', exact: true }).click();
  const urlAntes = page.url();

  await page.getByLabel('Copiar plantilla').selectOption({ label: 'Plantilla de fuerza' });

  await expect(page.locator('app-editor-rutina')).toHaveCount(1);
  await expect
    .poll(async () => (await rutinasEnServidor(ctx)).filter((r) => r.clienteId === clienteId).map((r) => r.nombre))
    .toEqual(['Plantilla de fuerza']);
  const copia = (await rutinasEnServidor(ctx)).find((r) => r.clienteId === clienteId);
  const campoNombre = nombreDe(page, copia?.id ?? 'sin-id');
  await expect(campoNombre).toHaveValue('Plantilla de fuerza');
  await expect(campoNombre).toBeFocused();
  await expect(campoNombre).toBeInViewport();
  expect(page.url()).toBe(urlAntes);
  await expect(pestanaRutina(page)).toHaveClass(/activa/);
  // La plantilla original sigue sin cliente.
  expect((await rutinasEnServidor(ctx)).filter((r) => r.clienteId === null).map((r) => r.nombre)).toEqual(['Plantilla de fuerza']);
  await ctx.close();
});

test('un cliente sin rutinas muestra el estado vacío con la acción y deja de mostrarlo al crear una', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('arr4'));
  await crearCliente(page, 'Cliente Sin Rutinas');
  await page.getByRole('button', { name: 'Rutina', exact: true }).click();

  const vacio = page.locator('.estado-vacio');
  await expect(vacio).toBeVisible();
  await expect(vacio).toContainText('Este cliente todavía no tiene rutina.');
  await expect(vacio.getByRole('button', { name: 'Nueva rutina', exact: true })).toBeVisible();
  await expect(nuevaRutina(page)).toHaveCount(1);
  const caja = await vacio.getByRole('button', { name: 'Nueva rutina', exact: true }).boundingBox();
  expect(caja?.height ?? 0, 'alto de la acción del estado vacío').toBeGreaterThanOrEqual(44);

  await vacio.getByRole('button', { name: 'Nueva rutina', exact: true }).click();

  await expect(page.locator('app-editor-rutina')).toHaveCount(1);
  await expect(vacio).toHaveCount(0);
  // Con rutinas, la acción pasa a la cabecera y sigue habiendo un solo botón.
  await expect(nuevaRutina(page)).toHaveCount(1);
  await expect(nuevaRutina(page)).toBeVisible();
  await ctx.close();
});

test('el título de una plantilla en rutinas no repite la palabra Plantilla', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('arr5'));
  await crearRutina(page, ctx, 'Base de fuerza');

  const cabecera = page.locator('article.tarjeta > button[aria-expanded]').filter({ hasText: 'Base de fuerza' });
  await expect(cabecera).toBeVisible();
  const texto = ((await cabecera.locator('small').textContent()) ?? '').replace(/\s+/g, ' ').trim();
  expect(texto).not.toMatch(/Plantilla\s*·\s*Plantilla/);
  expect(texto.match(/Plantilla/g) ?? [], `subtítulo: ${texto}`).toHaveLength(1);
  expect(texto).toMatch(/^Plantilla ·/);
  await ctx.close();
});

test('el botón del acordeón en rutinas anuncia aria-expanded y cambia al abrir otra rutina', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('arr6'));
  await crearRutina(page, ctx, 'Primera rutina');
  await crearRutina(page, ctx, 'Segunda rutina');

  const primera = page.locator('article.tarjeta > button').filter({ hasText: 'Primera rutina' });
  const segunda = page.locator('article.tarjeta > button').filter({ hasText: 'Segunda rutina' });
  // Tras crear la segunda, ésta queda abierta.
  await expect(segunda).toHaveAttribute('aria-expanded', 'true');
  await expect(primera).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('app-editor-rutina')).toHaveCount(1);

  await primera.click();
  await expect(primera).toHaveAttribute('aria-expanded', 'true');
  await expect(segunda).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('app-editor-rutina')).toHaveCount(1);

  await primera.click();
  await expect(primera).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('app-editor-rutina')).toHaveCount(0);
  await ctx.close();
});

test('desde un cliente nuevo hasta tener la rutina creada con él hacen falta menos interacciones que las 12 de pasar por rutinas', async ({ browser }, info) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('arr7'));

  let interacciones = 0;
  const clic = async (destino: Locator): Promise<void> => {
    interacciones += 1;
    await destino.click();
  };
  const escribir = async (destino: Locator, valor: string): Promise<void> => {
    interacciones += 1;
    await destino.fill(valor);
  };

  await clic(page.getByRole('link', { name: 'Clientes', exact: true }));
  await clic(page.getByRole('button', { name: 'Nuevo' }));
  await escribir(page.locator('input[name=nombre]'), 'Cliente Contado');
  await escribir(page.locator('input[name=telefono]'), `300${Date.now().toString().slice(-7)}`);
  await clic(page.getByRole('button', { name: 'Guardar cliente' }));
  await expect(page).toHaveURL(/\/clientes\/[^/]+$/);
  const clienteId = idDeCliente(page);
  await clic(page.getByRole('button', { name: 'Rutina', exact: true }));
  await clic(nuevaRutina(page));

  await expect(page.locator('app-editor-rutina')).toHaveCount(1);
  await expect
    .poll(async () => (await rutinasEnServidor(ctx)).map((r) => r.clienteId))
    .toEqual([clienteId]);

  console.log(`Interacciones por la ficha: ${interacciones} (línea base por rutinas: ${LINEA_BASE_INTERACCIONES})`);
  info.annotations.push({ type: 'interacciones', description: String(interacciones) });
  expect(interacciones).toBeLessThan(LINEA_BASE_INTERACCIONES);
  await ctx.close();
});
