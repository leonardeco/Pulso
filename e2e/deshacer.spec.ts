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

async function entrar(page: Page, mail: string): Promise<void> {
  await page.goto('/entrar');
  await page.locator('input[name=correo]').fill(mail);
  const boton = page.getByRole('button', { name: 'Entrar', exact: true });
  await escribirClave(page.locator('input[name=clave]'), CLAVE, boton);
  await boton.click();
  await page.waitForURL((u) => !u.pathname.startsWith('/entrar'));
}

type EstadoServidor = {
  clientes: { nombre: string }[];
  rutinas: {
    nombre: string;
    dias: { nombre: string; ejercicios: { nombre: string; series?: string }[] }[];
  }[];
};

async function estadoEnServidor(ctx: BrowserContext): Promise<EstadoServidor> {
  const r = (await (await ctx.request.get('/api/estudio')).json()) as { estado: EstadoServidor };
  return r.estado;
}

const nombresDeEjercicios = async (ctx: BrowserContext, dia = 0): Promise<string[]> =>
  (await estadoEnServidor(ctx)).rutinas[0]?.dias[dia]?.ejercicios.map((e) => e.nombre) ?? [];

async function crearRutina(page: Page, ctx: BrowserContext, nombre: string): Promise<Locator> {
  await page.goto('/rutinas');
  await page.locator('input[name=nombre]').fill(nombre);
  await page.getByRole('button', { name: 'Crear rutina' }).click();
  const editor = page.locator('app-editor-rutina');
  await expect(editor).toBeVisible();
  await expect
    .poll(async () => (await estadoEnServidor(ctx)).rutinas.some((r) => r.nombre === nombre))
    .toBe(true);
  return editor;
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

// Agrega ejercicios al primer día eligiéndolos por nombre, en orden.
async function ponerEjercicios(editor: Locator, nombres: string[]): Promise<void> {
  const dia = editor.locator('.dia-rutina').first();
  for (let i = 0; i < nombres.length; i++) {
    await agregarEjercicio(editor, nombres[i], dia);
    await expect(dia.locator('.ejercicio')).toHaveCount(i + 1);
  }
}

async function valoresDeEjercicios(dia: Locator): Promise<string[]> {
  return dia.locator('.ejercicio').getByLabel('Ejercicio', { exact: true }).evaluateAll((campos) =>
    campos.map((c) => (c as HTMLInputElement).value),
  );
}

async function abrirFicha(page: Page, nombre: string): Promise<void> {
  await page.goto('/clientes');
  await page.getByRole('link', { name: new RegExp(nombre) }).click();
  await expect(page.getByRole('heading', { name: nombre })).toBeVisible();
}

test('un ejercicio quitado vuelve a su misma posición al pulsar Deshacer', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('de1'));
  const editor = await crearRutina(page, ctx, 'Rutina de ejercicios');
  await ponerEjercicios(editor, ['Press banca', 'Remo con barra', 'Peso muerto']);
  await expect.poll(() => nombresDeEjercicios(ctx)).toEqual(['Press banca', 'Remo con barra', 'Peso muerto']);

  const dia = editor.locator('.dia-rutina').first();
  await dia.locator('.ejercicio').nth(1).getByRole('button', { name: 'Quitar ejercicio' }).click();
  const fila = editor.locator('.fila-quitado');
  await expect(fila).toHaveText(/Quitado · Remo con barra/);
  await expect(fila).toHaveAttribute('role', 'status');
  await expect(dia.locator('.ejercicio')).toHaveCount(2);
  await expect.poll(() => nombresDeEjercicios(ctx)).toEqual(['Press banca', 'Peso muerto']);

  await editor.getByRole('button', { name: 'Deshacer: Remo con barra' }).click();
  await expect(fila).toHaveCount(0);
  await expect(dia.locator('.ejercicio')).toHaveCount(3);
  expect(await valoresDeEjercicios(dia)).toEqual(['Press banca', 'Remo con barra', 'Peso muerto']);
  await expect.poll(() => nombresDeEjercicios(ctx)).toEqual(['Press banca', 'Remo con barra', 'Peso muerto']);
  await ctx.close();
});

