import { createHash, randomUUID } from 'node:crypto';
import { expect, test, type Browser, type Locator, type BrowserContext, type Page, type Request } from '@playwright/test';

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
  return browser.newContext({
    baseURL: BASE,
    viewport: { width: 390, height: 844 },
  }).then(async (ctx) => {
    await ctx.route('**/api/**', (ruta) =>
      ruta.continue({ headers: { ...ruta.request().headers(), 'x-forwarded-for': ip } }),
    );
    return ctx;
  });
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

async function sesionDe(ctx: BrowserContext): Promise<string> {
  const r = (await (await ctx.request.get('/api/sesion')).json()) as { sesion: { entrenadorId: string } };
  return r.sesion.entrenadorId;
}

const esPut = (r: { url(): string; request(): Request }) =>
  r.url().endsWith('/api/estudio') && r.request().method() === 'PUT';

async function crearCliente(page: Page, nombre: string): Promise<void> {
  await page.goto('/clientes');
  await page.getByRole('button', { name: 'Nuevo' }).click();
  await page.locator('input[name=nombre]').fill(nombre);
  await page.locator('input[name=telefono]').fill(`300${Date.now().toString().slice(-7)}`);
  const guardado = page.waitForResponse((r) => esPut(r) && r.status() === 200);
  await page.getByRole('button', { name: 'Guardar cliente' }).click();
  await guardado;
}

async function abrirFicha(page: Page, nombre: string): Promise<void> {
  await page.goto('/clientes');
  await page.getByRole('link', { name: new RegExp(nombre) }).click();
  await expect(page.getByRole('heading', { name: nombre })).toBeVisible();
}

async function editarObjetivo(page: Page, texto: string): Promise<void> {
  const campo = page.getByLabel('Objetivo', { exact: true });
  await campo.fill(texto);
  await campo.blur();
}

function sembrarLocal(mail: string, clave: string, claveCliente: string, mailCliente: string) {
  const sal = 'sal-local';
  const hash = (c: string, s: string) => createHash('sha256').update(`${s}:${c}`).digest('hex');
  const id = 'local-1';
  const idLegado = `cli-${randomUUID()}`;
  const idDos = `cli-${randomUUID()}`;
  const cuentas = [{ id, nombre: 'Entrenadora Local', correo: mail, sal, hash: hash(clave, sal) }];
  const base = { telefono: '', notas: '', peso: '', estatura: '', mensualidad: 0, valoracionMensual: 0, modalidad: 'personalizado' };
  const estado = {
    servicios: [{ id: 's1', nombre: 'Sesión', minutos: 60, precio: 0 }],
    horario: { '1': [], '2': [], '3': [], '4': [], '5': [], '6': [], '0': [] },
    clientes: [
      { ...base, id: idLegado, nombre: 'Cliente Legado', correo: mailCliente, objetivo: 'Fuerza' },
      { ...base, id: idDos, nombre: 'Segundo Local', correo: '', objetivo: '' },
    ],
    citas: [],
    rutinas: [],
    tablas: [],
    pagos: [],
    accesos: [{ clienteId: idLegado, correo: mailCliente, sal: 'sal-cli', hash: hash(claveCliente, 'sal-cli') }],
  };
  return { id, cuentas: JSON.stringify(cuentas), estado: JSON.stringify(estado) };
}

test('TC-5.1 registro en A y entrada desde B con el mismo estudio', async ({ browser }) => {
  const mail = correo('t51');
  const a = await dispositivo(browser);
  const b = await dispositivo(browser);
  const pa = await a.newPage();
  await registrar(pa, mail);
  await crearCliente(pa, 'Cliente Uno');

  const pb = await b.newPage();
  await entrar(pb, mail);
  await pb.goto('/clientes');
  await expect(pb.getByText('Cliente Uno')).toBeVisible();
  await a.close();
  await b.close();
});

