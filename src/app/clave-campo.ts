export function subirCampoClave(campo: EventTarget | null): void {
  if (!(campo instanceof HTMLElement)) return;
  const destino = campo.closest('label') ?? campo;
  const subir = () => destino.scrollIntoView({ block: 'start', behavior: 'auto' });
  requestAnimationFrame(() => {
    subir();
    window.setTimeout(subir, 80);
    window.setTimeout(subir, 400);
  });
}
