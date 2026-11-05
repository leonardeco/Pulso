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

type RutinaServidor = {
  clienteId: string | null;
  nombre: string;
  dias: { id: string; nombre: string; ejercicios: { id: string; nombre: string; series?: string }[] }[];
};

async function rutinasEnServidor(ctx: BrowserContext): Promise<RutinaServidor[]> {
  const r = (await (await ctx.request.get('/api/estudio')).json()) as { estado: { rutinas: RutinaServidor[] } };
  return r.estado.rutinas;
}

// Nombres de los ejercicios de cada día de la primera rutina.
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

// Agrega ejercicios al día indicado y les pone nombre, en orden.
async function ponerEjercicios(editor: Locator, nombres: string[], indiceDia = 0): Promise<void> {
  const dia = editor.locator('.dia-rutina').nth(indiceDia);
  for (let i = 0; i < nombres.length; i++) {
    await dia.getByRole('button', { name: 'Agregar ejercicio' }).click();
    await expect(dia.locator('.ejercicio')).toHaveCount(i + 1);
    await dia.locator('.ejercicio').nth(i).getByLabel('Ejercicio', { exact: true }).fill(nombres[i]);
  }
}

async function nombrarDia(editor: Locator, indice: number, nombre: string): Promise<void> {
  const campo = editor.locator('.dia-rutina').nth(indice).getByLabel('Día', { exact: true });
  await campo.fill(nombre);
  await campo.blur();
}

// Deja la rutina con dos días, Lunes y Martes, y los ejercicios de cada uno.
async function prepararDosDias(editor: Locator, ctx: BrowserContext, lunes: string[], martes: string[]): Promise<void> {
  await nombrarDia(editor, 0, 'Lunes');
  await ponerEjercicios(editor, lunes, 0);
  await editor.getByRole('button', { name: 'Agregar día' }).click();
  await expect(editor.locator('.dia-rutina')).toHaveCount(2);
  await nombrarDia(editor, 1, 'Martes');
  await ponerEjercicios(editor, martes, 1);
  await expect.poll(() => ordenEnServidor(ctx)).toEqual([lunes, martes]);
}

async function valoresDeEjercicios(dia: Locator): Promise<string[]> {
  return dia.locator('.ejercicio').getByLabel('Ejercicio', { exact: true }).evaluateAll((campos) =>
    campos.map((c) => (c as HTMLInputElement).value),
  );
}

const anuncio = (editor: Locator): Locator => editor.locator('div.sr-only[role=status]');
const botonDe = (ejercicio: Locator, nombre: string): Locator => ejercicio.getByRole('button', { name: nombre });

// Elige el día en el selector del ejercicio y pulsa Mover.
async function moverADia(ejercicio: Locator, dia: string): Promise<void> {
  await ejercicio.locator('select[data-orden=dia]').selectOption({ label: dia });
  await ejercicio.locator('[data-orden=mover]').click();
}

test('duplicar un ejercicio deja la copia justo debajo con el foco en su primer campo', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('ord1'));
  const editor = await crearRutina(page, ctx, 'Rutina para duplicar');
  await ponerEjercicios(editor, ['Press banca', 'Remo con barra', 'Peso muerto']);
  await expect.poll(() => ordenEnServidor(ctx)).toEqual([['Press banca', 'Remo con barra', 'Peso muerto']]);

  const dia = editor.locator('.dia-rutina').first();
  const ejercicios = dia.locator('.ejercicio');
  await dia.locator('.ejercicio').nth(0).getByLabel('Series', { exact: true }).fill('4');
  await dia.locator('.ejercicio').nth(0).getByLabel('Series', { exact: true }).blur();
  await botonDe(ejercicios.nth(0), 'Duplicar Press banca').click();

  await expect(ejercicios).toHaveCount(4);
  expect(await valoresDeEjercicios(dia)).toEqual(['Press banca', 'Press banca', 'Remo con barra', 'Peso muerto']);
  await expect(ejercicios.nth(1).getByLabel('Series', { exact: true })).toHaveValue('4');
  await expect(ejercicios.nth(1).getByLabel('Ejercicio', { exact: true })).toBeFocused();
  await expect
    .poll(async () => {
      const [rutina] = await rutinasEnServidor(ctx);
      const lista = rutina?.dias[0]?.ejercicios ?? [];
      return { nombres: lista.map((e) => e.nombre), series: lista[1]?.series, idsDistintos: new Set(lista.map((e) => e.id)).size };
    })
    .toEqual({ nombres: ['Press banca', 'Press banca', 'Remo con barra', 'Peso muerto'], series: '4', idsDistintos: 4 });
  await ctx.close();
});

