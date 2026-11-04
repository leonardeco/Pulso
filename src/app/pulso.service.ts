import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import {
  AccesoCliente,
  Cliente,
  DiaRutina,
  Ejercicio,
  Estado,
  FilaComida,
  Pago,
  Rutina,
  Servicio,
  Tabla,
  buscarCliente,
  fechaISO,
  hoyISO,
  modalidadDe,
  periodoActual,
  uid,
} from './modelos';
import { hashClave, SesionService } from './sesion.service';

const CLAVE_VIEJA = 'pulso.estado.v1';
const LEGACY = 'pulso.legacy.asignado';

function claveCuenta(id: string): string {
  return `pulso.estado.${id}`;
}

function vacio(): Estado {
  return {
    servicios: [],
    horario: { '1': [], '2': [], '3': [], '4': [], '5': [], '6': [], '0': [] },
    clientes: [],
    citas: [],
    rutinas: [],
    tablas: [],
    pagos: [],
    accesos: [],
  };
}

function olvidarEjemplo(): void {
  if (typeof localStorage === 'undefined' || localStorage.getItem('pulso.vacio') === '1') return;
  const borrar: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const clave = localStorage.key(i);
    if (clave === CLAVE_VIEJA || clave === LEGACY || clave?.startsWith('pulso.estado.')) borrar.push(clave);
  }
  borrar.forEach((clave) => localStorage.removeItem(clave));
  localStorage.setItem('pulso.vacio', '1');
}

olvidarEjemplo();

function normalizar(data: Estado): Estado {
  return {
    ...data,
    clientes: data.clientes.map((cliente) => ({
      ...cliente,
      mensualidad: Number(cliente.mensualidad) || 0,
      valoracionMensual: Number(cliente.valoracionMensual) || 0,
      modalidad: modalidadDe(cliente.modalidad),
    })),
    rutinas: (data.rutinas ?? []).map((rutina) => ({
      ...rutina,
      precio: Number(rutina.precio) || 0,
      dias: rutina.dias ?? [],
    })),
    pagos: (data.pagos ?? []).map((pago) => ({
      ...pago,
      tipo: pago.tipo ?? 'otro',
      periodo: pago.periodo ?? '',
    })),
    accesos: (data.accesos ?? []).filter((acceso) => acceso?.clienteId && acceso.correo && acceso.hash),
  };
}

function parseEstado(texto: string | null): Estado | null {
  if (!texto) return null;
  try {
    const data = JSON.parse(texto) as Estado;
    if (!data || !Array.isArray(data.clientes) || !Array.isArray(data.servicios)) return null;
    return normalizar(data);
  } catch {
    return null;
  }
}

function leerCuenta(id: string): Estado {
  const propio = parseEstado(localStorage.getItem(claveCuenta(id)));
  if (propio) return propio;
  if (localStorage.getItem(LEGACY) !== id && !localStorage.getItem(LEGACY)) {
    localStorage.setItem(LEGACY, id);
    return parseEstado(localStorage.getItem(CLAVE_VIEJA)) ?? vacio();
  }
  return vacio();
}

@Injectable({ providedIn: 'root' })
export class PulsoService {
  private sesion = inject(SesionService);
  private listo = false;
  private cargado: string | null = this.sesion.estudioId();
  readonly estado = signal<Estado>(this.cargado ? leerCuenta(this.cargado) : vacio());

  constructor() {
    if (this.cargado) this.listo = true;

    effect(() => {
      const id = this.sesion.estudioId();
      if (!id) {
        this.listo = false;
        this.cargado = null;
        return;
      }
      if (this.cargado === id) {
        this.listo = true;
        return;
      }
      const estado = leerCuenta(id);
      this.listo = false;
      untracked(() => this.estado.set(estado));
      this.cargado = id;
      this.listo = true;
    });

    effect(() => {
      const id = this.sesion.estudioId();
      const estado = this.estado();
      if (!id || !this.listo || this.cargado !== id || this.sesion.esCliente()) return;
      localStorage.setItem(claveCuenta(id), JSON.stringify(estado));
    });
  }

  agregarCliente(datos: Pick<Cliente, 'nombre' | 'telefono' | 'correo' | 'objetivo' | 'modalidad'>): string {
    const cliente: Cliente = {
      id: uid(),
      nombre: datos.nombre.trim(),
      telefono: datos.telefono.trim(),
      correo: datos.correo.trim(),
      objetivo: datos.objetivo.trim(),
      notas: '',
      peso: '',
      estatura: '',
      mensualidad: 0,
      valoracionMensual: 0,
      modalidad: modalidadDe(datos.modalidad),
    };
    this.estado.update((actual) => ({ ...actual, clientes: [cliente, ...actual.clientes] }));
    return cliente.id;
  }

