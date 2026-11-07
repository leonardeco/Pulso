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

type RutinaServidor = {
  clienteId: string | null;
  nombre: string;
  dias: {
    nombre: string;
    ejercicios: { nombre: string; series: string; reps: string; descanso: string }[];
  }[];
};

// Lo que el servidor tiene de verdad: espera a que el guardado con retardo haya llegado.
async function rutinasEnServidor(ctx: BrowserContext): Promise<RutinaServidor[]> {
  const r = (await (await ctx.request.get('/api/estudio')).json()) as { estado: { rutinas: RutinaServidor[] } };
  return r.estado.rutinas;
}

// Crea la rutina desde /rutinas; queda abierta en el acordeón.
async function crearRutina(page: Page, nombre: string, cliente = ''): Promise<Locator> {
  await page.goto('/rutinas');
  await page.locator('input[name=nombre]').fill(nombre);
  if (cliente) await page.locator('select[name=cliente]').selectOption({ label: cliente });
  await page.getByRole('button', { name: 'Crear rutina' }).click();
  const editor = page.locator('app-editor-rutina');
  await expect(editor).toBeVisible();
  await expect
    .poll(async () => (await rutinasEnServidor(page.context())).some((r) => r.nombre === nombre))
    .toBe(true);
  return editor;
}

function hojaDe(editor: Locator): Locator {
  return editor.locator('app-selector-ejercicio');
}

async function abrirHoja(editor: Locator, dia: Locator = editor): Promise<Locator> {
  await dia.getByRole('button', { name: 'Agregar ejercicio' }).click();
  const hoja = hojaDe(editor);
  await expect(hoja.getByRole('heading', { name: 'Elegir ejercicio' })).toBeVisible();
  return hoja;
}

function buscador(hoja: Locator): Locator {
  return hoja.getByRole('searchbox', { name: 'Buscar ejercicio' });
}

// Abre la hoja, elige el ejercicio por su nombre (o lo crea si no existe) y espera a que se cierre.
async function agregarEjercicio(editor: Locator, nombre: string, dia: Locator = editor): Promise<void> {
  const hoja = await abrirHoja(editor, dia);
  await buscador(hoja).fill(nombre);
  await hoja
    .getByRole('button', { name: nombre, exact: true })
    .or(hoja.getByRole('button', { name: `Crear «${nombre}»`, exact: true }))
    .click();
  await expect(hoja).toHaveCount(0);
}

async function ejerciciosDelDia(ctx: BrowserContext, dia = 0): Promise<string[]> {
  const rutinas = await rutinasEnServidor(ctx);
  return rutinas[0]?.dias[dia]?.ejercicios.map((e) => e.nombre) ?? [];
}

test('buscar «bulgara» sin tilde muestra «Sentadilla búlgara» con su nombre original', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('se1'));
  const editor = await crearRutina(page, 'Rutina de búsqueda');

  const hoja = await abrirHoja(editor);
  await buscador(hoja).fill('bulgara');
  await expect(hoja.getByRole('button', { name: 'Sentadilla búlgara', exact: true })).toBeVisible();
  await expect(hoja.locator('[role=status]')).toHaveText(/resultado/);
  await ctx.close();
});

test('un ejercicio creado con ñ se encuentra después buscando sin la ñ', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('se2'));
  const editor = await crearRutina(page, 'Rutina con ñ');

  await agregarEjercicio(editor, 'Curl de muñeca');
  await expect.poll(() => ejerciciosDelDia(ctx)).toEqual(['Curl de muñeca']);

  const hoja = await abrirHoja(editor);
  await buscador(hoja).fill('muneca');
  await expect(hoja.getByRole('button', { name: 'Curl de muñeca', exact: true })).toBeVisible();
  await ctx.close();
});

test('el alias «deadlift» muestra «Peso muerto»', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('se3'));
  const editor = await crearRutina(page, 'Rutina de alias');

  const hoja = await abrirHoja(editor);
  await buscador(hoja).fill('deadlift');
  await expect(hoja.getByRole('button', { name: 'Peso muerto', exact: true })).toBeVisible();
  await ctx.close();
});

