import type { Rutina, Tabla } from './modelos';

function esc(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function hoja(titulo: string, cuerpo: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>${esc(titulo)}</title>
  <style>
    @page { margin: 14mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #141820; font-family: "Segoe UI", sans-serif; font-size: 14px; }
    .marca { margin: 0 0 4px; color: #e84e12; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; }
    h1 { margin: 0 0 4px; font-size: 24px; }
    h2 { margin: 18px 0 8px; font-size: 16px; }
    .cliente { margin: 0 0 14px; color: #5e6878; }
    .dia { margin: 0 0 8px; }
    .item { margin: 0 0 12px; break-inside: avoid; }
    strong { display: block; }
    small { color: #5e6878; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 7px 6px; border-bottom: 1px solid #d5dbe3; text-align: left; vertical-align: top; }
    th { color: #5e6878; font-size: 12px; }
  </style>
</head>
<body>${cuerpo}</body>
</html>`;
}

export function htmlRutinas(cliente: string, rutinas: Rutina[]): string {
  const bloques = rutinas
    .map((rutina) => {
      const dias = rutina.dias
        .map((dia) => {
          const items = dia.ejercicios
            .map((ejercicio) => {
              const detalle = `${esc(ejercicio.series || '—')} series · ${esc(ejercicio.reps || '—')} reps · descanso ${esc(ejercicio.descanso || '—')}`;
              return `<div class="item"><strong>${esc(ejercicio.nombre)}</strong><small>${detalle}</small></div>`;
            })
            .join('');
          return `<section class="dia"><h2>${esc(dia.nombre)}</h2>${items || '<p>Sin ejercicios.</p>'}</section>`;
        })
        .join('');
      return `<h1>${esc(rutina.nombre || 'Rutina')}</h1>${dias || '<p>Sin días.</p>'}`;
    })
    .join('');
  const titulo = rutinas.length === 1 ? rutinas[0].nombre || 'Rutina' : 'Rutina';
  return hoja(`${titulo} - ${cliente}`, `<p class="marca">PULSO ENTRENADORES</p><p class="cliente">${esc(cliente)}</p>${bloques}`);
}

export function htmlTablas(cliente: string, tablas: Tabla[]): string {
  const bloques = tablas
    .map((tabla) => {
      const filas = tabla.filas
        .map(
          (fila) =>
            `<tr><td>${esc(fila.momento)}</td><td>${esc(fila.alimento)}</td><td>${esc(fila.cantidad)}</td><td>${esc(fila.nota)}</td></tr>`,
        )
        .join('');
      return `<h1>${esc(tabla.nombre || 'Alimentación')}</h1>
        <table>
          <thead><tr><th>Momento</th><th>Alimento</th><th>Cantidad</th><th>Nota</th></tr></thead>
          <tbody>${filas || '<tr><td colspan="4">Sin comidas.</td></tr>'}</tbody>
        </table>`;
    })
    .join('');
  const titulo = tablas.length === 1 ? tablas[0].nombre || 'Alimentación' : 'Alimentación';
  return hoja(`${titulo} - ${cliente}`, `<p class="marca">PULSO ENTRENADORES</p><p class="cliente">${esc(cliente)}</p>${bloques}`);
}

export function abrirPdf(titulo: string, html: string): void {
  const marco = document.createElement('iframe');
  marco.setAttribute('title', titulo);
  marco.style.cssText = 'position:fixed;inset:0;width:100%;height:0;border:0';
  document.body.appendChild(marco);
  const doc = marco.contentDocument;
  const vista = marco.contentWindow;
  if (!doc || !vista) {
    marco.remove();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  const imagenes = [...doc.images];
  const listas = imagenes.map(
    (img) =>
      new Promise<void>((resolver) => {
        if (img.complete) {
          resolver();
          return;
        }
        img.onload = () => resolver();
        img.onerror = () => resolver();
      }),
  );
  void Promise.all(listas).then(() => {
    vista.focus();
    vista.print();
    const quitar = () => marco.remove();
    vista.addEventListener('afterprint', quitar);
    setTimeout(quitar, 60000);
  });
}