test('duplicar un día copia todos sus ejercicios en un día nuevo debajo del original', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('ord2'));
  const editor = await crearRutina(page, ctx, 'Rutina con días');
  await prepararDosDias(editor, ctx, ['Sentadilla búlgara', 'Hip thrust'], ['Dominadas']);

  const dias = editor.locator('.dia-rutina');
  await dias.nth(0).getByRole('button', { name: 'Duplicar día Lunes' }).click();

  await expect(dias).toHaveCount(3);
  await expect(dias.nth(1).getByLabel('Día', { exact: true })).toHaveValue('Lunes (copia)');
  expect(await valoresDeEjercicios(dias.nth(1))).toEqual(['Sentadilla búlgara', 'Hip thrust']);
  await expect(dias.nth(1).getByLabel('Día', { exact: true })).toBeFocused();
  await expect(dias.nth(2).getByLabel('Día', { exact: true })).toHaveValue('Martes');
  await expect
    .poll(async () => {
      const [rutina] = await rutinasEnServidor(ctx);
      const ids = (rutina?.dias ?? []).flatMap((d) => [d.id, ...d.ejercicios.map((e) => e.id)]);
      return {
        dias: rutina?.dias.map((d) => [d.nombre, d.ejercicios.map((e) => e.nombre)]),
        idsDistintos: new Set(ids).size === ids.length,
      };
    })
    .toEqual({
      dias: [['Lunes', ['Sentadilla búlgara', 'Hip thrust']], ['Lunes (copia)', ['Sentadilla búlgara', 'Hip thrust']], ['Martes', ['Dominadas']]],
      idsDistintos: true,
    });
  await ctx.close();
});

test('duplicar una rutina de un cliente deja la copia con el mismo cliente y los mismos ejercicios', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('ord3'));
  await crearCliente(page, 'Cliente Copiable');
  const editor = await crearRutina(page, ctx, 'Rutina del cliente', 'Cliente Copiable');
  await ponerEjercicios(editor, ['Prensa', 'Extensiones']);
  await expect.poll(() => ordenEnServidor(ctx)).toEqual([['Prensa', 'Extensiones']]);
  const original = (await rutinasEnServidor(ctx))[0];
  expect(original.clienteId).not.toBeNull();

  await editor.getByRole('button', { name: 'Duplicar rutina Rutina del cliente' }).click();

  await expect(page.getByRole('button', { name: /^Rutina del cliente \(copia\)/ })).toBeVisible();
  // La copia queda abierta en el acordeón y el foco va a su campo "Nombre de la rutina".
  await expect(page.locator('app-editor-rutina')).toHaveCount(1);
  const nombreCopia = page.locator('app-editor-rutina').getByLabel('Nombre de la rutina');
  await expect(nombreCopia).toHaveValue('Rutina del cliente (copia)');
  await expect(nombreCopia).toBeFocused();
  await expect
    .poll(async () => (await rutinasEnServidor(ctx)).map((r) => [r.nombre, r.clienteId, r.dias[0]?.ejercicios.map((e) => e.nombre)]))
    .toEqual([
      ['Rutina del cliente', original.clienteId, ['Prensa', 'Extensiones']],
      ['Rutina del cliente (copia)', original.clienteId, ['Prensa', 'Extensiones']],
    ]);
  const [primera, copia] = await rutinasEnServidor(ctx);
  expect(copia.dias[0].id).not.toBe(primera.dias[0].id);
  expect(copia.dias[0].ejercicios[0].id).not.toBe(primera.dias[0].ejercicios[0].id);
  await ctx.close();
});

