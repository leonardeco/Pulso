import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { pedir } from './api';
import { cuentaLocal, datosLocalesSinSubir, estudioParaSubir, marcarSubido } from './datos-locales';
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
import { Quitado, devolver, sacarDia, sacarEjercicio } from './deshacer';
import { LIMITE_CARACTERES, cercaDelLimite, estadoDeGuardado, MS_PARA_GUARDANDO } from './guardado';
import { SesionService } from './sesion.service';
import {
  ResultadoOrden,
  duplicarDia,
  duplicarEjercicio,
  duplicarRutina,
  moverEjercicio,
  moverEjercicioADia,
} from './orden';

const REINTENTO_MS = 15000;
const ESPERA_MS = 600;
const MAX_KEEPALIVE = 60 * 1024;
const DESHACER_MS = 10000;

interface Respuesta {
  estado: Estado;
  version: number;
  accesos?: Estado['accesos'];
  accesosOmitidos?: string[];
}

function formaValida(d: unknown): d is { estado: Estado; version: number } {
  const x = d as { estado?: Partial<Estado>; version?: unknown } | null | undefined;
  const e = x?.estado;
  return (
    typeof x?.version === 'number' &&
    !!e &&
    typeof e === 'object' &&
    Array.isArray(e.servicios) &&
    Array.isArray(e.clientes) &&
    Array.isArray(e.citas) &&
    !!e.horario &&
    typeof e.horario === 'object'
  );
}

function canonico(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonico);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => [k, canonico(x)]),
    );
  }
  return v;
}

function firmaCanonica(estado: Estado): string {
  return JSON.stringify(canonico(sinAccesos(estado)));
}