test('un día quitado vuelve con todos sus ejercicios al pulsar Deshacer', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('de2'));
  const editor = await crearRutina(page, ctx, 'Rutina de días');

  const dias = editor.locator('.dia-rutina');
  await dias.first().getByLabel('Día', { exact: true }).fill('Lunes');
  await ponerEjercicios(editor, ['Sentadilla búlgara', 'Hip thrust']);
  await editor.getByRole('button', { name: 'Agregar día' }).click();
  await expect(dias).toHaveCount(2);
  await expect
    .poll(async () => {
      const [rutina] = (await estadoEnServidor(ctx)).rutinas;
      return rutina?.dias.map((d) => [d.nombre, d.ejercicios.length]);
    })
    .toEqual([['Lunes', 2], ['Día nuevo', 0]]);

  await dias.first().getByRole('button', { name: 'Quitar día' }).click();
  await expect(editor.locator('.fila-quitado')).toHaveText(/Quitado · Lunes/);
  await expect(dias).toHaveCount(1);
  await expect.poll(async () => (await estadoEnServidor(ctx)).rutinas[0]?.dias.length).toBe(1);

  await editor.getByRole('button', { name: 'Deshacer: Lunes' }).click();
  await expect(editor.locator('.fila-quitado')).toHaveCount(0);
  await expect(dias).toHaveCount(2);
  await expect(dias.first().getByLabel('Día', { exact: true })).toHaveValue('Lunes');
  expect(await valoresDeEjercicios(dias.first())).toEqual(['Sentadilla búlgara', 'Hip thrust']);
  await expect
    .poll(async () => {
      const [rutina] = (await estadoEnServidor(ctx)).rutinas;
      return rutina?.dias.map((d) => [d.nombre, d.ejercicios.map((e) => e.nombre)]);
    })
    .toEqual([['Lunes', ['Sentadilla búlgara', 'Hip thrust']], ['Día nuevo', []]]);
  await ctx.close();
});

test('pasados 10 segundos la fila de lo quitado desaparece y ya no se puede deshacer', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await page.clock.install();
  await registrar(page, correo('de3'));
  const editor = await crearRutina(page, ctx, 'Rutina con tiempo');
  await ponerEjercicios(editor, ['Dominadas', 'Fondos']);
  await expect.poll(() => nombresDeEjercicios(ctx)).toEqual(['Dominadas', 'Fondos']);

  await editor.locator('.ejercicio').first().getByRole('button', { name: 'Quitar ejercicio' }).click();
  const fila = editor.locator('.fila-quitado');
  await expect(fila).toHaveText(/Quitado · Dominadas/);

  // El cursor encima de la fila pausa el plazo; se aparta para que corra.
  await page.mouse.move(1, 1);
  await page.clock.fastForward(9000);
  await expect(fila).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Deshacer: Dominadas' })).toBeVisible();

  await page.clock.fastForward(2000);
  await expect(fila).toHaveCount(0);
  await expect(editor.getByRole('button', { name: /^Deshacer/ })).toHaveCount(0);
  await expect(editor.locator('.ejercicio')).toHaveCount(1);
  await expect.poll(() => nombresDeEjercicios(ctx)).toEqual(['Fondos']);
  await ctx.close();
});

