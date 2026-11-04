import { neon } from '@neondatabase/serverless';

export type Fila = Record<string, unknown>;
type Consulta = (strings: TemplateStringsArray, ...valores: unknown[]) => Promise<Fila[]>;

let cliente: Consulta | null = null;

export function sql(): Consulta {
  if (!cliente) {
    const url = process.env['DATABASE_URL'];
    if (!url) throw new Error('Falta DATABASE_URL');
    cliente = neon(url) as unknown as Consulta;
  }
  return cliente;
}
