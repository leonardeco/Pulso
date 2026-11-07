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
  // Tras registrarse la app carga el estudio; actuar antes de que llegue haría que esa carga pise lo recién creado.
  const cargado = page.waitForResponse((r) => r.url().includes('/api/estudio') && r.request().method() === 'GET');
  await crear.click();
  await cargado;
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
  const scrollAntes = await page.evaluate(() => window.scrollY);
  await nuevaRutina(page).click();

  await expect(page.locator('app-editor-rutina')).toHaveCount(2);
  await expect.poll(async () => (await rutinasEnServidor(ctx)).map((r) => r.nombre)).toEqual(['Rutina previa', 'Rutina nueva']);
  const nueva = (await rutinasEnServidor(ctx)).find((r) => r.nombre === 'Rutina nueva');
  const campoNombre = nombreDe(page, nueva?.id ?? 'sin-id');
  await expect(campoNombre).toHaveValue('Rutina nueva');
  await expect(campoNombre).toBeFocused();
  // El desplazamiento es suave: se espera a que la página llegue hasta la rutina nueva.
  await expect
    .poll(() => page.evaluate(() => window.scrollY), { message: 'la página debe desplazarse hasta la rutina nueva' })
    .not.toBe(scrollAntes);
  await expect(campoNombre).toBeInViewport({ ratio: 1 });
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

test('el botón de Nueva rutina vacío se desmonta al pulsarlo y el campo Nombre de la rutina de la rutina nueva recibe el foco', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('arr8'));
  await crearCliente(page, 'Cliente Para El Foco');
  await page.getByRole('button', { name: 'Rutina', exact: true }).click();
  const vacio = page.locator('.estado-vacio');
  await expect(vacio).toBeVisible();

  await vacio.getByRole('button', { name: 'Nueva rutina', exact: true }).click();

  await expect(vacio).toHaveCount(0);
  await expect.poll(async () => (await rutinasEnServidor(ctx)).length).toBe(1);
  const nueva = (await rutinasEnServidor(ctx))[0];
  const campoNombre = nombreDe(page, nueva?.id ?? 'sin-id');
  await expect(campoNombre).toHaveValue('Rutina nueva');
  await expect(campoNombre).toBeFocused();
  await ctx.close();
});

test('un doble clic en Nueva rutina crea una sola rutina más y con el teclado también se crea una', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('arr9'));
  await crearCliente(page, 'Cliente Del Doble Clic');
  const clienteId = idDeCliente(page);
  await crearRutina(page, ctx, 'Rutina previa', 'Cliente Del Doble Clic');
  await abrirFichaRutina(page, 'Cliente Del Doble Clic');
  await expect(page.locator('app-editor-rutina')).toHaveCount(1);
  const delCliente = async (): Promise<string[]> =>
    (await rutinasEnServidor(ctx)).filter((r) => r.clienteId === clienteId).map((r) => r.nombre);

  await nuevaRutina(page).dblclick();

  await expect.poll(delCliente).toEqual(['Rutina previa', 'Rutina nueva']);
  await expect(page.locator('app-editor-rutina')).toHaveCount(2);
  // Si el segundo clic llegara a crear otra, aparecería poco después de la primera.
  await page.waitForTimeout(1000);
  expect(await delCliente()).toEqual(['Rutina previa', 'Rutina nueva']);
  await expect(page.locator('app-editor-rutina')).toHaveCount(2);

  // Con el teclado no hay segundo clic: Enter sobre el botón crea una rutina.
  await nuevaRutina(page).focus();
  await nuevaRutina(page).press('Enter');

  await expect.poll(delCliente).toEqual(['Rutina previa', 'Rutina nueva', 'Rutina nueva']);
  await expect(page.locator('app-editor-rutina')).toHaveCount(3);
  await ctx.close();
});

type MedidaBoton = { fondo: string; texto: string; degradado: string; contraste: number };