test('Crear «X» inserta ese nombre y el ejercicio aparece como reciente en la segunda apertura', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('se4'));
  const editor = await crearRutina(page, 'Rutina de creación');
  const nombre = 'Zancada con salto invertida';

  const hoja = await abrirHoja(editor);
  await buscador(hoja).fill(nombre);
  await expect(hoja.getByRole('button', { name: `Crear «${nombre}»`, exact: true })).toBeVisible();
  await expect(hoja.locator('[role=status]')).toHaveText(`Sin coincidencias. Puedes crear «${nombre}»`);
  await hoja.getByRole('button', { name: `Crear «${nombre}»`, exact: true }).click();
  await expect(hoja).toHaveCount(0);

  await expect(editor.locator('.ejercicio')).toHaveCount(1);
  await expect(editor.getByLabel('Ejercicio', { exact: true })).toHaveValue(nombre);
  await expect(editor.locator('div.sr-only[role=status]').first()).toHaveText(`${nombre} agregado`);
  await expect.poll(() => ejerciciosDelDia(ctx)).toEqual([nombre]);

  const segunda = await abrirHoja(editor);
  const fila = segunda.locator('li').filter({ has: page.getByRole('button', { name: nombre, exact: true }) });
  await expect(fila).toHaveCount(1);
  await expect(fila.getByText('Reciente')).toBeVisible();
  await ctx.close();
});

test('un ejercicio nuevo hereda series, reps y descanso del anterior y un día vacío usa 3, 10 y 60s', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('se5'));
  const editor = await crearRutina(page, 'Rutina de herencia');

  const estructura = async () => {
    const rutinas = await rutinasEnServidor(ctx);
    return rutinas[0]?.dias[0]?.ejercicios.map((e) => [e.nombre, e.series, e.reps, e.descanso]);
  };

  await agregarEjercicio(editor, 'Press banca');
  await expect.poll(estructura).toEqual([['Press banca', '3', '10', '60s']]);

  const primero = editor.locator('.ejercicio').first();
  for (const [etiqueta, valor] of [['Series', '5'], ['Reps', '6-8'], ['Descanso', '120s']]) {
    const input = primero.getByLabel(etiqueta, { exact: true });
    await input.fill(valor);
    await input.blur();
  }
  await expect
    .poll(estructura)
    .toEqual([['Press banca', '5', '6-8', '120s']]);

  await agregarEjercicio(editor, 'Remo con barra');
  await expect(editor.locator('.ejercicio')).toHaveCount(2);
  await expect
    .poll(estructura)
    .toEqual([
      ['Press banca', '5', '6-8', '120s'],
      ['Remo con barra', '5', '6-8', '120s'],
    ]);
  await ctx.close();
});

test('Esc cierra la hoja y el foco vuelve al botón «Agregar ejercicio»', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('se6'));
  const editor = await crearRutina(page, 'Rutina de Esc');

  const boton = editor.getByRole('button', { name: 'Agregar ejercicio' });
  const hoja = await abrirHoja(editor);
  await expect(buscador(hoja)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(hoja).toHaveCount(0);
  await expect(boton).toBeFocused();
  await expect(editor.locator('.ejercicio')).toHaveCount(0);
  await ctx.close();
});

test('Enter en el buscador elige el primer resultado y, sin coincidencias, crea el texto escrito', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('se7'));
  const editor = await crearRutina(page, 'Rutina de Enter');

  const hoja = await abrirHoja(editor);
  await buscador(hoja).fill('bulgara');
  const primero = await hoja.locator('.selector-opcion').first().innerText();
  expect(primero.trim()).toBe('Sentadilla búlgara');
  await page.keyboard.press('Enter');
  await expect(hoja).toHaveCount(0);
  await expect(editor.locator('.ejercicio')).toHaveCount(1);
  await expect(editor.getByLabel('Ejercicio', { exact: true })).toHaveValue('Sentadilla búlgara');

  const otra = await abrirHoja(editor);
  await buscador(otra).fill('Remo olímpico imaginario');
  await page.keyboard.press('Enter');
  await expect(otra).toHaveCount(0);
  await expect.poll(() => ejerciciosDelDia(ctx)).toEqual(['Sentadilla búlgara', 'Remo olímpico imaginario']);
  await ctx.close();
});