test('TC-6.1 edición de B visible en A al volver a visible, sin PUT de vuelta', async ({ browser }) => {
  const mail = correo('t61');
  const a = await dispositivo(browser);
  const b = await dispositivo(browser);
  const pa = await a.newPage();
  await registrar(pa, mail);
  await crearCliente(pa, 'Cliente Dos');
  await pa.goto('/clientes');
  await expect(pa.getByText('Cliente Dos')).toBeVisible();

  const pb = await b.newPage();
  await entrar(pb, mail);
  await abrirFicha(pb, 'Cliente Dos');
  const guardado = pb.waitForResponse((r) => esPut(r) && r.status() === 200);
  await editarObjetivo(pb, 'Objetivo desde B');
  await guardado;

  let puts = 0;
  pa.on('request', (r) => {
    if (r.url().endsWith('/api/estudio') && r.method() === 'PUT') puts += 1;
  });
  await pa.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(pa.getByText('Objetivo desde B')).toBeVisible();
  await pa.waitForTimeout(1500);
  expect(puts).toBe(0);
  await a.close();
  await b.close();
});

test('TC-2.1 dos dispositivos editan sobre la misma versión: franja de conflicto', async ({ browser }) => {
  const mail = correo('t21');
  const a = await dispositivo(browser);
  const b = await dispositivo(browser);
  const pa = await a.newPage();
  await registrar(pa, mail);
  await crearCliente(pa, 'Cliente Tres');
  await abrirFicha(pa, 'Cliente Tres');

  const pb = await b.newPage();
  await entrar(pb, mail);
  await abrirFicha(pb, 'Cliente Tres');

  const guardadoA = pa.waitForResponse((r) => esPut(r) && r.status() === 200);
  await editarObjetivo(pa, 'Cambio de A');
  await guardadoA;

  const rechazo = pb.waitForResponse((r) => esPut(r) && r.status() === 409);
  await editarObjetivo(pb, 'Cambio de B');
  await rechazo;
  const franja = pb.getByText('Este estudio cambió en otro dispositivo');
  await expect(franja).toBeVisible();
  await expect(pb.getByLabel('Objetivo', { exact: true })).toHaveValue('Cambio de A');
  await pb.getByRole('button', { name: 'Entendido' }).click();
  await expect(franja).toBeHidden();
  await a.close();
  await b.close();
});

