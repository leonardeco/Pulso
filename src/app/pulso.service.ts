import { Injectable, effect, signal } from '@angular/core';
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
  periodoActual,
  sumarDias,
  uid,
} from './modelos';

const CLAVE = 'pulso.estado.v1';

function jornada(): [string, string][] {
  return [
    ['06:00', '12:00'],
    ['14:00', '19:00'],
  ];
}

function ejemplo(): Estado {
  const ana = uid();
  const diego = uid();
  const valoracion = uid();
  const sesion = uid();
  const seguimiento = uid();
  const hoy = hoyISO();
  const mes = periodoActual(hoy);
  const manana = sumarDias(hoy, 1);

  return {
    servicios: [
      { id: valoracion, nombre: 'Valoración', minutos: 45, precio: 60000 },
      { id: sesion, nombre: 'Sesión de entrenamiento', minutos: 60, precio: 80000 },
      { id: seguimiento, nombre: 'Seguimiento', minutos: 30, precio: 40000 },
    ],
    horario: {
      '1': jornada(),
      '2': jornada(),
      '3': jornada(),
      '4': jornada(),
      '5': jornada(),
      '6': [['07:00', '12:00']],
      '0': [],
    },
    clientes: [
      {
        id: ana,
        nombre: 'Ana Ríos',
        telefono: '3001112233',
        correo: 'ana@correo.com',
        objetivo: 'Ganar fuerza y moverse sin miedo de la rodilla',
        notas: 'Molestia leve en la rodilla derecha. Las primeras semanas, poco impacto.',
        peso: '64',
        estatura: '165',
        mensualidad: 220000,
        valoracionMensual: 60000,
      },
      {
        id: diego,
        nombre: 'Diego Pardo',
        telefono: '3015556677',
        correo: 'diego@correo.com',
        objetivo: 'Bajar grasa sin dejar el fútbol de los martes',
        notas: 'Juega los martes en la noche. Ese día la sesión va más suave.',
        peso: '82',
        estatura: '178',
        mensualidad: 280000,
        valoracionMensual: 60000,
      },
    ],
    citas: [
      { id: uid(), servicioId: sesion, clienteId: ana, fecha: hoy, hora: '07:00', estado: 'pendiente' },
      { id: uid(), servicioId: seguimiento, clienteId: diego, fecha: manana, hora: '16:00', estado: 'pendiente' },
    ],
    rutinas: [
      {
        id: uid(),
        clienteId: ana,
        nombre: 'Base de fuerza',
        dias: [
          {
            id: uid(),
            nombre: 'Tren inferior',
            ejercicios: [
              { id: uid(), nombre: 'Sentadilla goblet', series: '3', reps: '8', descanso: '90s' },
              { id: uid(), nombre: 'Puente de glúteo', series: '3', reps: '12', descanso: '60s' },
              { id: uid(), nombre: 'Plancha', series: '3', reps: '30s', descanso: '45s' },
            ],
          },
          {
            id: uid(),
            nombre: 'Tren superior',
            ejercicios: [
              { id: uid(), nombre: 'Press banca', series: '3', reps: '8', descanso: '90s' },
              { id: uid(), nombre: 'Remo con barra', series: '3', reps: '10', descanso: '75s' },
            ],
          },
        ],
      },
      {
        id: uid(),
        clienteId: null,
        nombre: 'Plantilla full body',
        dias: [
          {
            id: uid(),
            nombre: 'Día A',
            ejercicios: [
              { id: uid(), nombre: 'Sentadilla', series: '3', reps: '8', descanso: '90s' },
              { id: uid(), nombre: 'Press banca', series: '3', reps: '8', descanso: '90s' },
              { id: uid(), nombre: 'Remo con barra', series: '3', reps: '10', descanso: '75s' },
            ],
          },
        ],
      },
    ],
    tablas: [
      {
        id: uid(),
        clienteId: diego,
        nombre: 'Día de entrenamiento',
        filas: [
          { id: uid(), momento: 'Desayuno', alimento: 'Arepa con huevos y aguacate', cantidad: '1 arepa y 2 huevos', nota: '' },
          { id: uid(), momento: 'Almuerzo', alimento: 'Arroz, frijoles y pechuga', cantidad: '1 plato', nota: 'Poca fritura' },
          { id: uid(), momento: 'Cena', alimento: 'Pescado con ensalada', cantidad: '1 porción', nota: '' },
        ],
      },
    ],
    pagos: [
      { id: uid(), clienteId: ana, tipo: 'mensualidad', periodo: mes, concepto: 'Mensualidad', valor: 220000, fecha: hoy, estado: 'pendiente' },
      { id: uid(), clienteId: ana, tipo: 'valoracion', periodo: mes, concepto: 'Valoración del mes', valor: 60000, fecha: hoy, estado: 'pendiente' },
      { id: uid(), clienteId: diego, tipo: 'mensualidad', periodo: mes, concepto: 'Mensualidad', valor: 280000, fecha: hoy, estado: 'pagado' },
      { id: uid(), clienteId: diego, tipo: 'valoracion', periodo: mes, concepto: 'Valoración del mes', valor: 60000, fecha: hoy, estado: 'pagado' },
    ],
  };
}

function normalizar(data: Estado): Estado {
  return {
    ...data,
    clientes: data.clientes.map((cliente) => ({
      ...cliente,
      mensualidad: Number(cliente.mensualidad) || 0,
      valoracionMensual: Number(cliente.valoracionMensual) || 0,
    })),
    pagos: (data.pagos ?? []).map((pago) => ({
      ...pago,
      tipo: pago.tipo ?? 'otro',
      periodo: pago.periodo ?? '',
    })),
  };
}

function leer(): Estado {
  try {
    const texto = localStorage.getItem(CLAVE);
    if (!texto) return ejemplo();
    const data = JSON.parse(texto) as Estado;
    if (!data || !Array.isArray(data.clientes) || !Array.isArray(data.servicios)) return ejemplo();
    return normalizar(data);
  } catch {
    return ejemplo();
  }
}

@Injectable({ providedIn: 'root' })
export class PulsoService {
  readonly estado = signal<Estado>(leer());

  constructor() {
    effect(() => {
      localStorage.setItem(CLAVE, JSON.stringify(this.estado()));
    });
  }

  reiniciar(): void {
    localStorage.removeItem(CLAVE);
    this.estado.set(leer());
  }

  agregarCliente(datos: Pick<Cliente, 'nombre' | 'telefono' | 'correo' | 'objetivo'>): string {
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

  nuevaRutina(clienteId: string | null): void {
    const rutina: Rutina = {
      id: uid(),
      clienteId,
      nombre: clienteId ? 'Rutina nueva' : 'Plantilla nueva',
      dias: [{ id: uid(), nombre: 'Día 1', ejercicios: [] }],
    };
    this.estado.update((actual) => ({ ...actual, rutinas: [...actual.rutinas, rutina] }));
  }

  cambiarRutina(id: string, cambios: Partial<Pick<Rutina, 'nombre'>>): void {
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
    const ejercicio: Ejercicio = { id: uid(), nombre: 'Sentadilla', series: '3', reps: '10', descanso: '60s' };
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
