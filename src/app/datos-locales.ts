import { Estado } from './modelos';

const CUENTAS = 'pulso.cuentas.v1';

export interface Cuenta {
  id: string;
  nombre: string;
  correo: string;
  sal: string;
  hash: string;
}

export interface AccesoLegado {
  clienteId: string;
  correo: string;
  sal: string;
  hash: string;
}

export async function hashClave(clave: string, sal: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${sal}:${clave}`);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function leerCuentas(): Cuenta[] {
  try {
    const data = JSON.parse(localStorage.getItem(CUENTAS) || '[]') as Cuenta[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function leerEstudio(id: string): (Omit<Estado, 'accesos'> & { accesos: AccesoLegado[] }) | null {
  try {
    const data = JSON.parse(localStorage.getItem(`pulso.estado.${id}`) || 'null') as Estado | null;
    if (!data || !Array.isArray(data.clientes)) return null;
    return { ...data, accesos: Array.isArray(data.accesos) ? (data.accesos as AccesoLegado[]) : [] };
  } catch {
    return null;
  }
}

export async function cuentaLocal(correo: string, clave: string): Promise<Cuenta | null> {
  const mail = correo.trim().toLowerCase();
  const cuenta = leerCuentas().find((c) => c?.correo === mail);
  if (!cuenta?.sal || !cuenta.hash) return null;
  return (await hashClave(clave, cuenta.sal)) === cuenta.hash ? cuenta : null;
}

function marcaSubido(id: string): string {
  return `pulso.subido.${id}`;
}

export function estudioParaSubir(cuenta: Cuenta): { estado: Estado; accesosLegado: AccesoLegado[] } | null {
  try {
    if (localStorage.getItem(marcaSubido(cuenta.id))) return null;
    const local = leerEstudio(cuenta.id);
    if (!local) return null;
    const vacio = [local.servicios, local.clientes, local.citas, local.rutinas, local.tablas, local.pagos].every(
      (l) => !Array.isArray(l) || l.length === 0,
    );
    if (vacio) return null;
    const accesosLegado = local.accesos.filter((a) => a?.clienteId && a.correo && a.sal && a.hash);
    return { estado: { ...local, accesos: [] } as Estado, accesosLegado };
  } catch {
    return null;
  }
}

export function marcarSubido(id: string): void {
  try {
    localStorage.setItem(marcaSubido(id), '1');
  } catch {
    /* sin almacenamiento: se reintentará en la próxima entrada */
  }
}