test('TC-1.1 TC-1.3 cliente con acceso entra en otro dispositivo y solo ve su plan', async ({ browser }) => {
  const mail = correo('t11');
  const mailCliente = correo('cli');
  const a = await dispositivo(browser);
  const c = await dispositivo(browser);
  const pa = await a.newPage();
  await registrar(pa, mail);
  await crearCliente(pa, 'Cliente Acceso');
  await abrirFicha(pa, 'Cliente Acceso');
  const nota = pa.getByLabel('Notas', { exact: true });
  const guardadoNota = pa.waitForResponse((r) => esPut(r) && r.status() === 200);
  await nota.fill('NOTA-SECRETA');
  await nota.blur();
  await guardadoNota;

  // Un pago del estudio, puesto por la API con la sesión del entrenador.
  const origen = { Origin: BASE };
  const actual = (await (await a.request.get('/api/estudio')).json()) as {
    estado: { clientes: { id: string }[]; pagos: unknown[] };
    version: number;
  };
  const entrenadorId = ((await (await a.request.get('/api/sesion')).json()) as { sesion: { entrenadorId: string } }).sesion.entrenadorId;
  const clienteId = actual.estado.clientes[0].id;
  const pago = { id: 'p1', clienteId, tipo: 'otro', periodo: '', concepto: 'PAGO-SECRETO', valor: 99, fecha: '2026-11-01', estado: 'pagado' };
  const put = await a.request.put('/api/estudio', {
    headers: origen,
    data: { entrenadorId, version: actual.version, estado: { ...actual.estado, accesos: [], pagos: [pago] } },
  });
  expect(put.status()).toBe(200);

  await abrirFicha(pa, 'Cliente Acceso');
  await pa.locator('input[name=accesoCorreo]').fill(mailCliente);
  const crearAcceso = pa.getByRole('button', { name: 'Crear acceso' });
  await escribirClave(pa.locator('input[name=accesoClave]'), CLAVE, pa.locator('input[name=accesoConfirma]'));
  await escribirClave(pa.locator('input[name=accesoConfirma]'), CLAVE, crearAcceso);
  await crearAcceso.click();
  await expect(pa.getByText('Listo. Con ese correo entra')).toBeVisible();

  const pc = await c.newPage();
  await entrar(pc, mailCliente);
  await expect(pc).toHaveURL(/\/mi-plan$/);
  await expect(pc.getByRole('heading', { name: 'Cliente Acceso' })).toBeVisible();
  await expect(pc.locator('nav.nav')).toHaveCount(0);

  const res = await c.request.get('/api/estudio');
  expect(res.status()).toBe(200);
  const texto = await res.text();
  expect(texto).not.toContain('NOTA-SECRETA');
  expect(texto).not.toContain('PAGO-SECRETO');
  const cuerpo = JSON.parse(texto) as {
    estado: { pagos: unknown[]; accesos: unknown[]; clientes: { notas: string }[] };
  };
  expect(cuerpo.estado.pagos).toEqual([]);
  expect(cuerpo.estado.accesos).toEqual([]);
  expect(cuerpo.estado.clientes).toHaveLength(1);
  expect(cuerpo.estado.clientes[0].notas).toBe('');

  const escribir = await c.request.put('/api/estudio', { headers: origen, data: { version: 0, estado: cuerpo.estado } });
  expect(escribir.status()).toBe(403);
  await a.close();
  await c.close();
});

test('TC-4.1 TC-4.2 TC-4.4 datos locales suben una vez, localStorage intacto y acceso legado entra con su clave', async ({ browser }) => {
  const mail = correo('t41');
  const mailCliente = correo('leg');
  const claveCliente = 'clave-original-cliente';
  const semilla = sembrarLocal(mail, CLAVE, claveCliente, mailCliente);
  const a = await dispositivo(browser);
  await a.addInitScript((s) => {
    if (!localStorage.getItem('pulso.cuentas.v1')) {
      localStorage.setItem('pulso.cuentas.v1', s.cuentas);
      localStorage.setItem(`pulso.estado.${s.id}`, s.estado);
    }
  }, semilla);
  const pa = await a.newPage();
  const subidas: string[] = [];
  pa.on('request', (r) => {
    if (r.url().endsWith('/api/estudio') && r.method() === 'PUT') subidas.push(r.url());
  });

  const subida = pa.waitForResponse((r) => esPut(r) && r.status() === 200);
  await entrar(pa, mail);
  await subida;
  await expect(pa.getByRole('link', { name: 'Clientes', exact: true })).toBeVisible();
  expect(subidas).toHaveLength(1);

  // localStorage sigue intacto y queda marcado como subido.
  const local = await pa.evaluate(
    (id) => ({
      cuentas: localStorage.getItem('pulso.cuentas.v1'),
      estado: localStorage.getItem(`pulso.estado.${id}`),
      subido: localStorage.getItem(`pulso.subido.${id}`),
    }),
    semilla.id,
  );
  expect(local.cuentas).toBe(semilla.cuentas);
  expect(local.estado).toBe(semilla.estado);
  expect(local.subido).toBe('1');

  // Otro dispositivo ve los clientes.
  const b = await dispositivo(browser);
  const pb = await b.newPage();
  await entrar(pb, mail);
  await pb.goto('/clientes');
  await expect(pb.getByText('Cliente Legado')).toBeVisible();
  await expect(pb.getByText('Segundo Local')).toBeVisible();

  // Segunda entrada en A: no sube otra vez.
  await pa.getByRole('button', { name: 'Salir' }).click();
  await expect(pa).toHaveURL(/\/entrar$/);
  await entrar(pa, mail);
  await expect(pa.getByRole('link', { name: 'Clientes', exact: true })).toBeVisible();
  await pa.waitForTimeout(1000);
  expect(subidas).toHaveLength(1);

  // Acceso legado: el cliente entra con su clave original.
  const c = await dispositivo(browser);
  const pc = await c.newPage();
  await entrar(pc, mailCliente, claveCliente);
  await expect(pc).toHaveURL(/\/mi-plan$/);
  await expect(pc.getByRole('heading', { name: 'Cliente Legado' })).toBeVisible();
  await a.close();
  await b.close();
  await c.close();
});

