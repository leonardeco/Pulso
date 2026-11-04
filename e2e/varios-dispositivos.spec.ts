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
  const clienteId = actual.estado.clientes[0].id;
  const pago = { id: 'p1', clienteId, tipo: 'otro', periodo: '', concepto: 'PAGO-SECRETO', valor: 99, fecha: '2026-11-01', estado: 'pagado' };
  const put = await a.request.put('/api/estudio', {
    headers: origen,
    data: { version: actual.version, estado: { ...actual.estado, accesos: [], pagos: [pago] } },
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
  await p.route('**/api/estudio', (ruta) => ruta.abort());
  await p.goto('/');
  await expect(p.getByText('No pude traer tus datos.')).toBeVisible();
  await expect(p.getByRole('button', { name: 'Reintentar' })).toBeVisible();
  await p.waitForTimeout(1500);
  expect(puts).toHaveLength(0);

  await p.unroute('**/api/estudio');
  await p.getByRole('button', { name: 'Reintentar' }).click();
  await expect(p.getByText('No pude traer tus datos.')).toBeHidden();
  await p.goto('/clientes');
  await expect(p.getByText('Cliente Cuatro')).toBeVisible();
  await a.close();
});
