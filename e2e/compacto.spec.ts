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

type EjercicioServidor = { id: string; nombre: string; series: string; reps: string; descanso: string };
type RutinaServidor = {
  nombre: string;
  dias: { id: string; nombre: string; ejercicios: EjercicioServidor[] }[];
};

async function rutinasEnServidor(ctx: BrowserContext): Promise<RutinaServidor[]> {
  const r = (await (await ctx.request.get('/api/estudio')).json()) as { estado: { rutinas: RutinaServidor[] } };
  return r.estado.rutinas;
}

// Series, reps y descanso del primer día de la primera rutina, ejercicio por ejercicio.
const datosEnServidor = async (ctx: BrowserContext): Promise<string[][]> =>
  ((await rutinasEnServidor(ctx))[0]?.dias[0]?.ejercicios ?? []).map((e) => [e.series, e.reps, e.descanso]);

const ordenEnServidor = async (ctx: BrowserContext): Promise<string[][]> =>
  ((await rutinasEnServidor(ctx))[0]?.dias ?? []).map((d) => d.ejercicios.map((e) => e.nombre));

async function crearRutina(page: Page, ctx: BrowserContext, nombre: string): Promise<Locator> {
  await page.goto('/rutinas');
  await page.locator('input[name=nombre]').fill(nombre);
  await page.getByRole('button', { name: 'Crear rutina' }).click();
  const editor = page.locator('app-editor-rutina');
  await expect(editor).toBeVisible();
  await expect.poll(async () => (await rutinasEnServidor(ctx)).some((r) => r.nombre === nombre)).toBe(true);
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

// Agrega ejercicios al día indicado eligiéndolos por nombre, en orden.
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

const cabeceraDe = (ejercicio: Locator): Locator => ejercicio.locator('button[aria-expanded]');
const resumenDe = (ejercicio: Locator): Locator => ejercicio.locator('.ejercicio-datos');
const campo = (ejercicio: Locator, nombre: string): Locator => ejercicio.getByLabel(nombre, { exact: true });

async function medida(elemento: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const caja = await elemento.boundingBox();
  if (!caja) throw new Error('El elemento no tiene caja visible');
  return caja;
}

test('en 360 px cada ejercicio plegado mide 110 px o menos y muestra su nombre y su resumen', async ({ browser }) => {
  const ctx = await dispositivo(browser, { width: 360, height: 740 });
  const page = await ctx.newPage();
  await registrar(page, correo('cmp1'));
  const editor = await crearRutina(page, ctx, 'Rutina compacta');
  const nombres = ['Press banca', 'Remo con barra', 'Peso muerto', 'Dominadas'];
  await ponerEjercicios(editor, nombres);

  const ejercicios = editor.locator('.dia-rutina').first().locator('.ejercicio');
  // Pliega el que quedó abierto al agregar el último.
  await cabeceraDe(ejercicios.nth(3)).click();
  await expect(cabeceraDe(ejercicios.nth(3))).toHaveAttribute('aria-expanded', 'false');

  for (let i = 0; i < nombres.length; i++) {
    const fila = ejercicios.nth(i);
    await expect(fila.locator('.ejercicio-nombre')).toHaveText(nombres[i]);
    await expect(resumenDe(fila)).toHaveText('3 × 10 · 60s');
    await expect(cabeceraDe(fila)).toHaveAccessibleName(`${nombres[i]} 3 × 10 · 60s`);
    const caja = await medida(fila);
    expect(caja.height, `alto de la fila ${nombres[i]}`).toBeLessThanOrEqual(110);
  }
  await ctx.close();
});

test('dieciocho ejercicios plegados en 390×844 ocupan tres pantallas de alto o menos', async ({ browser }) => {
  const ctx = await dispositivo(browser, { width: 390, height: 844 });
  const page = await ctx.newPage();
  await registrar(page, correo('cmp2'));
  const editor = await crearRutina(page, ctx, 'Rutina larga');
  const nombres = Array.from({ length: 18 }, (_, i) => `Movimiento compacto ${i + 1}`);
  await ponerEjercicios(editor, nombres);
  await expect.poll(async () => (await ordenEnServidor(ctx))[0]?.length).toBe(18);

  const ejercicios = editor.locator('.dia-rutina').first().locator('.ejercicio');
  await cabeceraDe(ejercicios.nth(17)).click();
  await expect(editor.locator('button[aria-expanded=true]')).toHaveCount(0);

  const primera = await medida(ejercicios.first());
  const ultima = await medida(ejercicios.last());
  const alturaLista = ultima.y + ultima.height - primera.y;
  expect(alturaLista / 844, `la lista mide ${Math.round(alturaLista)} px`).toBeLessThanOrEqual(3);
  await ctx.close();
});

test('un ejercicio nuevo queda abierto con el foco en su nombre y al abrir otro se pliega el anterior', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('cmp3'));
  const editor = await crearRutina(page, ctx, 'Rutina de una fila abierta');
  const ejercicios = editor.locator('.dia-rutina').first().locator('.ejercicio');
  const abiertas = editor.locator('.ejercicio button[aria-expanded=true]');

  await ponerEjercicios(editor, ['Press banca']);
  await expect(cabeceraDe(ejercicios.nth(0))).toHaveAttribute('aria-expanded', 'true');
  await expect(campo(ejercicios.nth(0), 'Ejercicio')).toBeFocused();

  await agregarEjercicio(editor, 'Remo con barra');
  await expect(ejercicios).toHaveCount(2);
  await expect(cabeceraDe(ejercicios.nth(0))).toHaveAttribute('aria-expanded', 'false');
  await expect(cabeceraDe(ejercicios.nth(1))).toHaveAttribute('aria-expanded', 'true');
  await expect(campo(ejercicios.nth(1), 'Ejercicio')).toBeFocused();
  await expect(abiertas).toHaveCount(1);

  // Tocar otra fila pliega la abierta y tocar la abierta la pliega.
  await cabeceraDe(ejercicios.nth(0)).click();
  await expect(cabeceraDe(ejercicios.nth(0))).toHaveAttribute('aria-expanded', 'true');
  await expect(cabeceraDe(ejercicios.nth(1))).toHaveAttribute('aria-expanded', 'false');
  await expect(abiertas).toHaveCount(1);
  await cabeceraDe(ejercicios.nth(0)).click();
  await expect(abiertas).toHaveCount(0);
  await ctx.close();
});