test('TC-3.1 TC-3.2 carga fallida: aviso, ningún PUT y reintento', async ({ browser }) => {
  const mail = correo('t31');
  const a = await dispositivo(browser);
  const pa = await a.newPage();
  await registrar(pa, mail);
  await crearCliente(pa, 'Cliente Cuatro');

  const p = await a.newPage();
  const puts: string[] = [];
  p.on('request', (r) => {
    if (r.url().endsWith('/api/estudio') && r.method() === 'PUT') puts.push(r.url());
  });
  await p.route('**/api/estudio?*', (ruta) => ruta.abort());
  await p.goto('/');
  await expect(p.getByText('No pude traer tus datos.')).toBeVisible();
  await expect(p.getByRole('button', { name: 'Reintentar' })).toBeVisible();
  await p.waitForTimeout(1500);
  expect(puts).toHaveLength(0);

  await p.unroute('**/api/estudio?*');
  await p.getByRole('button', { name: 'Reintentar' }).click();
  await expect(p.getByText('No pude traer tus datos.')).toBeHidden();
  await p.goto('/clientes');
  await expect(p.getByText('Cliente Cuatro')).toBeVisible();
  await a.close();
});

test('F17 sesión vencida: editar lleva a entrar con el aviso', async ({ browser }) => {
  const mail = correo('f17v');
  const a = await dispositivo(browser);
  const pa = await a.newPage();
  await registrar(pa, mail);
  await crearCliente(pa, 'Cliente Vence');
  await abrirFicha(pa, 'Cliente Vence');

  await a.clearCookies();
  const rechazo = pa.waitForResponse((r) => esPut(r) && r.status() === 401);
  await editarObjetivo(pa, 'Edición sin sesión');
  await rechazo;
  await expect(pa).toHaveURL(/\/entrar$/);
  await expect(pa.getByText('Tu sesión venció. Entra de nuevo.')).toBeVisible();
  await a.close();
});

test('F12 subida local con 500: avisa, reintenta y completa', async ({ browser }) => {
  const mail = correo('f12');
  const semilla = sembrarLocal(mail, CLAVE, 'clave-original-cliente', correo('leg'));
  const a = await dispositivo(browser);
  await a.addInitScript((s) => {
    if (!localStorage.getItem('pulso.cuentas.v1')) {
      localStorage.setItem('pulso.cuentas.v1', s.cuentas);
      localStorage.setItem(`pulso.estado.${s.id}`, s.estado);
    }
  }, semilla);
  const pa = await a.newPage();
  await pa.route('**/api/estudio', (ruta) =>
    ruta.request().method() === 'PUT'
      ? ruta.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Falla simulada."}' })
      : ruta.fallback(),
  );
  await entrar(pa, mail);
  await expect(pa.getByText('No pude traer tus datos.')).toBeVisible();

  await pa.unroute('**/api/estudio');
  const subida = pa.waitForResponse((r) => esPut(r) && r.status() === 200);
  await pa.getByRole('button', { name: 'Reintentar' }).click();
  await subida;
  await expect(pa.getByText('No pude traer tus datos.')).toBeHidden();
  await pa.goto('/clientes');
  await expect(pa.getByText('Cliente Legado')).toBeVisible();
  await a.close();
});