test('Subir y Bajar funcionan con el teclado, el foco acompaña al ejercicio y los extremos quedan deshabilitados', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('ord4'));
  const editor = await crearRutina(page, ctx, 'Rutina con orden');
  await ponerEjercicios(editor, ['Prensa', 'Extensiones', 'Curl femoral']);
  await expect.poll(() => ordenEnServidor(ctx)).toEqual([['Prensa', 'Extensiones', 'Curl femoral']]);

  const ejercicios = editor.locator('.dia-rutina').first().locator('.ejercicio');
  const subir = (i: number) => ejercicios.nth(i).locator('[data-orden=subir]');
  const bajar = (i: number) => ejercicios.nth(i).locator('[data-orden=bajar]');

  await expect(subir(0)).toBeDisabled();
  await expect(bajar(0)).toBeEnabled();
  await expect(subir(2)).toBeEnabled();
  await expect(bajar(2)).toBeDisabled();

  // Prensa baja una posición y el foco se queda en su botón Bajar.
  await bajar(0).press('Enter');
  await expect(ejercicios.nth(1).getByLabel('Ejercicio', { exact: true })).toHaveValue('Prensa');
  await expect(bajar(1)).toBeFocused();
  await expect.poll(() => ordenEnServidor(ctx)).toEqual([['Extensiones', 'Prensa', 'Curl femoral']]);

  // Llega al final: Bajar se deshabilita y el foco pasa a Subir.
  await bajar(1).press('Enter');
  await expect(ejercicios.nth(2).getByLabel('Ejercicio', { exact: true })).toHaveValue('Prensa');
  await expect(bajar(2)).toBeDisabled();
  await expect(subir(2)).toBeFocused();
  await expect.poll(() => ordenEnServidor(ctx)).toEqual([['Extensiones', 'Curl femoral', 'Prensa']]);

  // Sube de nuevo con el teclado hasta el primer lugar: Subir se deshabilita y el foco pasa a Bajar.
  await subir(2).press('Enter');
  await expect(subir(1)).toBeFocused();
  await subir(1).press('Space');
  await expect(ejercicios.nth(0).getByLabel('Ejercicio', { exact: true })).toHaveValue('Prensa');
  await expect(subir(0)).toBeDisabled();
  await expect(bajar(0)).toBeFocused();
  await expect.poll(() => ordenEnServidor(ctx)).toEqual([['Prensa', 'Extensiones', 'Curl femoral']]);
  await ctx.close();
});

test('mover un ejercicio a otro día lo deja al final de ese día y el foco queda en su selector', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('ord5'));
  const editor = await crearRutina(page, ctx, 'Rutina de dos días');

  // Con un solo día no hay a dónde mover, así que el selector no aparece.
  await nombrarDia(editor, 0, 'Lunes');
  await ponerEjercicios(editor, ['Press banca', 'Remo con barra', 'Peso muerto'], 0);
  await expect(editor.locator('select[data-orden=dia]')).toHaveCount(0);
  await editor.getByRole('button', { name: 'Agregar día' }).click();
  await expect(editor.locator('.dia-rutina')).toHaveCount(2);
  await nombrarDia(editor, 1, 'Martes');
  await ponerEjercicios(editor, ['Dominadas', 'Fondos'], 1);
  await expect
    .poll(() => ordenEnServidor(ctx))
    .toEqual([['Press banca', 'Remo con barra', 'Peso muerto'], ['Dominadas', 'Fondos']]);
  const dias = editor.locator('.dia-rutina');
  const lunes = dias.nth(0);
  const martes = dias.nth(1);

  const selector = lunes.locator('.ejercicio').nth(1).locator('select[data-orden=dia]');
  await expect(selector.locator('option')).toHaveText(['Mover al día…', 'Martes']);
  await selector.selectOption({ label: 'Martes' });
  await lunes.locator('.ejercicio').nth(1).locator('[data-orden=mover]').click();

  await expect(lunes.locator('.ejercicio')).toHaveCount(2);
  expect(await valoresDeEjercicios(lunes)).toEqual(['Press banca', 'Peso muerto']);
  expect(await valoresDeEjercicios(martes)).toEqual(['Dominadas', 'Fondos', 'Remo con barra']);
  const nuevoSelector = martes.locator('.ejercicio').nth(2).locator('select[data-orden=dia]');
  await expect(nuevoSelector).toBeFocused();
  await expect(nuevoSelector).toHaveValue('');
  await expect
    .poll(() => ordenEnServidor(ctx))
    .toEqual([['Press banca', 'Peso muerto'], ['Dominadas', 'Fondos', 'Remo con barra']]);
  await ctx.close();
});