test('con dos días, el botón «Agregar ejercicio» de cada uno agrega a su propio día', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('se8'));
  const editor = await crearRutina(page, 'Rutina de dos días');
  await editor.getByRole('button', { name: 'Agregar día' }).click();
  await expect(editor.locator('.dia-rutina')).toHaveCount(2);
  await expect.poll(async () => (await rutinasEnServidor(ctx))[0]?.dias.length).toBe(2);

  await agregarEjercicio(editor, 'Remo con barra', editor.locator('.dia-rutina').nth(1));
  await agregarEjercicio(editor, 'Press banca', editor.locator('.dia-rutina').nth(0));
  await expect.poll(() => ejerciciosDelDia(ctx, 0)).toEqual(['Press banca']);
  await expect.poll(() => ejerciciosDelDia(ctx, 1)).toEqual(['Remo con barra']);
  await expect(editor.locator('.dia-rutina').nth(0).locator('.ejercicio')).toHaveCount(1);
  await expect(editor.locator('.dia-rutina').nth(1).locator('.ejercicio')).toHaveCount(1);
  await ctx.close();
});

test('con dos rutinas abiertas, cada botón «Agregar ejercicio» agrega a su rutina', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('se9'));
  await crearCliente(page, 'Cliente Dos Rutinas');
  await crearRutina(page, 'Primera rutina', 'Cliente Dos Rutinas');
  await crearRutina(page, 'Segunda rutina', 'Cliente Dos Rutinas');

  await page.goto('/clientes');
  await page.getByRole('link', { name: /Cliente Dos Rutinas/ }).click();
  await page.getByRole('button', { name: 'Rutina', exact: true }).click();
  const editores = page.locator('app-editor-rutina');
  await expect(editores).toHaveCount(2);

  const nombresRutinas = async () => {
    const rutinas = await rutinasEnServidor(ctx);
    return Object.fromEntries(rutinas.map((r) => [r.nombre, r.dias[0]?.ejercicios.map((e) => e.nombre)]));
  };

  await agregarEjercicio(editores.nth(1), 'Press banca');
  await agregarEjercicio(editores.nth(0), 'Remo con barra');
  await expect(editores.nth(0).locator('.ejercicio')).toHaveCount(1);
  await expect(editores.nth(1).locator('.ejercicio')).toHaveCount(1);
  await expect
    .poll(nombresRutinas)
    .toEqual({ 'Primera rutina': ['Remo con barra'], 'Segunda rutina': ['Press banca'] });
  await ctx.close();
});

test('escribir en el buscador no retira la fila «Quitado · Deshacer» pendiente', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('se10'));
  const editor = await crearRutina(page, 'Rutina de deshacer');
  await agregarEjercicio(editor, 'Press banca');
  await agregarEjercicio(editor, 'Remo con barra');
  await expect(editor.locator('.ejercicio')).toHaveCount(2);

  await editor.locator('.ejercicio').first().getByRole('button', { name: 'Quitar ejercicio' }).click();
  const fila = editor.locator('.fila-quitado');
  await expect(fila).toHaveText(/Quitado · Press banca/);

  const hoja = await abrirHoja(editor);
  await buscador(hoja).pressSequentially('sent');
  await expect(buscador(hoja)).toHaveValue('sent');
  await expect(fila).toHaveCount(1);
  await expect(fila).toHaveText(/Quitado · Press banca/);

  await page.keyboard.press('Escape');
  await expect(hoja).toHaveCount(0);
  await expect(fila).toHaveCount(1);
  await editor.getByRole('button', { name: 'Deshacer: Press banca' }).click();
  await expect(editor.locator('.ejercicio')).toHaveCount(2);
  await expect.poll(() => ejerciciosDelDia(ctx)).toEqual(['Press banca', 'Remo con barra']);
  await ctx.close();
});

async function ponerValores(ejercicio: Locator, series: string, reps: string, descanso: string): Promise<void> {
  for (const [etiqueta, valor] of [['Series', series], ['Reps', reps], ['Descanso', descanso]]) {
    const input = ejercicio.getByLabel(etiqueta, { exact: true });
    await input.fill(valor);
    await input.blur();
  }
}

async function estructuraDelDia(ctx: BrowserContext, dia = 0): Promise<string[][]> {
  const rutinas = await rutinasEnServidor(ctx);
  return rutinas[0]?.dias[dia]?.ejercicios.map((e) => [e.nombre, e.series, e.reps, e.descanso]) ?? [];
}