test('F1 PUT rechazado con 413: avisa No pude guardar y deja salir', async ({ browser }) => {
  const mail = correo('f1');
  const a = await dispositivo(browser);
  const pa = await a.newPage();
  await registrar(pa, mail);
  await crearCliente(pa, 'Cliente Grande');
  await abrirFicha(pa, 'Cliente Grande');

  await pa.route('**/api/estudio', (ruta) =>
    ruta.request().method() === 'PUT'
      ? ruta.fulfill({ status: 413, contentType: 'application/json', body: '{"error":"Demasiado grande."}' })
      : ruta.fallback(),
  );
  await editarObjetivo(pa, 'Cambio que no cabe');
  await expect(pa.getByText('No pude guardar: Demasiado grande.')).toBeVisible();
  await pa.getByRole('button', { name: 'Salir' }).click();
  await expect(pa).toHaveURL(/\/entrar$/);
  await a.close();
});

test('F17 dos pestañas con cuentas distintas no pisan el estudio de la otra', async ({ browser }) => {
  const a = await dispositivo(browser);
  const b = await dispositivo(browser);
  const pa = await a.newPage();
  await registrar(pa, correo('f17a'));
  await crearCliente(pa, 'Cliente De A');
  await abrirFicha(pa, 'Cliente De A');

  const pb = await b.newPage();
  await registrar(pb, correo('f17b'));
  await crearCliente(pb, 'Cliente De B');

  // La pestaña de A queda con la cookie de B, como si otra pestaña hubiera entrado con la cuenta B.
  await a.addCookies(await b.cookies());
  expect(await sesionDe(a)).toBe(await sesionDe(b));
  const antes = (await (await b.request.get('/api/estudio')).json()) as { version: number };

  const rechazo = pa.waitForResponse((r) => esPut(r) && r.status() === 401);
  await editarObjetivo(pa, 'No debe llegar a B');
  await rechazo;
  await expect(pa.getByText('Tu sesión venció. Entra de nuevo.')).toBeVisible();

  const despues = await (await b.request.get('/api/estudio')).text();
  expect(JSON.parse(despues).version).toBe(antes.version);
  expect(despues).toContain('Cliente De B');
  expect(despues).not.toContain('Cliente De A');
  expect(despues).not.toContain('No debe llegar a B');
  await a.close();
  await b.close();
});

test('R1 dar acceso tras un guardado de otro dispositivo no pisa sus clientes', async ({ browser }) => {
  const mail = correo('r1');
  const a = await dispositivo(browser);
  const b = await dispositivo(browser);
  const pa = await a.newPage();
  await registrar(pa, mail);
  await crearCliente(pa, 'Cliente De A');

  const pb = await b.newPage();
  await entrar(pb, mail);
  await crearCliente(pb, 'Cliente De B');

  // A sigue en la ficha que se abrió al crear el cliente, sin recargar: su versión local ya quedó vieja.
  await expect(pa.getByRole('heading', { name: 'Cliente De A' })).toBeVisible();
  await pa.locator('input[name=accesoCorreo]').fill(correo('cli'));
  const crearAcceso = pa.getByRole('button', { name: 'Crear acceso' });
  await escribirClave(pa.locator('input[name=accesoClave]'), CLAVE, pa.locator('input[name=accesoConfirma]'));
  await escribirClave(pa.locator('input[name=accesoConfirma]'), CLAVE, crearAcceso);
  await crearAcceso.click();
  await expect(pa.getByText('Listo. Con ese correo entra')).toBeVisible();

  const guardado = pa.waitForResponse((r) => esPut(r) && r.status() === 200);
  await editarObjetivo(pa, 'Edición de A tras el acceso');
  await guardado;

  const servidor = await (await b.request.get('/api/estudio')).text();
  expect(servidor).toContain('Cliente De B');
  expect(servidor).toContain('Cliente De A');
  expect(servidor).toContain('Edición de A tras el acceso');
  await a.close();
  await b.close();
});

