import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import nodemailer from 'nodemailer';

function archivoDePrueba(): string | null {
  const archivo = process.env['PULSO_CORREO_ARCHIVO'];
  return archivo && !process.env['VERCEL'] ? archivo : null;
}

function credenciales(): { usuario: string; clave: string } | null {
  const usuario = (process.env['CORREO_USUARIO'] ?? '').trim();
  const clave = (process.env['CORREO_CLAVE'] ?? '').trim();
  return usuario && clave ? { usuario, clave } : null;
}

export function correoConfigurado(): boolean {
  return archivoDePrueba() !== null || credenciales() !== null;
}

export async function enviarCodigo(para: string, codigo: string): Promise<void> {
  const archivo = archivoDePrueba();
  if (archivo) {
    await mkdir(dirname(archivo), { recursive: true });
    await appendFile(archivo, `${JSON.stringify({ para, codigo })}\n`, 'utf8');
    return;
  }
  const cred = credenciales();
  if (!cred) throw new Error('correo-sin-configurar');
  const transporte = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: cred.usuario, pass: cred.clave },
    connectionTimeout: 8000,
    socketTimeout: 8000,
  });
  await transporte.sendMail({
    from: `Pulso <${cred.usuario}>`,
    to: para,
    subject: 'Tu código para recuperar Pulso',
    text: [`Tu código es ${codigo}.`, 'Vence en 10 minutos.', 'Si no lo pediste, ignora este correo.'].join('\n'),
  });
}