test('Series abre el teclado numérico y Reps y Descanso aceptan texto como 8-12, AMRAP y 45s', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('cmp4'));
  const editor = await crearRutina(page, ctx, 'Rutina con texto libre');
  await ponerEjercicios(editor, ['Press banca', 'Remo con barra']);

  const ejercicios = editor.locator('.dia-rutina').first().locator('.ejercicio');
  const primero = await abrirEjercicio(ejercicios.nth(0));
  await expect(campo(primero, 'Series')).toHaveAttribute('inputmode', 'numeric');
  await expect(campo(primero, 'Reps')).not.toHaveAttribute('inputmode', 'numeric');
  await expect(campo(primero, 'Descanso')).not.toHaveAttribute('inputmode', 'numeric');

  await campo(primero, 'Reps').fill('8-12');
  await campo(primero, 'Descanso').fill('45s');
  await campo(primero, 'Descanso').blur();
  await expect(campo(primero, 'Reps')).toHaveValue('8-12');
  await expect(campo(primero, 'Descanso')).toHaveValue('45s');
  await expect(resumenDe(primero)).toHaveText('3 × 8-12 · 45s');

  const segundo = await abrirEjercicio(ejercicios.nth(1));
  await campo(segundo, 'Reps').fill('AMRAP');
  await campo(segundo, 'Reps').blur();
  await expect(resumenDe(segundo)).toHaveText('3 × AMRAP · 60s');

  await expect.poll(() => datosEnServidor(ctx)).toEqual([
    ['3', '8-12', '45s'],
    ['3', 'AMRAP', '60s'],
  ]);
  await ctx.close();
});