function reintentable(status: number): boolean {
  return status === 0 || status >= 500;
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
  readonly errorGuardado = signal('');
  readonly avisoSubida = signal<string[]>([]);
  readonly subidaPendiente = signal(false);

  private readonly _quitado = signal<Quitado | null>(null);
  readonly quitado = this._quitado.asReadonly();

  private readonly firmaConfirmada = signal('');
  private readonly estaListo = signal(false);
  private readonly temporizadorArmado = signal(false);
  private readonly enVuelo = signal(false);
  private readonly vueloLargo = signal(false);
  private readonly firmaActual = computed(() => firma(this.estado()));

  readonly estadoGuardado = computed(() =>
    estadoDeGuardado({
      pendiente:
        this.estaListo() &&
        this.sesion.esEntrenador() &&
        (this.firmaActual() !== this.firmaConfirmada() || this.temporizadorArmado()),
      enVuelo: this.enVuelo(),
      msEnVuelo: this.vueloLargo() ? MS_PARA_GUARDANDO : 0,
      conError:
        this.errorGuardado() !== '' ||
        this.sinConexion() ||
        this.conflicto() ||
        this.cargaFallida() ||
        this.subidaPendiente(),
    }),
  );
  readonly cercaDelLimite = computed(() => cercaDelLimite(this.firmaActual().length, LIMITE_CARACTERES));

  private version = 0;
  private temporizadorId: ReturnType<typeof setTimeout> | null = null;
  private vueloId: ReturnType<typeof setTimeout> | null = null;
  private enCursoPromesa: Promise<void> | null = null;
  private reintento: ReturnType<typeof setTimeout> | null = null;
  private quitadoId: ReturnType<typeof setTimeout> | null = null;
  private quitadoRestante = DESHACER_MS;
  private quitadoDesde = 0;
  private quitadoPausas = 0;
  private repetir = false;

  private get ultimoJson(): string {
    return this.firmaConfirmada();
  }
  private set ultimoJson(valor: string) {
    this.firmaConfirmada.set(valor);
  }
  private get listo(): boolean {
    return this.estaListo();
  }
  private set listo(valor: boolean) {
    this.estaListo.set(valor);
  }
  private get temporizador(): ReturnType<typeof setTimeout> | null {
    return this.temporizadorId;
  }
  private set temporizador(valor: ReturnType<typeof setTimeout> | null) {
    this.temporizadorId = valor;
    this.temporizadorArmado.set(valor !== null);
  }
  private get enCurso(): Promise<void> | null {
    return this.enCursoPromesa;
  }
  private set enCurso(valor: Promise<void> | null) {
    this.enCursoPromesa = valor;
    this.anular(this.vueloId);
    this.vueloId = null;
    this.vueloLargo.set(false);
    this.enVuelo.set(valor !== null);
    if (valor !== null) {
      this.vueloId = setTimeout(() => {
        this.vueloId = null;
        this.vueloLargo.set(true);
      }, MS_PARA_GUARDANDO);
    }
  }
  private datosSubida: { correo: string; clave: string } | null = null;

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
    window.addEventListener('pagehide', (evento) => {
      if (!evento.persisted) this.guardarAlSalir();
    });
    window.addEventListener('pageshow', (evento) => {
      if (evento.persisted) void this.refrescar();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.refrescar();
    });
  }

  private rutaEstudio(): string {
    const id = this.sesion.estudioId();
    return id ? `/api/estudio?entrenadorId=${encodeURIComponent(id)}` : '/api/estudio';
  }

  async cargar(desdeEntrada = false): Promise<void> {
    const r = await pedir<Respuesta>('GET', this.rutaEstudio());
    if (r.ok && formaValida(r.datos)) {
      this.aplicar(r.datos);
      const actual = this.sesion.actual();
      if (
        !desdeEntrada &&
        this.sesion.esEntrenador() &&
        estaVacio(this.estado()) &&
        actual &&
        datosLocalesSinSubir(actual.correo)
      ) {
        this.listo = false;
        this.cargaFallida.set(false);
        this.subidaPendiente.set(true);
        return;
      }
      this.subidaPendiente.set(false);
      this.listo = true;
      this.cargaFallida.set(false);
      return;
    }
    if (!r.ok && r.status === 401) {
      this.vencer();
      return;
    }
    this.listo = false;
    this.cargaFallida.set(true);
  }

  async reintentar(): Promise<void> {
    const datos = this.datosSubida;
    if (datos) await this.trasEntrar(datos.correo, datos.clave);
    else await this.cargar();
  }

  async trasEntrar(correo: string, clave: string): Promise<void> {
    this.datosSubida = { correo, clave };
    this.subidaPendiente.set(false);
    await this.cargar(true);
    if (!this.sesion.esEntrenador()) {
      this.datosSubida = null;
      return;
    }
    if (!this.listo) return;
    if (!estaVacio(this.estado())) {
      this.datosSubida = null;
      return;
    }
    try {
      const cuenta = await cuentaLocal(correo, clave);
      const subida = cuenta ? estudioParaSubir(cuenta) : null;
      if (!cuenta || !subida) {
        this.datosSubida = null;
        return;
      }
      const r = await pedir<Respuesta>('PUT', '/api/estudio', {
        entrenadorId: this.sesion.estudioId(),
        version: this.version,
        estado: sinAccesos(subida.estado),
        accesosLegado: subida.accesosLegado,
      });
      if (r.ok && typeof r.datos?.version === 'number') {
        marcarSubido(cuenta.id);
        this.aplicar({ estado: { ...subida.estado, accesos: r.datos.accesos ?? [] }, version: r.datos.version });
        this.datosSubida = null;
        const omitidos = r.datos.accesosOmitidos ?? [];
        if (omitidos.length > 0) this.avisoSubida.set(omitidos);
        return;
      }
      if (!r.ok && r.status === 401) {
        this.datosSubida = null;
        this.vencer();
        return;
      }
    } catch {
      /* cualquier fallo de la subida se trata abajo como carga fallida */
    }
    this.listo = false;
    this.cargaFallida.set(true);
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
      const errorVisto = this.errorGuardado() !== '';
      await this.guardarAhora();
      if (!errorVisto && this.errorGuardado() !== '' && this.hayPendientes()) return false;
      if (this.sinConexion() && this.hayPendientes()) return false;
      if (this.conflicto() || !this.sesion.activa()) return false;
    }
    if (!(await this.sesion.salir())) {
      this.sinConexion.set(true);
      return false;
    }
    this.anular(this.temporizador);
    this.anular(this.reintento);
    this.temporizador = null;
    this.reintento = null;
    this.limpiarQuitado();
    this.datosSubida = null;
    this.errorGuardado.set('');
    this.avisoSubida.set([]);
    this.subidaPendiente.set(false);
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

  private limpiarQuitado(): void {
    this.anular(this.quitadoId);
    this.quitadoId = null;
    this.quitadoPausas = 0;
    this.quitadoRestante = DESHACER_MS;
    this._quitado.set(null);
  }

  private armarQuitado(ms: number): void {
    this.anular(this.quitadoId);
    this.quitadoDesde = Date.now();
    this.quitadoRestante = ms;
    this.quitadoId = setTimeout(() => this.limpiarQuitado(), ms);
  }

  private fijarQuitado(quitado: Quitado): void {
    this.limpiarQuitado();
    this._quitado.set(quitado);
    this.armarQuitado(DESHACER_MS);
  }

  pausarDeshacer(): void {
    if (!this._quitado()) return;
    this.quitadoPausas += 1;
    if (this.quitadoId === null) return;
    this.anular(this.quitadoId);
    this.quitadoId = null;
    this.quitadoRestante = Math.max(0, this.quitadoRestante - (Date.now() - this.quitadoDesde));
  }

  reanudarDeshacer(): void {
    if (!this._quitado() || this.quitadoPausas === 0) return;
    this.quitadoPausas -= 1;
    if (this.quitadoPausas > 0 || this.quitadoId !== null) return;
    this.armarQuitado(this.quitadoRestante);
  }

  olvidarQuitado(): void {
    if (this._quitado()) this.limpiarQuitado();
  }

  deshacer(): void {
    const quitado = this._quitado();
    if (!quitado) return;
    this.limpiarQuitado();
    this.estado.update((actual) => ({ ...actual, rutinas: devolver(actual.rutinas, quitado) }));
  }

  private aplicar(datos: { estado: Estado; version: number }): void {
    this.limpiarQuitado();
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
    this.limpiarQuitado();
    this.datosSubida = null;
    this.subidaPendiente.set(false);
    this.sesionVencida.set(true);
    this.sesion.actual.set(null);
    this.version = 0;
    this.ultimoJson = '';
    this.estado.set(vacio());
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
        entrenadorId: this.sesion.estudioId(),
        version: this.version,
        estado: sinAccesos(actual),
      });
      if (!this.listo) return;
      if (r.ok && typeof r.datos?.version === 'number') {
        this.confirmar(r.datos.version, enviado);
      } else if (r.ok) {
        this.programarReintento();
        return;
      } else if (r.status === 409 && formaValida(r.datos)) {
        if (firmaCanonica(normalizar(r.datos.estado)) === firmaCanonica(actual)) {
          this.confirmar(r.datos.version, enviado);
        } else {
          this.aplicar(r.datos);
          this.conflicto.set(true);
          this.sinConexion.set(false);
          return;
        }
      } else if (r.status === 401) {
        this.vencer();
        return;
      } else if (reintentable(r.status)) {
        this.programarReintento();
        return;
      } else {
        this.sinConexion.set(false);
        this.errorGuardado.set(r.error);
        return;
      }
    } while (this.repetir);
  }

  private programarReintento(): void {
    this.sinConexion.set(true);
    this.anular(this.reintento);
    this.reintento = setTimeout(() => {
      this.reintento = null;
      void this.guardarAhora();
    }, REINTENTO_MS);
  }

  private confirmar(version: number, enviado: string): void {
    this.version = version;
    this.ultimoJson = enviado;
    this.sinConexion.set(false);
    this.errorGuardado.set('');
    this.anular(this.reintento);
    this.reintento = null;
    if (firma(this.estado()) !== enviado) this.repetir = true;
  }

  private guardarAlSalir(): void {
    if (!this.hayPendientes()) return;
    const cuerpo = JSON.stringify({ entrenadorId: this.sesion.estudioId(), version: this.version, estado: sinAccesos(this.estado()) });
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
    const r = await pedir<Respuesta>('GET', this.rutaEstudio());
    if (r.ok) {
      if (!formaValida(r.datos)) return;
      if (!this.listo || this.enCurso || this.hayPendientes()) return;
      this.sinConexion.set(false);
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
    this.limpiarQuitado();
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
    await this.guardarAhora();
    if (this.hayPendientes()) return 'Aún no se guardan tus cambios. Inténtalo de nuevo.';
    const actual = this.estado();
    if (!actual.clientes.some((cliente) => cliente.id === clienteId)) return 'No encuentro ese cliente.';
    if (actual.accesos.some((acceso) => acceso.correo === mail && acceso.clienteId !== clienteId)) {
      return 'Ese correo ya lo usa otro cliente.';
    }
    const r = await pedir<{ clienteId: string; correo: string; version?: number }>('PUT', '/api/accesos', {
      clienteId,
      correo: mail,
      clave,
    });
    if (!r.ok) return r.error;
    if (!(await this.adoptarVersion(r.datos?.version))) return null;
    this.estado.update((estado) => ({
      ...estado,
      accesos: [...estado.accesos.filter((item) => item.clienteId !== clienteId), { clienteId, correo: mail }],
    }));
    return null;
  }

  // Si la versión no es la siguiente, otro dispositivo guardó en medio: se trae el estado real.
  private async adoptarVersion(version: unknown): Promise<boolean> {
    if (version === this.version + 1) {
      this.version = version;
      return true;
    }
    await this.refrescar();
    return false;
  }

  async quitarAcceso(clienteId: string): Promise<string | null> {
    const r = await pedir<{ version?: number }>('DELETE', '/api/accesos', { clienteId });
    if (!r.ok) return r.error;
    if (!(await this.adoptarVersion(r.datos?.version))) return null;
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
    this.limpiarQuitado();
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
    this.limpiarQuitado();
    this.estado.update((actual) => ({
      ...actual,
      rutinas: actual.rutinas.map((rutina) => (rutina.id === id ? { ...rutina, ...cambios } : rutina)),
    }));
  }

  agregarDia(rutinaId: string): void {
    this.limpiarQuitado();
    const dia: DiaRutina = { id: uid(), nombre: 'Día nuevo', ejercicios: [] };
    this.estado.update((actual) => ({
      ...actual,
      rutinas: actual.rutinas.map((rutina) =>
        rutina.id === rutinaId ? { ...rutina, dias: [...rutina.dias, dia] } : rutina,
      ),
    }));
  }

  cambiarDia(rutinaId: string, diaId: string, nombre: string): void {
    this.limpiarQuitado();
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
    const resultado = sacarDia(this.estado().rutinas, rutinaId, diaId);
    if (!resultado) return;
    this.fijarQuitado(resultado.quitado);
    this.estado.update((actual) => ({ ...actual, rutinas: resultado.rutinas }));
  }

  agregarEjercicio(rutinaId: string, diaId: string): void {
    this.limpiarQuitado();
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
    this.limpiarQuitado();
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
    const resultado = sacarEjercicio(this.estado().rutinas, rutinaId, diaId, ejercicioId);
    if (!resultado) return;
    this.fijarQuitado(resultado.quitado);
    this.estado.update((actual) => ({ ...actual, rutinas: resultado.rutinas }));
  }

  eliminarRutina(id: string): void {
    this.limpiarQuitado();
    this.estado.update((actual) => ({ ...actual, rutinas: actual.rutinas.filter((item) => item.id !== id) }));
  }

  copiarRutina(id: string, clienteId: string | null): string | null {
    this.limpiarQuitado();
    let creada: string | null = null;
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
      creada = copia.id;
      return { ...actual, rutinas: [...actual.rutinas, copia] };
    });
    return creada;
  }

  private aplicarOrden(resultado: ResultadoOrden | null): ResultadoOrden | null {
    if (!resultado) return null;
    this.estado.update((actual) => ({ ...actual, rutinas: resultado.rutinas }));
    return resultado;
  }

  duplicarEjercicio(rutinaId: string, diaId: string, ejercicioId: string): string | null {
    this.limpiarQuitado();
    const resultado = this.aplicarOrden(duplicarEjercicio(this.estado().rutinas, rutinaId, diaId, ejercicioId, uid));
    return resultado?.id ?? null;
  }

  duplicarDia(rutinaId: string, diaId: string): string | null {
    this.limpiarQuitado();
    const resultado = this.aplicarOrden(duplicarDia(this.estado().rutinas, rutinaId, diaId, uid));
    return resultado?.id ?? null;
  }

  duplicarRutina(rutinaId: string): string | null {
    this.limpiarQuitado();
    const resultado = this.aplicarOrden(duplicarRutina(this.estado().rutinas, rutinaId, uid));
    return resultado?.id ?? null;
  }

  moverEjercicio(
    rutinaId: string,
    diaId: string,
    ejercicioId: string,
    delta: -1 | 1,
  ): { posicion: number; total: number } | null {
    this.limpiarQuitado();
    const resultado = this.aplicarOrden(moverEjercicio(this.estado().rutinas, rutinaId, diaId, ejercicioId, delta));
    return resultado ? { posicion: resultado.posicion ?? 0, total: resultado.total ?? 0 } : null;
  }

  moverEjercicioADia(
    rutinaId: string,
    diaId: string,
    ejercicioId: string,
    diaDestinoId: string,
  ): { posicion: number; total: number } | null {
    this.limpiarQuitado();
    const resultado = this.aplicarOrden(
      moverEjercicioADia(this.estado().rutinas, rutinaId, diaId, ejercicioId, diaDestinoId),
    );
    return resultado ? { posicion: resultado.posicion ?? 0, total: resultado.total ?? 0 } : null;
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
