type Pointer = { active: boolean; x: number; y: number };

// Both layouts center the canvas image. Account for letterboxing (contain)
// and cropping (cover) before converting viewport coordinates to game pixels.
export function updateCanvasPointer(
  canvas: HTMLCanvasElement, pointer: Pointer,
  event: Pick<PointerEvent, "clientX" | "clientY">, begin = false,
) {
  const rect = canvas.getBoundingClientRect();
  const style = getComputedStyle(canvas);
  const left = rect.left + parseFloat(style.borderLeftWidth || "0");
  const top = rect.top + parseFloat(style.borderTopWidth || "0");
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) { pointer.active = false; return; }
  const scale = style.objectFit === "contain"
    ? Math.min(width / canvas.width, height / canvas.height)
    : Math.max(width / canvas.width, height / canvas.height);
  const imageWidth = style.objectFit === "fill" ? width : canvas.width * scale;
  const imageHeight = style.objectFit === "fill" ? height : canvas.height * scale;
  const x = (event.clientX - left - (width - imageWidth) / 2) * canvas.width / imageWidth;
  const y = (event.clientY - top - (height - imageHeight) / 2) * canvas.height / imageHeight;
  // A new gesture in the letterbox must not steer the submarine.
  if (begin) pointer.active = x >= 0 && x <= canvas.width && y >= 0 && y <= canvas.height;
  if (!pointer.active) return;
  pointer.x = Math.max(0, Math.min(canvas.width, x));
  pointer.y = Math.max(0, Math.min(canvas.height, y));
}