  actualizarCliente(id: string, cambios: Partial<Cliente>): void {
    this.estado.update((actual) => ({
      ...actual,
      clientes: actual.clientes.map((cliente) => (cliente.id === id ? { ...cliente, ...cambios } : cliente)),
    }));
  }

  eliminarCliente(id: string): void {
    this.estado.update((actual) => ({
      ...actual,
      clientes: actual.clientes.filter((cliente) => cliente.id !== id),
      citas: actual.citas.filter((cita) => cita.clienteId !== id),
      rutinas: actual.rutinas.filter((rutina) => rutina.clienteId !== id),
      tablas: actual.tablas.filter((tabla) => tabla.clienteId !== id),
      pagos: actual.pagos.filter((pago) => pago.clienteId !== id),
      accesos: actual.accesos.filter((acceso) => acceso.clienteId !== id),
    }));
  }

  async darAcceso(clienteId: string, correo: string, clave: string): Promise<string | null> {
    const mail = correo.trim().toLowerCase();
    if (!mail.includes('@') || mail.startsWith('@') || mail.endsWith('@')) return 'Escribe un correo válido.';
    if (clave.length < 8) return 'La contraseña necesita al menos 8 caracteres.';
    if (this.sesion.hayEntrenador(mail)) return 'Ese correo ya es de un entrenador. Usa otro.';
    const actual = this.estado();
    if (!actual.clientes.some((cliente) => cliente.id === clienteId)) return 'No encuentro ese cliente.';
    if (actual.accesos.some((acceso) => acceso.correo === mail && acceso.clienteId !== clienteId)) {
      return 'Ese correo ya lo usa otro cliente.';
    }
    const sal = uid();
    const acceso: AccesoCliente = { clienteId, correo: mail, sal, hash: await hashClave(clave, sal) };
    this.estado.update((estado) => ({
      ...estado,
      accesos: [...estado.accesos.filter((item) => item.clienteId !== clienteId), acceso],
    }));
    return null;
  }

  quitarAcceso(clienteId: string): void {
    this.estado.update((estado) => ({
      ...estado,
      accesos: estado.accesos.filter((acceso) => acceso.clienteId !== clienteId),
    }));
  }

  guardarServicio(servicio: Servicio): void {
    this.estado.update((actual) => {
      const existe = actual.servicios.some((item) => item.id === servicio.id);
      const servicios = existe
        ? actual.servicios.map((item) => (item.id === servicio.id ? servicio : item))
        : [...actual.servicios, servicio];
      return { ...actual, servicios };
    });
  }

  eliminarServicio(id: string): void {
    this.estado.update((actual) => {
      if (actual.servicios.length <= 1) return actual;
      return { ...actual, servicios: actual.servicios.filter((item) => item.id !== id) };
    });
  }

  agregarBloque(diaId: string): void {
    this.estado.update((actual) => ({
      ...actual,
      horario: { ...actual.horario, [diaId]: [...(actual.horario[diaId] ?? []), ['08:00', '12:00']] },
    }));
  }

  quitarBloque(diaId: string, indice: number): void {
    this.estado.update((actual) => ({
      ...actual,
      horario: {
        ...actual.horario,
        [diaId]: (actual.horario[diaId] ?? []).filter((_, i) => i !== indice),
      },
    }));
  }

  cambiarBloque(diaId: string, indice: number, campo: 0 | 1, valor: string): void {
    this.estado.update((actual) => {
      const bloques = (actual.horario[diaId] ?? []).map((bloque, i) => {
        if (i !== indice) return bloque;
        const copia: [string, string] = [bloque[0], bloque[1]];
        copia[campo] = valor;
        return copia;
      });
      return { ...actual, horario: { ...actual.horario, [diaId]: bloques } };
    });
  }

  reservar(datos: { servicioId: string; fecha: string; hora: string; nombre: string; telefono: string; correo: string }): void {
    this.estado.update((actual) => {
      const conocido = buscarCliente(actual, datos.telefono, datos.correo);
      const cliente: Cliente = conocido ?? {
        id: uid(),
        nombre: datos.nombre.trim(),
        telefono: datos.telefono.trim(),
        correo: datos.correo.trim(),
        objetivo: '',
        notas: '',
        peso: '',
        estatura: '',
        mensualidad: 0,
        valoracionMensual: 0,
        modalidad: 'personalizado',
      };
      return {
        ...actual,
        clientes: conocido ? actual.clientes : [cliente, ...actual.clientes],
        citas: [
          ...actual.citas,
          {
            id: uid(),
            servicioId: datos.servicioId,
            clienteId: cliente.id,
            fecha: datos.fecha,
            hora: datos.hora,
            estado: 'pendiente' as const,
          },
        ],
      };
    });
  }

