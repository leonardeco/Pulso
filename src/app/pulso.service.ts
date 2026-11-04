import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { pedir } from './api';
import { cuentaLocal, estudioParaSubir, marcarSubido } from './datos-locales';
import {
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
import { SesionService } from './sesion.service';

const REINTENTO_MS = 15000;
const ESPERA_MS = 600;
const MAX_KEEPALIVE = 60 * 1024;

interface Respuesta {
  estado: Estado;
  version: number;
  accesos?: Estado['accesos'];
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

function sinAccesos(estado: Estado): Estado {
  return { ...estado, accesos: [] };
}

function firma(estado: Estado): string {
  return JSON.stringify(sinAccesos(estado));
}

function estaVacio(e: Estado): boolean {
  return [e.servicios, e.clientes, e.citas, e.rutinas, e.tablas, e.pagos].every((l) => l.length === 0);
}

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
    accesos: (data.accesos ?? []).filter((acceso) => acceso?.clienteId && acceso.correo),
  };
}

@Injectable({ providedIn: 'root' })
export class PulsoService {
  private sesion = inject(SesionService);
  readonly estado = signal<Estado>(vacio());
  readonly cargaFallida = signal(false);
  readonly sinConexion = signal(false);
  readonly conflicto = signal(false);
  readonly sesionVencida = signal(false);

  private version = 0;
  private ultimoJson = '';
  private temporizador: ReturnType<typeof setTimeout> | null = null;
  private reintento: ReturnType<typeof setTimeout> | null = null;
  private listo = false;
  private enCurso: Promise<void> | null = null;
  private repetir = false;