// Lee el botón y calcula el contraste entre su texto y su fondo efectivo (mezcla los fondos translúcidos con los de sus ancestros).
async function medirBoton(boton: Locator): Promise<MedidaBoton> {
  return boton.evaluate((el) => {
    type Color = [number, number, number, number];
    const leer = (valor: string): Color => {
      const numeros = (valor.match(/-?\d*\.?\d+(?:e-?\d+)?%?/g) ?? []).map((n) =>
        n.endsWith('%') ? parseFloat(n) / 100 : parseFloat(n),
      );
      if (valor.startsWith('color(')) {
        const [r = 0, g = 0, b = 0, a = 1] = numeros;
        return [r * 255, g * 255, b * 255, a];
      }
      const [r = 0, g = 0, b = 0, a = 1] = numeros;
      return [r, g, b, a];
    };
    const sobre = (frente: Color, atras: Color): Color => {
      const alfa = frente[3] + atras[3] * (1 - frente[3]);
      if (alfa === 0) return [0, 0, 0, 0];
      const canal = (i: 0 | 1 | 2): number => (frente[i] * frente[3] + atras[i] * atras[3] * (1 - frente[3])) / alfa;
      return [canal(0), canal(1), canal(2), alfa];
    };
    const lineal = (c: number): number => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    const luz = (c: Color): number => 0.2126 * lineal(c[0]) + 0.7152 * lineal(c[1]) + 0.0722 * lineal(c[2]);

    let fondo: Color = [0, 0, 0, 0];
    for (let nodo: Element | null = el; nodo; nodo = nodo.parentElement) {
      fondo = sobre(fondo, leer(getComputedStyle(nodo).backgroundColor));
      if (fondo[3] >= 1) break;
    }
    fondo = sobre(fondo, [255, 255, 255, 1]);
    const estilo = getComputedStyle(el);
    const texto = sobre(leer(estilo.color), fondo);
    const claro = Math.max(luz(fondo), luz(texto));
    const oscuro = Math.min(luz(fondo), luz(texto));
    return {
      fondo: estilo.backgroundColor,
      texto: estilo.color,
      degradado: estilo.backgroundImage,
      contraste: (claro + 0.05) / (oscuro + 0.05),
    };
  });
}

test('el botón Nueva rutina del estado vacío no lleva degradado y su texto contrasta al menos 4.5 en el tema oscuro y en el claro', async ({ browser }) => {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo('arr10'));
  await crearCliente(page, 'Cliente Del Contraste');
  await page.getByRole('button', { name: 'Rutina', exact: true }).click();
  const boton = page.locator('.estado-vacio').getByRole('button', { name: 'Nueva rutina', exact: true });
  await expect(boton).toBeVisible();

  for (const tema of ['oscuro', 'claro']) {
    await page.evaluate((valor) => document.documentElement.setAttribute('data-tema', valor), tema);
    await expect(page.locator('html')).toHaveAttribute('data-tema', tema);
    const medida = await medirBoton(boton);
    expect(medida.degradado, `fondo en tema ${tema}`).toBe('none');
    expect(medida.contraste, `contraste en tema ${tema}: texto ${medida.texto} sobre ${medida.fondo}`).toBeGreaterThanOrEqual(4.5);
  }
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

// Cuenta cada clic, escritura o elección que hace falta desde un cliente recién registrado hasta tener la rutina creada con él.
async function contarInteracciones(browser: Browser, camino: 'ficha' | 'rutinas'): Promise<number> {
  const ctx = await dispositivo(browser);
  const page = await ctx.newPage();
  await registrar(page, correo(`arr-${camino}`));

  let interacciones = 0;
  const clic = async (destino: Locator): Promise<void> => {
    interacciones += 1;
    await destino.click();
  };
  const escribir = async (destino: Locator, valor: string): Promise<void> => {
    interacciones += 1;
    await destino.fill(valor);
  };
  const elegir = async (destino: Locator, etiqueta: string): Promise<void> => {
    interacciones += 1;
    await destino.selectOption({ label: etiqueta });
  };

  await clic(page.getByRole('link', { name: 'Clientes', exact: true }));
  await clic(page.getByRole('button', { name: 'Nuevo' }));
  await escribir(page.locator('input[name=nombre]'), 'Cliente Contado');
  await escribir(page.locator('input[name=telefono]'), `300${Date.now().toString().slice(-7)}`);
  await clic(page.getByRole('button', { name: 'Guardar cliente' }));
  await expect(page).toHaveURL(/\/clientes\/[^/]+$/);
  const clienteId = idDeCliente(page);

  if (camino === 'ficha') {
    await clic(page.getByRole('button', { name: 'Rutina', exact: true }));
    await clic(nuevaRutina(page));
  } else {
    await clic(page.locator('nav.nav').getByRole('link', { name: 'Rutina', exact: true }));
    await elegir(page.locator('select[name=cliente]'), 'Cliente Contado');
    await clic(page.getByRole('button', { name: 'Crear rutina' }));
  }

  await expect(page.locator('app-editor-rutina')).toHaveCount(1);
  await expect
    .poll(async () => (await rutinasEnServidor(ctx)).map((r) => r.clienteId))
    .toEqual([clienteId]);
  await ctx.close();
  return interacciones;
}

test('crear la rutina de un cliente nuevo desde su ficha cuesta menos interacciones medidas que hacerlo por rutinas', async ({ browser }, info) => {
  const porRutinas = await contarInteracciones(browser, 'rutinas');
  const porFicha = await contarInteracciones(browser, 'ficha');

  console.log(`Interacciones medidas: por la ficha ${porFicha}, por rutinas ${porRutinas}`);
  info.annotations.push({ type: 'interacciones por la ficha', description: String(porFicha) });
  info.annotations.push({ type: 'interacciones por rutinas', description: String(porRutinas) });
  expect(porFicha, `por la ficha ${porFicha}, por rutinas ${porRutinas}`).toBeLessThan(porRutinas);
});