test('R2 subida pendiente tras recargar: avisa y Entrar de nuevo sube los datos', async ({ browser }) => {
  const mail = correo('r2');
  const semilla = sembrarLocal(mail, CLAVE, 'clave-original-cliente', correo('leg'));
  const a = await dispositivo(browser);
  await a.addInitScript((s) => {
    if (!localStorage.getItem('pulso.cuentas.v1')) {
      localStorage.setItem('pulso.cuentas.v1', s.cuentas);
      localStorage.setItem(`pulso.estado.${s.id}`, s.estado);
    }
  }, semilla);
  const pa = await a.newPage();
  await pa.route('**/api/estudio', (ruta) =>
    ruta.request().method() === 'PUT'
      ? ruta.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Falla simulada."}' })
      : ruta.fallback(),
  );
  await entrar(pa, mail);
  await expect(pa.getByText('No pude traer tus datos.')).toBeVisible();

  await pa.unroute('**/api/estudio');
  await pa.reload();
  await expect(pa.getByText('Hay datos en este navegador sin subir.')).toBeVisible();
  await expect(pa.locator('nav.nav')).toHaveCount(1);

  await pa.getByRole('button', { name: 'Entrar de nuevo' }).click();
  await expect(pa).toHaveURL(/\/entrar$/);
  const subida = pa.waitForResponse((r) => esPut(r) && r.status() === 200);
  await entrar(pa, mail);
  await subida;
  await expect(pa.getByText('Hay datos en este navegador sin subir.')).toBeHidden();
  await pa.goto('/clientes');
  await expect(pa.getByText('Cliente Legado')).toBeVisible();
  await a.close();
});

test('R3 un 200 sin versión se reintenta y el 409 de firma igual lo confirma sin conflicto', async ({ browser }) => {
  const mail = correo('r3');
  const a = await dispositivo(browser);
  const pa = await a.newPage();
  await registrar(pa, mail);
  await crearCliente(pa, 'Cliente Cortado');
  await abrirFicha(pa, 'Cliente Cortado');

  const estados: number[] = [];
  pa.on('response', (r) => {
    if (esPut(r)) estados.push(r.status());
  });
  let cortado = false;
  await pa.route('**/api/estudio', async (ruta) => {
    if (ruta.request().method() !== 'PUT' || cortado) return ruta.fallback();
    cortado = true;
    await ruta.fetch(); // el servidor sí guarda; al cliente le llega el cuerpo cortado
    await ruta.fulfill({ status: 200, contentType: 'application/json', body: '' });
  });
  await editarObjetivo(pa, 'Guardado con respuesta cortada');
  await expect(pa.getByText('Sin conexión. Reintentando')).toBeVisible();

  await pa.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(pa.getByText('Sin conexión. Reintentando')).toBeHidden();
  await expect.poll(() => estados.at(-1)).toBe(409);
  await expect(pa.getByText('Este estudio cambió en otro dispositivo')).toBeHidden();
  await expect(pa.getByLabel('Objetivo', { exact: true })).toHaveValue('Guardado con respuesta cortada');
  expect(await (await a.request.get('/api/estudio')).text()).toContain('Guardado con respuesta cortada');
  await a.close();
});

test('R4 Salir con un 4xx nuevo en el vaciado avisa y el segundo clic sale', async ({ browser }) => {
  const mail = correo('r4');
  const a = await dispositivo(browser);
  const pa = await a.newPage();
  await registrar(pa, mail);
  await crearCliente(pa, 'Cliente Salida');
  await abrirFicha(pa, 'Cliente Salida');

  let soltar: () => void = () => undefined;
  const puerta = new Promise<void>((resolver) => {
    soltar = resolver;
  });
  await pa.route('**/api/estudio', async (ruta) => {
    if (ruta.request().method() !== 'PUT') return ruta.fallback();
    await puerta;
    await ruta.fulfill({ status: 413, contentType: 'application/json', body: '{"error":"Demasiado grande."}' });
  });
  await editarObjetivo(pa, 'Edición que no cabe');
  await pa.getByRole('button', { name: 'Salir' }).click();
  soltar();
  await expect(pa.getByText('No pude guardar: Demasiado grande.')).toBeVisible();
  await expect(pa).not.toHaveURL(/\/entrar$/);

  await pa.getByRole('button', { name: 'Salir' }).click();
  await expect(pa).toHaveURL(/\/entrar$/);
  await a.close();
});