  cambiarCita(id: string, estado: 'pendiente' | 'realizada' | 'cancelada'): void {
    this.estado.update((actual) => ({
      ...actual,
      citas: actual.citas.map((cita) => (cita.id === id ? { ...cita, estado } : cita)),
    }));
  }

  nuevaRutina(clienteId: string | null, nombre = '', precio = 0): string {
    const rutina: Rutina = {
      id: uid(),
      clienteId,
      nombre: nombre.trim() || (clienteId ? 'Rutina nueva' : 'Plantilla nueva'),
      precio: Math.max(0, Math.round(Number(precio) || 0)),
      dias: [{ id: uid(), nombre: 'Día 1', ejercicios: [] }],
    };
    this.estado.update((actual) => ({ ...actual, rutinas: [...actual.rutinas, rutina] }));
    return rutina.id;
  }

  cambiarRutina(id: string, cambios: Partial<Pick<Rutina, 'nombre' | 'precio'>>): void {
    this.estado.update((actual) => ({
      ...actual,
      rutinas: actual.rutinas.map((rutina) => (rutina.id === id ? { ...rutina, ...cambios } : rutina)),
    }));
  }

  agregarDia(rutinaId: string): void {
    const dia: DiaRutina = { id: uid(), nombre: 'Día nuevo', ejercicios: [] };
    this.estado.update((actual) => ({
      ...actual,
      rutinas: actual.rutinas.map((rutina) =>
        rutina.id === rutinaId ? { ...rutina, dias: [...rutina.dias, dia] } : rutina,
      ),
    }));
  }

  cambiarDia(rutinaId: string, diaId: string, nombre: string): void {
    this.estado.update((actual) => ({
      ...actual,
      rutinas: actual.rutinas.map((rutina) =>
        rutina.id === rutinaId
          ? { ...rutina, dias: rutina.dias.map((dia) => (dia.id === diaId ? { ...dia, nombre } : dia)) }
          : rutina,
      ),
    }));
  }

  quitarDia(rutinaId: string, diaId: string): void {
    this.estado.update((actual) => ({
      ...actual,
      rutinas: actual.rutinas.map((rutina) =>
        rutina.id === rutinaId ? { ...rutina, dias: rutina.dias.filter((dia) => dia.id !== diaId) } : rutina,
      ),
    }));
  }

  agregarEjercicio(rutinaId: string, diaId: string): void {
    const ejercicio: Ejercicio = {
      id: uid(),
      nombre: 'Sentadilla',
      series: '3',
      reps: '10',
      descanso: '60s',
      imagen: true,
    };
    this.estado.update((actual) => ({
      ...actual,
      rutinas: actual.rutinas.map((rutina) => {
        if (rutina.id !== rutinaId) return rutina;
        return {
          ...rutina,
          dias: rutina.dias.map((dia) =>
            dia.id === diaId ? { ...dia, ejercicios: [...dia.ejercicios, ejercicio] } : dia,
          ),
        };
      }),
    }));
  }

  cambiarEjercicio(rutinaId: string, diaId: string, ejercicioId: string, cambios: Partial<Ejercicio>): void {
    this.estado.update((actual) => ({
      ...actual,
      rutinas: actual.rutinas.map((rutina) => {
        if (rutina.id !== rutinaId) return rutina;
        return {
          ...rutina,
          dias: rutina.dias.map((dia) => {
            if (dia.id !== diaId) return dia;
            return {
              ...dia,
              ejercicios: dia.ejercicios.map((item) => (item.id === ejercicioId ? { ...item, ...cambios } : item)),
            };
          }),
        };
      }),
    }));
  }

  quitarEjercicio(rutinaId: string, diaId: string, ejercicioId: string): void {
    this.estado.update((actual) => ({
      ...actual,
      rutinas: actual.rutinas.map((rutina) => {
        if (rutina.id !== rutinaId) return rutina;
        return {
          ...rutina,
          dias: rutina.dias.map((dia) =>
            dia.id === diaId
              ? { ...dia, ejercicios: dia.ejercicios.filter((item) => item.id !== ejercicioId) }
              : dia,
          ),
        };
      }),
    }));
  }

  eliminarRutina(id: string): void {
    this.estado.update((actual) => ({ ...actual, rutinas: actual.rutinas.filter((item) => item.id !== id) }));
  }

