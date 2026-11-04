export interface Servicio {
  id: string;
  nombre: string;
  minutos: number;
  precio: number;
}

export type Modalidad = 'personalizado' | 'semipersonalizado' | 'virtual';

export const MODALIDADES: { id: Modalidad; nombre: string }[] = [
  { id: 'personalizado', nombre: 'Personalizado' },
  { id: 'semipersonalizado', nombre: 'Semipersonalizado' },
  { id: 'virtual', nombre: 'Virtual' },
];

export function modalidadDe(valor: string | undefined): Modalidad {
  if (valor === 'semipersonalizado' || valor === 'virtual' || valor === 'personalizado') return valor;
  return 'personalizado';
}

export function nombreModalidad(valor: string | undefined): string {
  return MODALIDADES.find((item) => item.id === modalidadDe(valor))?.nombre ?? 'Personalizado';
}

export interface Cliente {
  id: string;
  nombre: string;
  telefono: string;
  correo: string;
  objetivo: string;
  notas: string;
  peso: string;
  estatura: string;
  mensualidad: number;
  valoracionMensual: number;
  modalidad: Modalidad;
}

export interface AccesoCliente {
  clienteId: string;
  correo: string;
}

export interface Cita {
  id: string;
  servicioId: string;
  clienteId: string;
  fecha: string;
  hora: string;
  estado: 'pendiente' | 'realizada' | 'cancelada';
}

export interface Ejercicio {
  id: string;
  nombre: string;
  series: string;
  reps: string;
  descanso: string;
  imagen?: boolean;
}

export interface DiaRutina {
  id: string;
  nombre: string;
  ejercicios: Ejercicio[];
}

export interface Rutina {
  id: string;
  clienteId: string | null;
  nombre: string;
  precio: number;
  dias: DiaRutina[];
}

export interface FilaComida {
  id: string;
  momento: string;
  alimento: string;
  cantidad: string;
  nota: string;
}

export interface Tabla {
  id: string;
  clienteId: string | null;
  nombre: string;
  filas: FilaComida[];
}

export interface Pago {
  id: string;
  clienteId: string;
  tipo: 'mensualidad' | 'valoracion' | 'otro';
  periodo: string;
  concepto: string;
  valor: number;
  fecha: string;
  estado: 'pendiente' | 'pagado';
}

export interface Estado {
  servicios: Servicio[];
  horario: Record<string, [string, string][]>;
  clientes: Cliente[];
  citas: Cita[];
  rutinas: Rutina[];
  tablas: Tabla[];
  pagos: Pago[];
  accesos: AccesoCliente[];
}

export const DIAS = [
  { id: '1', nombre: 'Lunes' },
  { id: '2', nombre: 'Martes' },
  { id: '3', nombre: 'Miércoles' },
  { id: '4', nombre: 'Jueves' },
  { id: '5', nombre: 'Viernes' },
  { id: '6', nombre: 'Sábado' },
  { id: '0', nombre: 'Domingo' },
];

export const EJERCICIOS = [
  'Sentadilla',
  'Sentadilla goblet',
  'Sentadilla búlgara',
  'Peso muerto',
  'Peso muerto rumano',
  'Hip thrust',
  'Puente de glúteo',
  'Zancada',
  'Prensa',
  'Elevación de talones',
  'Press banca',
  'Press militar',
  'Remo con barra',
  'Remo en polea',
  'Jalón al pecho',
  'Dominadas',
  'Fondos',
  'Flexiones',
  'Curl de bíceps',
  'Extensión de tríceps',
  'Face pull',
  'Plancha',
  'Pallof',
  'Caminata inclinada',
  'Bicicleta',
  'Movilidad de cadera',
];