test('cada movimiento y cada copia se anuncia en la región viva con su posición o su nombre', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('ord6'));
  const editor = await crearRutina(page, ctx, 'Rutina anunciada');
  await prepararDosDias(editor, ctx, ['Press banca', 'Remo con barra', 'Peso muerto'], ['Dominadas']);

  const region = anuncio(editor);
  await expect(region).toHaveAttribute('aria-live', 'polite');
  await expect(region).toHaveText('');

  const dias = editor.locator('.dia-rutina');
  const lunes = dias.nth(0).locator('.ejercicio');

  await botonDe(lunes.nth(0), 'Bajar Press banca').click();
  await expect(region).toHaveText('Press banca movida a la posición 2 de 3');

  await botonDe(lunes.nth(1), 'Subir Press banca').click();
  await expect(region).toHaveText('Press banca movida a la posición 1 de 3');

  await moverADia(lunes.nth(2), 'Martes');
  await expect(region).toHaveText('Peso muerto movida a la posición 2 de 2');

  await botonDe(lunes.nth(0), 'Duplicar Press banca').click();
  await expect(region).toHaveText('Press banca duplicado');

  await dias.nth(0).getByRole('button', { name: 'Duplicar día Lunes' }).click();
  await expect(region).toHaveText('Lunes duplicado');

  await editor.getByRole('button', { name: 'Duplicar rutina Rutina anunciada' }).click();
  await expect(region).toHaveText('Rutina anunciada duplicada');
  await ctx.close();
});

test('duplicar o subir un ejercicio retira la fila de lo quitado y ya no se puede deshacer', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('ord7'));
  const editor = await crearRutina(page, ctx, 'Rutina con fila');
  await ponerEjercicios(editor, ['Zancadas', 'Plancha', 'Burpees']);
  await expect.poll(() => ordenEnServidor(ctx)).toEqual([['Zancadas', 'Plancha', 'Burpees']]);

  const ejercicios = editor.locator('.dia-rutina').first().locator('.ejercicio');
  const fila = editor.locator('.fila-quitado');

  await botonDe(ejercicios.nth(1), 'Quitar ejercicio').click();
  await expect(fila).toHaveText(/Quitado · Plancha/);
  await expect.poll(() => ordenEnServidor(ctx)).toEqual([['Zancadas', 'Burpees']]);
  await botonDe(ejercicios.nth(1), 'Duplicar Burpees').click();
  await expect(fila).toHaveCount(0);
  await expect(editor.getByRole('button', { name: /^Deshacer/ })).toHaveCount(0);
  await expect.poll(() => ordenEnServidor(ctx)).toEqual([['Zancadas', 'Burpees', 'Burpees']]);

  await botonDe(ejercicios.nth(0), 'Quitar ejercicio').click();
  await expect(fila).toHaveText(/Quitado · Zancadas/);
  await expect.poll(() => ordenEnServidor(ctx)).toEqual([['Burpees', 'Burpees']]);
  await ejercicios.nth(1).locator('[data-orden=subir]').click();
  await expect(fila).toHaveCount(0);
  await expect(editor.getByRole('button', { name: /^Deshacer/ })).toHaveCount(0);
  await expect(ejercicios).toHaveCount(2);
  await ctx.close();
});

test('mover a otro día o duplicar un día o la rutina retira la fila de lo quitado', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('ord8'));
  const editor = await crearRutina(page, ctx, 'Rutina con varias filas');
  await prepararDosDias(editor, ctx, ['Press militar', 'Elevaciones laterales', 'Face pull'], ['Curl de bíceps']);

  const dias = editor.locator('.dia-rutina');
  const lunes = dias.nth(0).locator('.ejercicio');
  const fila = editor.locator('.fila-quitado');

  await botonDe(lunes.nth(1), 'Quitar ejercicio').click();
  await expect(fila).toHaveText(/Quitado · Elevaciones laterales/);
  await moverADia(lunes.nth(1), 'Martes');
  await expect(fila).toHaveCount(0);
  await expect(editor.getByRole('button', { name: /^Deshacer/ })).toHaveCount(0);
  await expect.poll(() => ordenEnServidor(ctx)).toEqual([['Press militar'], ['Curl de bíceps', 'Face pull']]);

  await botonDe(lunes.nth(0), 'Quitar ejercicio').click();
  await expect(fila).toHaveText(/Quitado · Press militar/);
  await dias.nth(1).getByRole('button', { name: 'Duplicar día Martes' }).click();
  await expect(fila).toHaveCount(0);
  await expect(editor.getByRole('button', { name: /^Deshacer/ })).toHaveCount(0);
  await expect(dias).toHaveCount(3);

  await botonDe(dias.nth(1).locator('.ejercicio').nth(0), 'Quitar ejercicio').click();
  await expect(fila).toHaveText(/Quitado · Curl de bíceps/);
  await editor.getByRole('button', { name: 'Duplicar rutina Rutina con varias filas' }).click();
  await expect(fila).toHaveCount(0);
  await expect(editor.getByRole('button', { name: /^Deshacer/ })).toHaveCount(0);
  await ctx.close();
});