test('los atajos de reps y descanso escriben el texto en el campo, actualizan el resumen y se guardan', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('cmp5'));
  const editor = await crearRutina(page, ctx, 'Rutina con atajos');
  await ponerEjercicios(editor, ['Press banca']);

  const ejercicio = await abrirEjercicio(editor.locator('.dia-rutina').first().locator('.ejercicio').first());
  const atajos = ejercicio.getByRole('group', { name: 'Atajos de Press banca' });
  await expect(atajos.getByRole('button')).toHaveCount(4);
  for (const nombre of ['Reps 8-12', 'Reps AMRAP', 'Descanso 60s', 'Descanso 90s']) {
    const caja = await medida(atajos.getByRole('button', { name: `${nombre} en Press banca` }));
    expect(caja.height, `alto del atajo ${nombre}`).toBeGreaterThanOrEqual(44);
  }

  await ejercicio.getByRole('button', { name: 'Reps 8-12 en Press banca' }).click();
  await expect(campo(ejercicio, 'Reps')).toHaveValue('8-12');
  await expect(resumenDe(ejercicio)).toHaveText('3 × 8-12 · 60s');
  await expect.poll(() => datosEnServidor(ctx)).toEqual([['3', '8-12', '60s']]);

  await ejercicio.getByRole('button', { name: 'Descanso 90s en Press banca' }).click();
  await expect(campo(ejercicio, 'Descanso')).toHaveValue('90s');
  await expect(resumenDe(ejercicio)).toHaveText('3 × 8-12 · 90s');
  await expect.poll(() => datosEnServidor(ctx)).toEqual([['3', '8-12', '90s']]);

  await ejercicio.getByRole('button', { name: 'Reps AMRAP en Press banca' }).click();
  await expect(campo(ejercicio, 'Reps')).toHaveValue('AMRAP');
  await expect(resumenDe(ejercicio)).toHaveText('3 × AMRAP · 90s');

  await ejercicio.getByRole('button', { name: 'Descanso 60s en Press banca' }).click();
  await expect(campo(ejercicio, 'Descanso')).toHaveValue('60s');
  await expect(resumenDe(ejercicio)).toHaveText('3 × AMRAP · 60s');
  await expect.poll(() => datosEnServidor(ctx)).toEqual([['3', 'AMRAP', '60s']]);
  await ctx.close();
});

test('el botón de cada cabecera anuncia si está abierto y mide 44 px de alto o más, igual que Subir y Bajar', async ({ browser }) => {
  const ctx = await dispositivo(browser, { width: 360, height: 740 });
  const page = await ctx.newPage();
  await registrar(page, correo('cmp6'));
  const editor = await crearRutina(page, ctx, 'Rutina con botones');
  await ponerEjercicios(editor, ['Press banca', 'Remo con barra', 'Peso muerto']);

  const ejercicios = editor.locator('.dia-rutina').first().locator('.ejercicio');
  for (let i = 0; i < 3; i++) {
    const fila = ejercicios.nth(i);
    const cabecera = cabeceraDe(fila);
    await expect(cabecera).toHaveAttribute('aria-expanded', /^(true|false)$/);
    await expect(cabecera).toHaveAttribute('aria-controls', /^cuerpo-.+/);
    expect((await medida(cabecera)).height, `alto de la cabecera ${i + 1}`).toBeGreaterThanOrEqual(44);
    for (const orden of ['subir', 'bajar']) {
      const caja = await medida(fila.locator(`[data-orden=${orden}]`));
      expect(caja.width, `ancho de ${orden} ${i + 1}`).toBeGreaterThanOrEqual(44);
      expect(caja.height, `alto de ${orden} ${i + 1}`).toBeGreaterThanOrEqual(44);
    }
  }

  // El estado se anuncia al abrir y al plegar, y la cabecera enlaza con su cuerpo.
  const cabecera = cabeceraDe(ejercicios.nth(0));
  await cabecera.click();
  await expect(cabecera).toHaveAttribute('aria-expanded', 'true');
  const idCuerpo = await cabecera.getAttribute('aria-controls');
  await expect(page.locator(`[id="${idCuerpo}"]`).getByLabel('Ejercicio', { exact: true })).toBeVisible();
  await cabecera.click();
  await expect(cabecera).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator(`[id="${idCuerpo}"]`).getByLabel('Ejercicio', { exact: true })).toHaveCount(0);
  await ctx.close();
});

test('duplicar un ejercicio deja la copia abierta y enfocada y plegado el original', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('cmp7'));
  const editor = await crearRutina(page, ctx, 'Rutina para duplicar abierta');
  await ponerEjercicios(editor, ['Press banca', 'Remo con barra']);

  const ejercicios = editor.locator('.dia-rutina').first().locator('.ejercicio');
  const original = await abrirEjercicio(ejercicios.nth(0));
  await original.getByRole('button', { name: 'Duplicar Press banca' }).click();

  await expect(ejercicios).toHaveCount(3);
  await expect(cabeceraDe(ejercicios.nth(1))).toHaveAttribute('aria-expanded', 'true');
  await expect(campo(ejercicios.nth(1), 'Ejercicio')).toBeFocused();
  await expect(campo(ejercicios.nth(1), 'Ejercicio')).toHaveValue('Press banca');
  await expect(cabeceraDe(ejercicios.nth(0))).toHaveAttribute('aria-expanded', 'false');
  await expect(editor.locator('.ejercicio button[aria-expanded=true]')).toHaveCount(1);
  await ctx.close();
});

