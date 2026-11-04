import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { hoyISO, modalidadDe } from './modelos';
import { PulsoService } from './pulso.service';
import { SesionService } from './sesion.service';

const AVISOS = 'pulso.avisos';

export interface AvisoCita {
  id: string;
  texto: string;
}

@Injectable({ providedIn: 'root' })
export class RecordatorioService {
  private readonly pulso = inject(PulsoService);
  private readonly sesion = inject(SesionService);
  readonly aviso = signal<AvisoCita | null>(null);
  readonly permiso = signal<NotificationPermission>(permisoActual());

  constructor() {
    effect(() => {
      this.sesion.esEntrenador();
      this.pulso.estado();
      untracked(() => this.revisar());
    });
    setInterval(() => this.revisar(), 15000);
  }

  activar(): void {
    if (typeof Notification === 'undefined') return;
    void Notification.requestPermission().then((valor) => this.permiso.set(valor));
  }

  private revisar(): void {
    if (!this.sesion.esEntrenador()) {
      this.aviso.set(null);
      return;
    }
    const ahora = new Date();
    const hoy = hoyISO();
    const minutosAhora = ahora.getHours() * 60 + ahora.getMinutes();
    const estado = this.pulso.estado();
    let visible: AvisoCita | null = null;
    for (const cita of estado.citas) {
      if (cita.fecha !== hoy || cita.estado === 'cancelada') continue;
      const cliente = estado.clientes.find((item) => item.id === cita.clienteId);
      if (!cliente || modalidadDe(cliente.modalidad) !== 'personalizado') continue;
      const [hora, minuto] = cita.hora.split(':').map(Number);
      if (!Number.isFinite(hora) || !Number.isFinite(minuto)) continue;
      const falta = hora * 60 + minuto - minutosAhora;
      if (falta < 0 || falta > 10) continue;
      const texto =
        falta === 0
          ? `Es ahora el personalizado de ${cliente.nombre}.`
          : `En ${falta} min el personalizado de ${cliente.nombre}, a las ${cita.hora}.`;
      if (!visible) visible = { id: cita.id, texto };
      const clave = `${cita.id}:${cita.fecha}`;
      if (yaAvisado(clave)) continue;
      marcar(clave);
      if (this.permiso() === 'granted' && typeof Notification !== 'undefined') {
        try {
          new Notification('Personalizado', { body: texto });
        } catch {
          /* el aviso de la pantalla sigue */
        }
      }
    }
    this.aviso.set(visible);
  }
}

function permisoActual(): NotificationPermission {
  if (typeof Notification === 'undefined') return 'denied';
  return Notification.permission;
}

function leidos(): string[] {
  try {
    const data = JSON.parse(sessionStorage.getItem(AVISOS) || '[]') as string[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function yaAvisado(clave: string): boolean {
  return leidos().includes(clave);
}

function marcar(clave: string): void {
  const lista = leidos();
  if (!lista.includes(clave)) lista.push(clave);
  sessionStorage.setItem(AVISOS, JSON.stringify(lista.slice(-80)));
}