test('tras elegir un ejercicio el foco queda en el primer campo del ejercicio nuevo', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('se11'));
  const editor = await crearRutina(page, 'Rutina de foco');

  await agregarEjercicio(editor, 'Press banca');
  await expect(editor.locator('.ejercicio')).toHaveCount(1);
  await expect(editor.getByLabel('Ejercicio', { exact: true })).toBeFocused();
  await ctx.close();
});

test('en escritorio un clic en el fondo cierra la hoja y el foco vuelve a «Agregar ejercicio»', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('se12'));
  const editor = await crearRutina(page, 'Rutina de fondo');
  await page.setViewportSize({ width: 1280, height: 800 });

  const boton = editor.getByRole('button', { name: 'Agregar ejercicio' });
  const hoja = await abrirHoja(editor);
  await page.mouse.click(5, 5);
  await expect(hoja).toHaveCount(0);
  await expect(boton).toBeFocused();
  await expect(editor.locator('.ejercicio')).toHaveCount(0);
  await ctx.close();
});

test('arrastrar una selección de texto desde el buscador hasta soltar sobre el fondo no cierra la hoja', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('se13'));
  const editor = await crearRutina(page, 'Rutina de arrastre');
  await page.setViewportSize({ width: 1280, height: 800 });

  const hoja = await abrirHoja(editor);
  await buscador(hoja).fill('press banca');
  const caja = await buscador(hoja).boundingBox();
  if (!caja) throw new Error('El buscador no tiene caja visible');
  await page.mouse.move(caja.x + 200, caja.y + caja.height / 2);
  await page.mouse.down();
  await page.mouse.move(5, 5, { steps: 8 });
  await page.mouse.up();

  const seleccionados = await buscador(hoja).evaluate((el: HTMLInputElement) => (el.selectionEnd ?? 0) - (el.selectionStart ?? 0));
  expect(seleccionados).toBeGreaterThan(0);
  await expect(hoja.getByRole('heading', { name: 'Elegir ejercicio' })).toBeVisible();
  await expect(buscador(hoja)).toHaveValue('press banca');
  await expect(editor.locator('.ejercicio')).toHaveCount(0);
  await ctx.close();
});

test('un nombre creado con una falta y corregido después muestra la foto del ejercicio', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('se14'));
  const editor = await crearRutina(page, 'Rutina de corrección');

  await agregarEjercicio(editor, 'Sentadila');
  const campo = editor.getByLabel('Ejercicio', { exact: true });
  await expect(campo).toHaveValue('Sentadila');
  await expect(editor.locator('img.foto-ejercicio')).toHaveCount(0);

  await campo.fill('Sentadilla');
  const foto = editor.locator('img.foto-ejercicio');
  await expect(foto).toBeVisible();
  await expect(foto).toHaveAttribute('alt', 'Sentadilla');
  await expect.poll(() => foto.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await ctx.close();
});

test('Enter con la búsqueda vacía no inserta nada y la hoja sigue abierta', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('se15'));
  const editor = await crearRutina(page, 'Rutina de Enter vacío');

  const hoja = await abrirHoja(editor);
  await expect(buscador(hoja)).toHaveValue('');
  await page.keyboard.press('Enter');
  await buscador(hoja).fill('   ');
  await page.keyboard.press('Enter');

  await expect(hoja.getByRole('heading', { name: 'Elegir ejercicio' })).toBeVisible();
  await expect(buscador(hoja)).toBeFocused();
  await expect(editor.locator('.ejercicio')).toHaveCount(0);
  await expect.poll(() => ejerciciosDelDia(ctx)).toEqual([]);
  await ctx.close();
});

test('Enter prefiere la coincidencia exacta sobre un reciente que solo empieza por el texto', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('se16'));
  const editor = await crearRutina(page, 'Rutina de coincidencia exacta');

  await agregarEjercicio(editor, 'Sentadilla goblet');
  await expect.poll(() => ejerciciosDelDia(ctx)).toEqual(['Sentadilla goblet']);

  const hoja = await abrirHoja(editor);
  await buscador(hoja).fill('sentadilla');
  await expect(hoja.locator('.selector-opcion').first()).toHaveText('Sentadilla');
  await page.keyboard.press('Enter');
  await expect(hoja).toHaveCount(0);
  await expect.poll(() => ejerciciosDelDia(ctx)).toEqual(['Sentadilla goblet', 'Sentadilla']);
  await ctx.close();
});