test('mover un ejercicio a otro día lo deja abierto con el foco en su selector', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('cmp8'));
  const editor = await crearRutina(page, ctx, 'Rutina para mover abierta');
  await nombrarDia(editor, 0, 'Lunes');
  await ponerEjercicios(editor, ['Press banca', 'Remo con barra'], 0);
  await editor.getByRole('button', { name: 'Agregar día' }).click();
  await expect(editor.locator('.dia-rutina')).toHaveCount(2);
  await nombrarDia(editor, 1, 'Martes');
  await ponerEjercicios(editor, ['Dominadas'], 1);
  await expect.poll(() => ordenEnServidor(ctx)).toEqual([['Press banca', 'Remo con barra'], ['Dominadas']]);

  const lunes = editor.locator('.dia-rutina').nth(0);
  const martes = editor.locator('.dia-rutina').nth(1);
  const ejercicio = await abrirEjercicio(lunes.locator('.ejercicio').nth(0));
  await ejercicio.locator('select[data-orden=dia]').selectOption({ label: 'Martes' });
  await ejercicio.locator('[data-orden=mover]').click();

  await expect(lunes.locator('.ejercicio')).toHaveCount(1);
  await expect(martes.locator('.ejercicio')).toHaveCount(2);
  const movido = martes.locator('.ejercicio').nth(1);
  await expect(campo(movido, 'Ejercicio')).toHaveValue('Press banca');
  await expect(cabeceraDe(movido)).toHaveAttribute('aria-expanded', 'true');
  await expect(movido.locator('select[data-orden=dia]')).toBeFocused();
  await expect(editor.locator('.ejercicio button[aria-expanded=true]')).toHaveCount(1);
  await expect.poll(() => ordenEnServidor(ctx)).toEqual([['Remo con barra'], ['Dominadas', 'Press banca']]);
  await ctx.close();
});

test('Subir y Bajar con el teclado abren el ejercicio movido y dejan el foco en el mismo botón', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('cmp9'));
  const editor = await crearRutina(page, ctx, 'Rutina con teclado');
  await ponerEjercicios(editor, ['Prensa', 'Extensiones', 'Curl femoral']);
  await expect.poll(() => ordenEnServidor(ctx)).toEqual([['Prensa', 'Extensiones', 'Curl femoral']]);

  const ejercicios = editor.locator('.dia-rutina').first().locator('.ejercicio');
  const subir = (i: number) => ejercicios.nth(i).locator('[data-orden=subir]');
  const bajar = (i: number) => ejercicios.nth(i).locator('[data-orden=bajar]');

  await bajar(0).focus();
  await bajar(0).press('Enter');
  await expect(cabeceraDe(ejercicios.nth(1))).toHaveAttribute('aria-expanded', 'true');
  await expect(cabeceraDe(ejercicios.nth(1)).locator('.ejercicio-nombre')).toHaveText('Prensa');
  await expect(bajar(1)).toBeFocused();
  await expect(editor.locator('.ejercicio button[aria-expanded=true]')).toHaveCount(1);
  await expect.poll(() => ordenEnServidor(ctx)).toEqual([['Extensiones', 'Prensa', 'Curl femoral']]);

  await subir(2).focus();
  await subir(2).press('Space');
  await expect(cabeceraDe(ejercicios.nth(1))).toHaveAttribute('aria-expanded', 'true');
  await expect(cabeceraDe(ejercicios.nth(1)).locator('.ejercicio-nombre')).toHaveText('Curl femoral');
  await expect(subir(1)).toBeFocused();
  await expect(editor.locator('.ejercicio button[aria-expanded=true]')).toHaveCount(1);
  await expect.poll(() => ordenEnServidor(ctx)).toEqual([['Extensiones', 'Curl femoral', 'Prensa']]);
  await ctx.close();
});

test('un ejercicio sin series, reps ni descanso no muestra undefined en su resumen', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('cmp10'));
  const editor = await crearRutina(page, ctx, 'Rutina sin datos');
  await ponerEjercicios(editor, ['Plancha']);

  const ejercicio = await abrirEjercicio(editor.locator('.dia-rutina').first().locator('.ejercicio').first());
  for (const nombre of ['Series', 'Reps', 'Descanso']) {
    await campo(ejercicio, nombre).fill('');
    await campo(ejercicio, nombre).blur();
  }

  await expect.poll(() => datosEnServidor(ctx)).toEqual([['', '', '']]);
  const cabecera = cabeceraDe(ejercicio);
  await expect(resumenDe(ejercicio)).not.toHaveText(/undefined|null|NaN/);
  await expect(resumenDe(ejercicio)).toHaveText('Sin datos');
  await expect(cabecera).not.toHaveAccessibleName(/undefined|null|NaN/);
  await expect(cabecera).toHaveAccessibleName('Plancha Sin datos');
  await ctx.close();
});