test('tras una serie de copias y movimientos el servidor coincide con la pantalla y con lo que queda al recargar', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('ord9'));
  const editor = await crearRutina(page, ctx, 'Rutina final');
  await prepararDosDias(editor, ctx, ['Press banca', 'Remo con barra', 'Peso muerto'], ['Dominadas']);

  const dias = editor.locator('.dia-rutina');
  const lunes = dias.nth(0).locator('.ejercicio');

  await botonDe(lunes.nth(1), 'Duplicar Remo con barra').click();
  await expect(lunes).toHaveCount(4);
  await botonDe(lunes.nth(0), 'Bajar Press banca').click();
  await expect(lunes.nth(1).getByLabel('Ejercicio', { exact: true })).toHaveValue('Press banca');
  await moverADia(lunes.nth(3), 'Martes');
  await expect(lunes).toHaveCount(3);
  await dias.nth(1).getByRole('button', { name: 'Duplicar día Martes' }).click();
  await expect(dias).toHaveCount(3);

  const esperado = [
    ['Remo con barra', 'Press banca', 'Remo con barra'],
    ['Dominadas', 'Peso muerto'],
    ['Dominadas', 'Peso muerto'],
  ];
  const enPantalla = async () => {
    const lista: string[][] = [];
    for (let i = 0; i < (await dias.count()); i++) lista.push(await valoresDeEjercicios(dias.nth(i)));
    return lista;
  };
  expect(await enPantalla()).toEqual(esperado);
  await expect.poll(() => ordenEnServidor(ctx)).toEqual(esperado);
  const nombresDias = (await rutinasEnServidor(ctx))[0].dias.map((d) => d.nombre);
  expect(nombresDias).toEqual(['Lunes', 'Martes', 'Martes (copia)']);

  await page.reload();
  await page.getByRole('button', { name: /Rutina final/ }).click();
  await expect(page.locator('app-editor-rutina')).toBeVisible();
  await expect(page.locator('app-editor-rutina .dia-rutina')).toHaveCount(3);
  const recargado: string[][] = [];
  for (let i = 0; i < 3; i++) recargado.push(await valoresDeEjercicios(page.locator('app-editor-rutina .dia-rutina').nth(i)));
  expect(recargado).toEqual(esperado);
  await ctx.close();
});

test('elegir un día en el selector no mueve el ejercicio hasta pulsar Mover', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('ord10'));
  const editor = await crearRutina(page, ctx, 'Rutina con selector');
  await prepararDosDias(editor, ctx, ['Press banca', 'Remo con barra', 'Peso muerto'], ['Dominadas']);

  const dias = editor.locator('.dia-rutina');
  const lunes = dias.nth(0);
  const martes = dias.nth(1);
  const ejercicio = lunes.locator('.ejercicio').nth(1);
  const selector = ejercicio.locator('select[data-orden=dia]');

  // Con el selector cerrado, la flecha abajo cambia la opción elegida sin abrir la lista.
  await selector.focus();
  await selector.press('ArrowDown');
  await expect(selector.locator('option:checked')).toHaveText('Martes');

  await page.waitForTimeout(800);
  await expect(lunes.locator('.ejercicio')).toHaveCount(3);
  expect(await valoresDeEjercicios(lunes)).toEqual(['Press banca', 'Remo con barra', 'Peso muerto']);
  expect(await valoresDeEjercicios(martes)).toEqual(['Dominadas']);
  await expect(anuncio(editor)).toHaveText('');
  expect(await ordenEnServidor(ctx)).toEqual([['Press banca', 'Remo con barra', 'Peso muerto'], ['Dominadas']]);

  await ejercicio.locator('[data-orden=mover]').click();
  await expect(lunes.locator('.ejercicio')).toHaveCount(2);
  expect(await valoresDeEjercicios(martes)).toEqual(['Dominadas', 'Remo con barra']);
  await expect.poll(() => ordenEnServidor(ctx)).toEqual([['Press banca', 'Peso muerto'], ['Dominadas', 'Remo con barra']]);
  await ctx.close();
});