test('con el cursor sobre la fila el plazo no vence y al salir la fila desaparece tras el tiempo restante', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await page.clock.install();
  await registrar(page, correo('de8'));
  const editor = await crearRutina(page, ctx, 'Rutina con pausa');
  await ponerEjercicios(editor, ['Remo con mancuerna', 'Elevaciones laterales']);
  await expect.poll(() => nombresDeEjercicios(ctx)).toEqual(['Remo con mancuerna', 'Elevaciones laterales']);

  await editor.locator('.ejercicio').first().getByRole('button', { name: 'Quitar ejercicio' }).click();
  const fila = editor.locator('.fila-quitado');
  await expect(fila).toHaveText(/Quitado · Remo con mancuerna/);

  await fila.hover();
  await page.clock.fastForward(15000);
  await expect(fila).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Deshacer: Remo con mancuerna' })).toBeVisible();

  await page.mouse.move(1, 1);
  await page.clock.fastForward(4000);
  await expect(fila).toBeVisible();

  await page.clock.fastForward(7000);
  await expect(fila).toHaveCount(0);
  await expect(editor.getByRole('button', { name: /^Deshacer/ })).toHaveCount(0);
  await expect.poll(() => nombresDeEjercicios(ctx)).toEqual(['Elevaciones laterales']);
  await ctx.close();
});

test('quitar con el teclado deja el foco en Deshacer y quitar con clic no lo mueve', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('de9'));
  const editor = await crearRutina(page, ctx, 'Rutina con foco');
  await ponerEjercicios(editor, ['Prensa', 'Extensiones', 'Curl femoral']);
  await expect.poll(() => nombresDeEjercicios(ctx)).toEqual(['Prensa', 'Extensiones', 'Curl femoral']);

  const fila = editor.locator('.fila-quitado');
  await editor.locator('.ejercicio').first().getByRole('button', { name: 'Quitar ejercicio' }).press('Enter');
  await expect(fila).toHaveText(/Quitado · Prensa/);
  await expect(editor.getByRole('button', { name: 'Deshacer: Prensa' })).toBeFocused();

  await editor.locator('.ejercicio').first().getByRole('button', { name: 'Quitar ejercicio' }).click();
  await expect(fila).toHaveText(/Quitado · Extensiones/);
  // Se espera a que la pantalla termine de pintar para comprobar que el foco no se movió.
  await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
  await expect(editor.getByRole('button', { name: 'Deshacer: Extensiones' })).not.toBeFocused();
  await expect(editor.locator('.fila-quitado button:focus')).toHaveCount(0);
  await ctx.close();
});

test('tras Deshacer con el teclado el foco queda dentro del ejercicio devuelto', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('de10'));
  const editor = await crearRutina(page, ctx, 'Rutina con foco devuelto');
  await ponerEjercicios(editor, ['Press inclinado', 'Aperturas', 'Fondos en paralelas']);
  await expect.poll(() => nombresDeEjercicios(ctx)).toEqual(['Press inclinado', 'Aperturas', 'Fondos en paralelas']);

  const dia = editor.locator('.dia-rutina').first();
  await dia.locator('.ejercicio').nth(1).getByRole('button', { name: 'Quitar ejercicio' }).press('Enter');
  const deshacer = editor.getByRole('button', { name: 'Deshacer: Aperturas' });
  await expect(deshacer).toBeFocused();
  await deshacer.press('Enter');

  await expect(editor.locator('.fila-quitado')).toHaveCount(0);
  await expect(dia.locator('.ejercicio')).toHaveCount(3);
  const devuelto = dia.locator('.ejercicio').nth(1);
  await expect(devuelto.getByLabel('Ejercicio', { exact: true })).toHaveValue('Aperturas');
  await expect(devuelto.locator(':focus')).toHaveCount(1);
  await expect.poll(() => nombresDeEjercicios(ctx)).toEqual(['Press inclinado', 'Aperturas', 'Fondos en paralelas']);
  await ctx.close();
});