const FOTOS_EJERCICIO: Record<string, string> = {
  sentadilla: 'ejercicios/sentadilla.jpg',
  'sentadilla goblet': 'ejercicios/sentadilla-goblet.jpg',
  'sentadilla bulgara': 'ejercicios/sentadilla-bulgara.jpg',
  'peso muerto': 'ejercicios/peso-muerto.jpg',
  'peso muerto rumano': 'ejercicios/peso-muerto-rumano.jpg',
  'hip thrust': 'ejercicios/hip-thrust.jpg',
  'puente de gluteo': 'ejercicios/puente-gluteo.jpg',
  zancada: 'ejercicios/zancada.jpg',
  prensa: 'ejercicios/prensa.jpg',
  'elevacion de talones': 'ejercicios/elevacion-talones.jpg',
  'press banca': 'ejercicios/press-banca.jpg',
  'press militar': 'ejercicios/press-militar.jpg',
  'remo con barra': 'ejercicios/remo-barra.jpg',
  'remo en polea': 'ejercicios/remo-polea.jpg',
  'jalon al pecho': 'ejercicios/jalon-pecho.jpg',
  dominadas: 'ejercicios/dominadas.jpg',
  fondos: 'ejercicios/fondos.jpg',
  flexiones: 'ejercicios/flexiones.jpg',
  'curl de biceps': 'ejercicios/curl-biceps.jpg',
  'extension de triceps': 'ejercicios/extension-triceps.jpg',
  'face pull': 'ejercicios/face-pull.jpg',
  plancha: 'ejercicios/plancha.jpg',
  pallof: 'ejercicios/pallof.jpg',
  'caminata inclinada': 'ejercicios/caminata.jpg',
  bicicleta: 'ejercicios/bicicleta.jpg',
  'movilidad de cadera': 'ejercicios/movilidad-cadera.jpg',
};

export function imagenEjercicio(nombre: string): string {
  const clave = nombre
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return FOTOS_EJERCICIO[clave] ?? '';
}

export function llevaImagen(ejercicio: { nombre: string; imagen?: boolean }): boolean {
  return ejercicio.imagen !== false && imagenEjercicio(ejercicio.nombre) !== '';
}

export const MOMENTOS = [
  'Desayuno',
  'Media mañana',
  'Almuerzo',
  'Merienda',
  'Cena',
  'Pre-entreno',
  'Post-entreno',
];

export function uid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function fechaISO(fecha: Date): string {
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${fecha.getFullYear()}-${mes}-${dia}`;
}

export function hoyISO(): string {
  return fechaISO(new Date());
}

export function periodoActual(iso = hoyISO()): string {
  return iso.slice(0, 7);
}

export function etiquetaPeriodo(periodo: string): string {
  if (!/^\d{4}-\d{2}$/.test(periodo)) return '';
  return parseISO(`${periodo}-01`).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
}

export function parseISO(iso: string): Date {
  const [anio, mes, dia] = iso.split('-').map(Number);
  return new Date(anio, mes - 1, dia);
}

export function sumarDias(iso: string, dias: number): string {
  const fecha = parseISO(iso);
  fecha.setDate(fecha.getDate() + dias);
  return fechaISO(fecha);
}

export function etiquetaFecha(iso: string): string {
  return parseISO(iso).toLocaleDateString('es-CO', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export function pesos(valor: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(Number(valor) || 0);
}

function minutos(hora: string): number {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}

function horaTexto(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function horasLibres(estado: Estado, fecha: string, servicioId: string): string[] {
  const servicio = estado.servicios.find((item) => item.id === servicioId);
  if (!servicio || servicio.minutos <= 0) return [];

  const dia = String(parseISO(fecha).getDay());
  const bloques = estado.horario[dia] ?? [];
  const ocupadas = estado.citas.filter((cita) => cita.fecha === fecha && cita.estado !== 'cancelada');
  const ahora = new Date();
  const esHoy = fecha === hoyISO();
  const limite = ahora.getHours() * 60 + ahora.getMinutes();
  const libres: string[] = [];

  for (const [abre, cierra] of bloques) {
    if (!abre || !cierra) continue;
    const inicio = minutos(abre);
    const fin = minutos(cierra);
    for (let marca = inicio; marca + servicio.minutos <= fin; marca += 30) {
      if (esHoy && marca <= limite) continue;
      const choca = ocupadas.some((cita) => {
        const otro = estado.servicios.find((item) => item.id === cita.servicioId);
        const duracion = otro ? otro.minutos : 60;
        const empieza = minutos(cita.hora);
        return marca < empieza + duracion && empieza < marca + servicio.minutos;
      });
      if (!choca) libres.push(horaTexto(marca));
    }
  }

  return libres;
}

export function buscarCliente(estado: Estado, telefono: string, correo: string): Cliente | undefined {
  const tel = telefono.replace(/\s/g, '');
  const mail = correo.trim().toLowerCase();
  return estado.clientes.find((cliente) => {
    const mismoTel = tel && cliente.telefono.replace(/\s/g, '') === tel;
    const mismoMail = mail && cliente.correo.trim().toLowerCase() === mail;
    return mismoTel || mismoMail;
  });
}