test('TC-3.3 servidor caído en /entrar: avisa sin conexión y no toca localStorage', async ({ browser }) => {
  const semilla = sembrarLocal(correo('t33'), CLAVE, 'clave-original-cliente', correo('leg'));
  const a = await dispositivo(browser);
  await a.addInitScript((s) => {
    if (!localStorage.getItem('pulso.cuentas.v1')) {
      localStorage.setItem('pulso.cuentas.v1', s.cuentas);
      localStorage.setItem(`pulso.estado.${s.id}`, s.estado);
    }
  }, semilla);
  const pa = await a.newPage();
  await pa.route('**/api/sesion', (ruta) => (ruta.request().method() === 'GET' ? ruta.abort() : ruta.fallback()));
  await pa.goto('/entrar');
  const alerta = pa.getByRole('alert');
  await expect(alerta).toBeVisible();
  await expect(alerta).toHaveText('No pude conectar. Revisa tu internet e inténtalo de nuevo.');
  const local = await pa.evaluate(
    (id) => ({ cuentas: localStorage.getItem('pulso.cuentas.v1'), estado: localStorage.getItem(`pulso.estado.${id}`) }),
    semilla.id,
  );
  expect(local.cuentas).toBe(semilla.cuentas);
  expect(local.estado).toBe(semilla.estado);
  await a.close();
});

test('TC-4.3 el servidor con datos gana al local distinto; la copia local queda intacta', async ({ browser }) => {
  const mail = correo('t43');
  const a = await dispositivo(browser);
  const pa = await a.newPage();
  await registrar(pa, mail);
  await crearCliente(pa, 'Cliente Del Servidor');

  const semilla = sembrarLocal(mail, CLAVE, 'clave-original-cliente', correo('leg'));
  const b = await dispositivo(browser);
  await b.addInitScript((s) => {
    if (!localStorage.getItem('pulso.cuentas.v1')) {
      localStorage.setItem('pulso.cuentas.v1', s.cuentas);
      localStorage.setItem(`pulso.estado.${s.id}`, s.estado);
    }
  }, semilla);
  const pb = await b.newPage();
  const puts: string[] = [];
  const registros: string[] = [];
  pb.on('request', (r) => {
    if (r.url().endsWith('/api/estudio') && r.method() === 'PUT') puts.push(r.url());
    if (r.url().endsWith('/api/registro') && r.method() === 'POST') registros.push(r.url());
  });

  // Una clave que no coincide ni con el servidor ni con la copia local no dispara registro.
  await pb.goto('/entrar');
  await pb.locator('input[name=correo]').fill(mail);
  const boton = pb.getByRole('button', { name: 'Entrar', exact: true });
  await escribirClave(pb.locator('input[name=clave]'), 'otra-clave-distinta-1', boton);
  const rechazada = pb.waitForResponse((r) => r.url().endsWith('/api/entrar') && r.status() === 401);
  await boton.click();
  await rechazada;
  await expect(pb.getByRole('alert')).toHaveText('Correo o contraseña no coinciden.');
  expect(registros).toHaveLength(0);

  await entrar(pb, mail);
  await pb.goto('/clientes');
  await expect(pb.getByText('Cliente Del Servidor')).toBeVisible();
  await expect(pb.getByText('Cliente Legado')).toHaveCount(0);
  await expect(pb.getByText('Segundo Local')).toHaveCount(0);
  await pb.waitForTimeout(1000);
  expect(puts).toHaveLength(0);
  expect(registros).toHaveLength(0);

  const local = await pb.evaluate(
    (id) => ({
      cuentas: localStorage.getItem('pulso.cuentas.v1'),
      estado: localStorage.getItem(`pulso.estado.${id}`),
    }),
    semilla.id,
  );
  expect(local.cuentas).toBe(semilla.cuentas);
  expect(local.estado).toBe(semilla.estado);
  const servidor = await (await b.request.get('/api/estudio')).text();
  expect(servidor).toContain('Cliente Del Servidor');
  expect(servidor).not.toContain('Cliente Legado');
  await a.close();
  await b.close();
});