test('escribir en Series hace desaparecer la fila sin salir del campo y el servidor queda con lo esperado', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('de11'));
  const editor = await crearRutina(page, ctx, 'Rutina con escritura');
  await ponerEjercicios(editor, ['Hombro posterior', 'Face pull']);
  await expect.poll(() => nombresDeEjercicios(ctx)).toEqual(['Hombro posterior', 'Face pull']);

  await editor.locator('.ejercicio').first().getByRole('button', { name: 'Quitar ejercicio' }).click();
  const fila = editor.locator('.fila-quitado');
  await expect(fila).toHaveText(/Quitado · Hombro posterior/);
  await expect.poll(() => nombresDeEjercicios(ctx)).toEqual(['Face pull']);

  const series = editor.locator('.ejercicio').first().getByLabel('Series', { exact: true });
  await series.fill('5');
  await expect(series).toBeFocused();
  await expect(fila).toHaveCount(0);
  await expect(editor.getByRole('button', { name: /^Deshacer/ })).toHaveCount(0);

  await series.blur();
  await expect
    .poll(async () => {
      const [rutina] = (await estadoEnServidor(ctx)).rutinas;
      return rutina?.dias[0]?.ejercicios.map((e) => [e.nombre, e.series]);
    })
    .toEqual([['Face pull', '5']]);
  await ctx.close();
});

test('hacer otro cambio hace desaparecer la fila de lo quitado y ya no se puede deshacer', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('de4'));
  const editor = await crearRutina(page, ctx, 'Rutina con otro cambio');
  await ponerEjercicios(editor, ['Zancadas', 'Plancha']);
  await expect.poll(() => nombresDeEjercicios(ctx)).toEqual(['Zancadas', 'Plancha']);

  await editor.locator('.ejercicio').first().getByRole('button', { name: 'Quitar ejercicio' }).click();
  const fila = editor.locator('.fila-quitado');
  await expect(fila).toHaveText(/Quitado · Zancadas/);

  await agregarEjercicio(editor, 'Sentadilla', editor.locator('.dia-rutina').first());
  await expect(fila).toHaveCount(0);
  await expect(editor.getByRole('button', { name: /^Deshacer/ })).toHaveCount(0);
  await expect(editor.locator('.ejercicio')).toHaveCount(2);
  await expect.poll(() => nombresDeEjercicios(ctx)).toEqual(['Plancha', 'Sentadilla']);
  await ctx.close();
});

test('si otro dispositivo guardó antes, el servidor rechaza el cambio y la fila de lo quitado desaparece', async ({ browser }) => {
  const mail = correo('de5');
  const a = await dispositivo(browser);
  const b = await dispositivo(browser);
  const pa = await a.newPage();
  await registrar(pa, mail);
  const editorA = await crearRutina(pa, a, 'Rutina compartida');
  await ponerEjercicios(editorA, ['Curl de bíceps', 'Press militar']);
  await expect.poll(() => nombresDeEjercicios(a)).toEqual(['Curl de bíceps', 'Press militar']);

  // El otro dispositivo entra con la versión actual y guarda un cambio antes que el primero.
  const pb = await b.newPage();
  await entrar(pb, mail);
  await pb.goto('/rutinas');
  await pb.getByRole('button', { name: /Rutina compartida/ }).click();
  const editorB = pb.locator('app-editor-rutina');
  await expect(editorB).toBeVisible();
  const guardadoB = pb.waitForResponse(
    (r) => r.url().endsWith('/api/estudio') && r.request().method() === 'PUT' && r.status() === 200,
  );
  const nombreB = editorB.getByLabel('Nombre de la rutina', { exact: true });
  await nombreB.fill('Rutina cambiada en B');
  await nombreB.blur();
  await guardadoB;

  // El primero retiene su guardado para ver la fila antes de que llegue el rechazo.
  let soltar!: () => void;
  let llego!: () => void;
  const puerta = new Promise<void>((ok) => (soltar = ok));
  const avisoLlegada = new Promise<void>((ok) => (llego = ok));
  await pa.route('**/api/estudio', async (ruta) => {
    if (ruta.request().method() !== 'PUT') return ruta.fallback();
    llego();
    await puerta;
    return ruta.fallback();
  });

  await editorA.locator('.ejercicio').first().getByRole('button', { name: 'Quitar ejercicio' }).click();
  await avisoLlegada;
  const fila = editorA.locator('.fila-quitado');
  await expect(fila).toHaveText(/Quitado · Curl de bíceps/);

  const rechazo = pa.waitForResponse(
    (r) => r.url().endsWith('/api/estudio') && r.request().method() === 'PUT' && r.status() === 409,
  );
  soltar();
  await rechazo;

  await expect(pa.getByText('Este estudio cambió en otro dispositivo')).toBeVisible();
  await expect(fila).toHaveCount(0);
  await expect(editorA.getByRole('button', { name: /^Deshacer/ })).toHaveCount(0);
  await expect(editorA.getByLabel('Nombre de la rutina', { exact: true })).toHaveValue('Rutina cambiada en B');
  await expect(editorA.locator('.ejercicio')).toHaveCount(2);
  await a.close();
  await b.close();
});