  copiarRutina(id: string, clienteId: string | null): void {
    this.estado.update((actual) => {
      const origen = actual.rutinas.find((item) => item.id === id);
      if (!origen) return actual;
      const copia: Rutina = {
        id: uid(),
        clienteId,
        nombre: origen.nombre,
        precio: Number(origen.precio) || 0,
        dias: origen.dias.map((dia) => ({
          id: uid(),
          nombre: dia.nombre,
          ejercicios: dia.ejercicios.map((item) => ({ ...item, id: uid() })),
        })),
      };
      return { ...actual, rutinas: [...actual.rutinas, copia] };
    });
  }

  nuevaTabla(clienteId: string): void {
    const tabla: Tabla = {
      id: uid(),
      clienteId,
      nombre: 'Tabla nueva',
      filas: [{ id: uid(), momento: 'Desayuno', alimento: '', cantidad: '', nota: '' }],
    };
    this.estado.update((actual) => ({ ...actual, tablas: [...actual.tablas, tabla] }));
  }

  cambiarTabla(id: string, nombre: string): void {
    this.estado.update((actual) => ({
      ...actual,
      tablas: actual.tablas.map((tabla) => (tabla.id === id ? { ...tabla, nombre } : tabla)),
    }));
  }

  agregarFila(tablaId: string): void {
    const fila: FilaComida = { id: uid(), momento: 'Almuerzo', alimento: '', cantidad: '', nota: '' };
    this.estado.update((actual) => ({
      ...actual,
      tablas: actual.tablas.map((tabla) => (tabla.id === tablaId ? { ...tabla, filas: [...tabla.filas, fila] } : tabla)),
    }));
  }

  cambiarFila(tablaId: string, filaId: string, cambios: Partial<FilaComida>): void {
    this.estado.update((actual) => ({
      ...actual,
      tablas: actual.tablas.map((tabla) => {
        if (tabla.id !== tablaId) return tabla;
        return { ...tabla, filas: tabla.filas.map((fila) => (fila.id === filaId ? { ...fila, ...cambios } : fila)) };
      }),
    }));
  }

  quitarFila(tablaId: string, filaId: string): void {
    this.estado.update((actual) => ({
      ...actual,
      tablas: actual.tablas.map((tabla) =>
        tabla.id === tablaId ? { ...tabla, filas: tabla.filas.filter((fila) => fila.id !== filaId) } : tabla,
      ),
    }));
  }

  eliminarTabla(id: string): void {
    this.estado.update((actual) => ({ ...actual, tablas: actual.tablas.filter((item) => item.id !== id) }));
  }

  generarCobrosDelMes(clienteId: string): void {
    const periodo = periodoActual();
    const fecha = hoyISO();
    this.estado.update((actual) => {
      const cliente = actual.clientes.find((item) => item.id === clienteId);
      if (!cliente) return actual;
      const existe = (tipo: Pago['tipo']) =>
        actual.pagos.some((pago) => pago.clienteId === clienteId && pago.tipo === tipo && pago.periodo === periodo);
      const nuevos: Pago[] = [];
      if (cliente.mensualidad > 0 && !existe('mensualidad')) {
        nuevos.push({
          id: uid(),
          clienteId,
          tipo: 'mensualidad',
          periodo,
          concepto: 'Mensualidad',
          valor: cliente.mensualidad,
          fecha,
          estado: 'pendiente',
        });
      }
      if (cliente.valoracionMensual > 0 && !existe('valoracion')) {
        nuevos.push({
          id: uid(),
          clienteId,
          tipo: 'valoracion',
          periodo,
          concepto: 'Valoración del mes',
          valor: cliente.valoracionMensual,
          fecha,
          estado: 'pendiente',
        });
      }
      if (nuevos.length === 0) return actual;
      return { ...actual, pagos: [...nuevos, ...actual.pagos] };
    });
  }

  agregarPago(pago: Omit<Pago, 'id'>): void {
    this.estado.update((actual) => ({ ...actual, pagos: [{ ...pago, id: uid() }, ...actual.pagos] }));
  }

  cambiarPago(id: string, cambios: Partial<Pago>): void {
    this.estado.update((actual) => ({
      ...actual,
      pagos: actual.pagos.map((pago) => (pago.id === id ? { ...pago, ...cambios } : pago)),
    }));
  }

  eliminarPago(id: string): void {
    this.estado.update((actual) => ({ ...actual, pagos: actual.pagos.filter((pago) => pago.id !== id) }));
  }
}

export function fechaDeHoy(): string {
  return fechaISO(new Date());
}