test('pulsar Mover sin haber elegido un día no hace nada', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('ord11'));
  const editor = await crearRutina(page, ctx, 'Rutina sin destino');
  await prepararDosDias(editor, ctx, ['Press banca', 'Remo con barra'], ['Dominadas']);

  const dias = editor.locator('.dia-rutina');
  const ejercicio = dias.nth(0).locator('.ejercicio').nth(0);
  await expect(ejercicio.locator('select[data-orden=dia]')).toHaveValue('');
  await ejercicio.locator('[data-orden=mover]').click();

  await page.waitForTimeout(800);
  await expect(dias.nth(0).locator('.ejercicio')).toHaveCount(2);
  expect(await valoresDeEjercicios(dias.nth(0))).toEqual(['Press banca', 'Remo con barra']);
  expect(await valoresDeEjercicios(dias.nth(1))).toEqual(['Dominadas']);
  await expect(anuncio(editor)).toHaveText('');
  expect(await ordenEnServidor(ctx)).toEqual([['Press banca', 'Remo con barra'], ['Dominadas']]);
  await ctx.close();
});

test('duplicar dos veces el mismo ejercicio vuelve a anunciar duplicado cada vez', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('ord12'));
  const editor = await crearRutina(page, ctx, 'Rutina con anuncio repetido');
  await ponerEjercicios(editor, ['Press banca']);
  await expect.poll(() => ordenEnServidor(ctx)).toEqual([['Press banca']]);

  const region = anuncio(editor);
  const ejercicios = editor.locator('.dia-rutina').first().locator('.ejercicio');
  // Anota los textos que la región viva va dejando atrás, para ver que pasa por vacío antes de repetirse.
  await region.evaluate((nodo) => {
    const anteriores: string[] = [];
    (window as unknown as { textosAnteriores: string[] }).textosAnteriores = anteriores;
    new MutationObserver((registros) => {
      for (const registro of registros) anteriores.push(registro.oldValue ?? '');
    }).observe(nodo, { characterData: true, characterDataOldValue: true, subtree: true });
  });
  const anteriores = () => page.evaluate(() => (window as unknown as { textosAnteriores: string[] }).textosAnteriores);

  await botonDe(ejercicios.nth(0), 'Duplicar Press banca').click();
  await expect(ejercicios).toHaveCount(2);
  await expect(region).toHaveText('Press banca duplicado');
  await page.evaluate(() => ((window as unknown as { textosAnteriores: string[] }).textosAnteriores.length = 0));

  // La segunda vez el texto es idéntico: debe pasar a vacío y volver al texto.
  await botonDe(ejercicios.nth(0), 'Duplicar Press banca').click();
  await expect(ejercicios).toHaveCount(3);
  await expect.poll(anteriores).toEqual(['Press banca duplicado', '']);
  await expect(region).toHaveText('Press banca duplicado');
  await ctx.close();
});

test('duplicar un día con el nombre vacío deja Sin nombre (copia)', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('ord13'));
  const editor = await crearRutina(page, ctx, 'Rutina con día vacío');
  await ponerEjercicios(editor, ['Plancha']);
  await nombrarDia(editor, 0, '');
  await expect.poll(async () => (await rutinasEnServidor(ctx))[0]?.dias[0]?.nombre).toBe('');

  const dias = editor.locator('.dia-rutina');
  await dias.nth(0).getByRole('button', { name: 'Duplicar día sin nombre' }).click();

  await expect(dias).toHaveCount(2);
  await expect(dias.nth(1).getByLabel('Día', { exact: true })).toHaveValue('Sin nombre (copia)');
  await expect
    .poll(async () => (await rutinasEnServidor(ctx))[0]?.dias.map((d) => d.nombre))
    .toEqual(['', 'Sin nombre (copia)']);
  await ctx.close();
});