test('TC-6.4 Salir guarda lo pendiente antes de cerrar la sesión y vacía el estado', async ({ browser }) => {
  const mail = correo('t64');
  const a = await dispositivo(browser);
  const pa = await a.newPage();
  await registrar(pa, mail);
  await crearCliente(pa, 'Cliente Previo');
  await abrirFicha(pa, 'Cliente Previo');

  const orden: string[] = [];
  pa.on('request', (r) => {
    if (esPut({ url: () => r.url(), request: () => r })) orden.push('PUT');
    if (r.url().endsWith('/api/sesion') && r.method() === 'DELETE') orden.push('DELETE');
  });
  await editarObjetivo(pa, 'Pendiente al salir');
  await pa.getByRole('button', { name: 'Salir' }).click(); // dentro del debounce de 600 ms
  await expect(pa).toHaveURL(/\/entrar$/);
  expect(orden).toEqual(['PUT', 'DELETE']);

  // Otro usuario en el mismo navegador no ve los datos anteriores.
  await registrar(pa, correo('t64b'));
  await pa.goto('/clientes');
  await expect(pa.getByRole('link', { name: 'Clientes', exact: true })).toBeVisible();
  await expect(pa.getByText('Cliente Previo')).toHaveCount(0);

  // Y lo pendiente sí llegó al servidor de la primera cuenta.
  await pa.getByRole('button', { name: 'Salir' }).click();
  await expect(pa).toHaveURL(/\/entrar$/);
  await entrar(pa, mail);
  await abrirFicha(pa, 'Cliente Previo');
  await expect(pa.getByLabel('Objetivo', { exact: true })).toHaveValue('Pendiente al salir');
  await a.close();
});

test('TC-X.2 pagehide con cambios pendientes envía un PUT keepalive', async ({ browser }) => {
  const mail = correo('tx2');
  const a = await dispositivo(browser);
  await a.addInitScript(() => {
    const original = window.fetch.bind(window);
    const w = window as unknown as { __envios: { url: string; metodo: string; keepalive: boolean }[] };
    w.__envios = [];
    window.fetch = (entrada, init) => {
      const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
      w.__envios.push({ url, metodo: (init?.method ?? 'GET').toUpperCase(), keepalive: init?.keepalive === true });
      return original(entrada, init);
    };
  });
  const pa = await a.newPage();
  await registrar(pa, mail);
  await crearCliente(pa, 'Cliente Cierre');
  await abrirFicha(pa, 'Cliente Cierre');

  const campo = pa.getByLabel('Objetivo', { exact: true });
  await pa.evaluate(() => ((window as unknown as { __envios: unknown[] }).__envios.length = 0));
  await campo.fill('Cambio al cerrar');
  await campo.blur();
  await pa.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));

  const envios = await pa.evaluate(
    () => (window as unknown as { __envios: { url: string; metodo: string; keepalive: boolean }[] }).__envios,
  );
  const puts = envios.filter((e) => e.metodo === 'PUT' && e.url.includes('/api/estudio'));
  expect(puts.length).toBeGreaterThanOrEqual(1);
  expect(puts[0].keepalive).toBe(true);
  await expect
    .poll(async () => (await (await a.request.get('/api/estudio')).text()).includes('Cambio al cerrar'))
    .toBe(true);
  await a.close();
});
