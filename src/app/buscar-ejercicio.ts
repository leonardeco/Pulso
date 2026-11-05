import { Rutina } from './modelos';

export type OrigenEjercicio = 'reciente' | 'catalogo';

export interface CoincidenciaEjercicio {
  nombre: string;
  origen: OrigenEjercicio;
}

export interface ResultadoBusqueda {
  resultados: CoincidenciaEjercicio[];
  crear: string | null;
}

export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export const LARGO_MAXIMO_NOMBRE = 80;
const MAXIMO_RECIENTES_SIN_CONSULTA = 6;

export function limpiarNombre(texto: string): string {
  return texto.replace(/\s+/g, ' ').trim().slice(0, LARGO_MAXIMO_NOMBRE).trim();
}

export const ALIAS: Record<string, string[]> = {
  Sentadilla: ['squat', 'back squat', 'sentadillas'],
  'Sentadilla goblet': ['goblet squat', 'goblet'],
  'Sentadilla búlgara': ['bulgarian split squat', 'bulgarian squat', 'split squat'],
  'Peso muerto': ['deadlift', 'dead lift'],
  'Peso muerto rumano': ['romanian deadlift', 'rdl'],
  'Hip thrust': ['empuje de cadera', 'thrust'],
  'Puente de glúteo': ['glute bridge', 'puente de gluteos'],
  Zancada: ['lunge', 'lunges', 'zancadas', 'estocada', 'desplante'],
  Prensa: ['leg press', 'prensa de piernas'],
  'Elevación de talones': ['calf raise', 'calf raises', 'gemelos', 'pantorrillas'],
  'Press banca': ['bench press', 'bench', 'press de banca'],
  'Press militar': ['overhead press', 'shoulder press', 'military press', 'ohp'],
  'Remo con barra': ['barbell row', 'bent over row', 'row'],
  'Remo en polea': ['cable row', 'seated row', 'row', 'remo sentado'],
  'Jalón al pecho': ['lat pulldown', 'pulldown', 'jalon'],
  Dominadas: ['pull up', 'pull-up', 'pullup', 'pull ups', 'chin up', 'dominada'],
  Fondos: ['dip', 'dips'],
  Flexiones: ['push up', 'push-up', 'pushup', 'push ups', 'lagartijas', 'flexion'],
  'Curl de bíceps': ['biceps curl', 'bicep curl', 'curl', 'curl de biceps con mancuernas'],
  'Extensión de tríceps': ['triceps extension', 'tricep extension', 'triceps pushdown', 'extension de triceps'],
  'Face pull': ['jalon a la cara'],
  Plancha: ['plank', 'plancha abdominal'],
  Pallof: ['pallof press'],
  'Caminata inclinada': ['incline walk', 'incline treadmill', 'treadmill', 'cinta'],
  Bicicleta: ['bike', 'cycling', 'stationary bike', 'spinning'],
  'Movilidad de cadera': ['hip mobility', 'hip opener'],
};

const ALIAS_NORMALIZADOS: Map<string, string[]> = new Map(
  Object.entries(ALIAS).map(([nombre, alias]) => [normalizar(nombre), alias.map(normalizar)]),
);

export function recientes(rutinas: Rutina[]): string[] {
  const vistos = new Set<string>();
  const nombres: string[] = [];
  for (let r = rutinas.length - 1; r >= 0; r--) {
    const dias = rutinas[r].dias;
    for (let d = dias.length - 1; d >= 0; d--) {
      const ejercicios = dias[d].ejercicios;
      for (let e = ejercicios.length - 1; e >= 0; e--) {
        const nombre = ejercicios[e].nombre.trim();
        const clave = normalizar(nombre);
        if (!clave || vistos.has(clave)) continue;
        vistos.add(clave);
        nombres.push(nombre);
      }
    }
  }
  return nombres;
}

export function buscarEjercicios(entrada: {
  consulta: string;
  recientes: string[];
  catalogo: readonly string[];
  max?: number;
}): ResultadoBusqueda {
  const max = entrada.max ?? 8;
  const consulta = limpiarNombre(entrada.consulta);
  const q = normalizar(consulta);

  const candidatos: CoincidenciaEjercicio[] = [];
  const vistos = new Set<string>();
  const agregar = (nombre: string, origen: OrigenEjercicio) => {
    const clave = normalizar(nombre);
    if (!clave || vistos.has(clave)) return;
    vistos.add(clave);
    candidatos.push({ nombre, origen });
  };

  if (!q) {
    for (const nombre of entrada.recientes.slice(0, MAXIMO_RECIENTES_SIN_CONSULTA)) agregar(nombre, 'reciente');
    for (const nombre of entrada.catalogo) agregar(nombre, 'catalogo');
    return { resultados: candidatos, crear: null };
  }

  for (const nombre of entrada.recientes) agregar(nombre, 'reciente');
  for (const nombre of entrada.catalogo) agregar(nombre, 'catalogo');

  const exactos: CoincidenciaEjercicio[] = [];
  const empiezan: CoincidenciaEjercicio[] = [];
  const contienen: CoincidenciaEjercicio[] = [];
  for (const candidato of candidatos) {
    const clave = normalizar(candidato.nombre);
    if (clave === q) {
      exactos.push(candidato);
    } else if (clave.startsWith(q)) {
      empiezan.push(candidato);
    } else if (clave.includes(q) || (ALIAS_NORMALIZADOS.get(clave) ?? []).some((alias) => alias.includes(q))) {
      contienen.push(candidato);
    }
  }

  return {
    resultados: [...exactos, ...empiezan, ...contienen].slice(0, max),
    crear: vistos.has(q) ? null : consulta,
  };
}