test('Borrar rutina pide confirmar con el nombre de la rutina y cancelar no la borra', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('de6'));
  const editor = await crearRutina(page, ctx, 'Rutina a borrar');

  const mensajes: string[] = [];
  page.once('dialog', (dialogo) => {
    mensajes.push(dialogo.message());
    void dialogo.dismiss();
  });
  await editor.getByRole('button', { name: 'Borrar rutina' }).click();
  await expect.poll(() => mensajes.length).toBe(1);
  expect(mensajes[0]).toContain('Rutina a borrar');
  await expect(editor).toBeVisible();
  await page.waitForTimeout(1500);
  expect((await estadoEnServidor(ctx)).rutinas.map((r) => r.nombre)).toEqual(['Rutina a borrar']);

  page.once('dialog', (dialogo) => {
    mensajes.push(dialogo.message());
    void dialogo.accept();
  });
  await editor.getByRole('button', { name: 'Borrar rutina' }).click();
  await expect.poll(async () => (await estadoEnServidor(ctx)).rutinas.length).toBe(0);
  expect(mensajes[1]).toContain('Rutina a borrar');
  await ctx.close();
});

test('quitar un cliente avisa que también se borran sus rutinas, tablas, pagos y acceso', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('de7'));
  await page.goto('/clientes');
  await page.getByRole('button', { name: 'Nuevo' }).click();
  await page.locator('input[name=nombre]').fill('Cliente Quitable');
  await page.locator('input[name=telefono]').fill(`300${Date.now().toString().slice(-7)}`);
  const guardado = page.waitForResponse(
    (r) => r.url().endsWith('/api/estudio') && r.request().method() === 'PUT' && r.status() === 200,
  );
  await page.getByRole('button', { name: 'Guardar cliente' }).click();
  await guardado;
  await abrirFicha(page, 'Cliente Quitable');

  const mensajes: string[] = [];
  page.once('dialog', (dialogo) => {
    mensajes.push(dialogo.message());
    void dialogo.dismiss();
  });
  await page.getByRole('button', { name: 'Quitar cliente' }).click();
  await expect.poll(() => mensajes.length).toBe(1);
  expect(mensajes[0]).toBe('¿Quitar a Cliente Quitable? También se borran sus citas, rutinas, tablas, pagos y acceso.');
  for (const palabra of ['rutinas', 'tablas', 'pagos', 'acceso']) expect(mensajes[0]).toContain(palabra);
  await page.waitForTimeout(1500);
  expect((await estadoEnServidor(ctx)).clientes.map((c) => c.nombre)).toContain('Cliente Quitable');

  page.once('dialog', (dialogo) => void dialogo.accept());
  await page.getByRole('button', { name: 'Quitar cliente' }).click();
  await expect
    .poll(async () => (await estadoEnServidor(ctx)).clientes.map((c) => c.nombre))
    .not.toContain('Cliente Quitable');
  await ctx.close();
});