test('con dos ejercicios en el día, el nuevo hereda los valores del último y no los del primero', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('se17'));
  const editor = await crearRutina(page, 'Rutina de último');

  await agregarEjercicio(editor, 'Press banca');
  await ponerValores(editor.locator('.ejercicio').nth(0), '5', '6-8', '120s');
  await agregarEjercicio(editor, 'Remo con barra');
  await ponerValores(editor.locator('.ejercicio').nth(1), '4', '12', '90s');
  await expect
    .poll(() => estructuraDelDia(ctx))
    .toEqual([
      ['Press banca', '5', '6-8', '120s'],
      ['Remo con barra', '4', '12', '90s'],
    ]);

  await agregarEjercicio(editor, 'Peso muerto');
  await expect(editor.locator('.ejercicio')).toHaveCount(3);
  await expect
    .poll(() => estructuraDelDia(ctx))
    .toEqual([
      ['Press banca', '5', '6-8', '120s'],
      ['Remo con barra', '4', '12', '90s'],
      ['Peso muerto', '4', '12', '90s'],
    ]);
  await ctx.close();
});

test('un día vacío usa 3, 10 y 60s aunque otro día tenga ejercicios con otros valores', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('se18'));
  const editor = await crearRutina(page, 'Rutina de día vacío');
  await editor.getByRole('button', { name: 'Agregar día' }).click();
  await expect(editor.locator('.dia-rutina')).toHaveCount(2);
  await expect.poll(async () => (await rutinasEnServidor(ctx))[0]?.dias.length).toBe(2);

  const dias = editor.locator('.dia-rutina');
  await agregarEjercicio(editor, 'Press banca', dias.nth(0));
  await ponerValores(dias.nth(0).locator('.ejercicio').first(), '5', '6-8', '120s');
  await expect.poll(() => estructuraDelDia(ctx, 0)).toEqual([['Press banca', '5', '6-8', '120s']]);

  await agregarEjercicio(editor, 'Remo con barra', dias.nth(1));
  await expect.poll(() => estructuraDelDia(ctx, 1)).toEqual([['Remo con barra', '3', '10', '60s']]);
  await ctx.close();
});

test('si el último ejercicio tiene las series vacías, el nuevo usa 3 y hereda lo demás', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('se19'));
  const editor = await crearRutina(page, 'Rutina de series vacías');

  await agregarEjercicio(editor, 'Press banca');
  await ponerValores(editor.locator('.ejercicio').first(), '', '6-8', '120s');
  await expect.poll(() => estructuraDelDia(ctx)).toEqual([['Press banca', '', '6-8', '120s']]);

  await agregarEjercicio(editor, 'Remo con barra');
  await expect(editor.locator('.ejercicio')).toHaveCount(2);
  await expect
    .poll(() => estructuraDelDia(ctx))
    .toEqual([
      ['Press banca', '', '6-8', '120s'],
      ['Remo con barra', '3', '6-8', '120s'],
    ]);
  await ctx.close();
});

test('escribir «Press  banca» con doble espacio no ofrece crear un ejercicio que ya existe', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('se20'));
  const editor = await crearRutina(page, 'Rutina de doble espacio');

  const hoja = await abrirHoja(editor);
  await buscador(hoja).fill('Press  banca');
  await expect(hoja.getByRole('button', { name: 'Press banca', exact: true })).toBeVisible();
  await expect(hoja.getByRole('button', { name: /^Crear/ })).toHaveCount(0);
  await expect(hoja.locator('[role=status]')).not.toContainText('Sin coincidencias');
  await ctx.close();
});

test('el buscador recorta a 80 caracteres lo que se escribe', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('se21'));
  const editor = await crearRutina(page, 'Rutina de largo máximo');

  const hoja = await abrirHoja(editor);
  await buscador(hoja).fill('a'.repeat(120));
  await expect(buscador(hoja)).toHaveValue('a'.repeat(80));
  await ctx.close();
});
