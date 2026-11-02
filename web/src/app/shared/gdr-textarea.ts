/** Mantiene il punto di lavoro quando Angular aggiorna il testo tramite la toolbar. */
export function updateGdrTextarea(
  area: HTMLTextAreaElement,
  update: () => void,
  selectionStart: number,
  selectionEnd: number,
): void {
  const top = area.scrollTop, left = area.scrollLeft;
  update();
  requestAnimationFrame(() => {
    if (!area.isConnected) return;
    area.setSelectionRange(selectionStart, selectionEnd);
    area.focus({ preventScroll: true });
    area.scrollTop = top;
    area.scrollLeft = left;
  });
}