  constructor() {
    effect(() => {
      const actual = this.estado();
      untracked(() => {
        if (!this.listo || !this.sesion.esEntrenador() || firma(actual) === this.ultimoJson) return;
        this.anular(this.temporizador);
        this.temporizador = setTimeout(() => {
          this.temporizador = null;
          void this.guardarAhora();
        }, ESPERA_MS);
      });
    });

    if (typeof window === 'undefined') return;
    window.addEventListener('online', () => {
      if (this.sinConexion()) void this.guardarAhora();
    });
    window.addEventListener('pagehide', () => this.guardarAlSalir());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.refrescar();
    });
  }

  async cargar(): Promise<void> {
    const r = await pedir<Respuesta>('GET', '/api/estudio');
    if (r.ok) {
      this.aplicar(r.datos);
      this.listo = true;
      this.cargaFallida.set(false);
      return;
    }
    if (r.status === 401) {
      this.vencer();
      return;
    }
    this.listo = false;
    this.cargaFallida.set(true);
  }

  async trasEntrar(correo: string, clave: string): Promise<void> {
    await this.cargar();
    if (!this.sesion.esEntrenador() || !this.listo || !estaVacio(this.estado())) return;
    const cuenta = await cuentaLocal(correo, clave);
    if (!cuenta) return;
    const subida = estudioParaSubir(cuenta);
    if (!subida) return;
    const r = await pedir<Respuesta>('PUT', '/api/estudio', {
      version: this.version,
      estado: sinAccesos(subida.estado),
      accesosLegado: subida.accesosLegado,
    });
    if (r.ok) {
      marcarSubido(cuenta.id);
      this.aplicar({ estado: { ...subida.estado, accesos: r.datos.accesos ?? [] }, version: r.datos.version });
    } else if (r.status === 401) {
      this.vencer();
    }
  }

  async guardarAhora(): Promise<void> {
    if (this.enCurso) {
      this.repetir = true;
      return this.enCurso;
    }
    this.enCurso = this.ciclo().finally(() => {
      this.enCurso = null;
    });
    return this.enCurso;
  }

  async salir(): Promise<boolean> {
    if (this.hayPendientes()) {
      await this.guardarAhora();
      if (this.sinConexion() && this.hayPendientes()) return false;
    }
    this.anular(this.temporizador);
    this.anular(this.reintento);
    this.temporizador = null;
    this.reintento = null;
    await this.sesion.salir();
    this.listo = false;
    this.version = 0;
    this.ultimoJson = '';
    this.estado.set(vacio());
    this.sinConexion.set(false);
    this.conflicto.set(false);
    this.cargaFallida.set(false);
    this.sesionVencida.set(false);
    return true;
  }

  private hayPendientes(): boolean {
    return this.listo && this.sesion.esEntrenador() && firma(this.estado()) !== this.ultimoJson;
  }

  private anular(t: ReturnType<typeof setTimeout> | null): void {
    if (t !== null) clearTimeout(t);
  }

  private aplicar(datos: { estado: Estado; version: number }): void {
    const estado = normalizar(datos.estado);
    this.version = datos.version;
    this.ultimoJson = firma(estado);
    this.estado.set(estado);
  }

  private vencer(): void {
    this.listo = false;
    this.anular(this.temporizador);
    this.anular(this.reintento);
    this.temporizador = null;
    this.reintento = null;
    this.sesionVencida.set(true);
    this.sesion.actual.set(null);
  }

  private async ciclo(): Promise<void> {
    do {
      this.repetir = false;
      this.anular(this.temporizador);
      this.temporizador = null;
      if (!this.listo || !this.sesion.esEntrenador()) return;
      const actual = this.estado();
      const enviado = firma(actual);
      if (enviado === this.ultimoJson) return;
      const r = await pedir<Respuesta>('PUT', '/api/estudio', {
        version: this.version,
        estado: sinAccesos(actual),
      });
      if (!this.listo) return;
      if (r.ok) {
        this.version = r.datos.version;
        this.ultimoJson = enviado;
        this.sinConexion.set(false);
        this.anular(this.reintento);
        this.reintento = null;
        if (firma(this.estado()) !== enviado) this.repetir = true;
      } else if (r.status === 409 && r.datos) {
        this.aplicar(r.datos);
        this.conflicto.set(true);
        this.sinConexion.set(false);
        return;
      } else if (r.status === 401) {
        this.vencer();
        return;
      } else {
        this.sinConexion.set(true);
        this.anular(this.reintento);
        this.reintento = setTimeout(() => {
          this.reintento = null;
          void this.guardarAhora();
        }, REINTENTO_MS);
        return;
      }
    } while (this.repetir);
  }

  private guardarAlSalir(): void {
    if (!this.hayPendientes()) return;
    const cuerpo = JSON.stringify({ version: this.version, estado: sinAccesos(this.estado()) });
    if (new TextEncoder().encode(cuerpo).length >= MAX_KEEPALIVE) return;
    void fetch('/api/estudio', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: cuerpo,
      keepalive: true,
    }).catch(() => undefined);
  }

  private async refrescar(): Promise<void> {
    if (!this.listo || !this.sesion.activa() || this.enCurso || this.temporizador !== null) return;
    if (this.hayPendientes()) return;
    const r = await pedir<Respuesta>('GET', '/api/estudio');
    if (r.ok) {
      if (!this.listo || this.enCurso || this.hayPendientes()) return;
      if (r.datos.version !== this.version) this.aplicar(r.datos);
    } else if (r.status === 401) {
      this.vencer();
    }
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
    const actual = this.estado();
    if (!actual.clientes.some((cliente) => cliente.id === clienteId)) return 'No encuentro ese cliente.';
    if (actual.accesos.some((acceso) => acceso.correo === mail && acceso.clienteId !== clienteId)) {
      return 'Ese correo ya lo usa otro cliente.';
    }
    const r = await pedir<{ clienteId: string; correo: string }>('PUT', '/api/accesos', {
      clienteId,
      correo: mail,
      clave,
    });
    if (!r.ok) return r.error;
    this.estado.update((estado) => ({
      ...estado,
      accesos: [...estado.accesos.filter((item) => item.clienteId !== clienteId), { clienteId, correo: mail }],
    }));
    return null;
  }

  async quitarAcceso(clienteId: string): Promise<string | null> {
    const r = await pedir('DELETE', '/api/accesos', { clienteId });
    if (!r.ok) return r.error;
    this.estado.update((estado) => ({
      ...estado,
      accesos: estado.accesos.filter((acceso) => acceso.clienteId !== clienteId),
    }));
    return null;
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
