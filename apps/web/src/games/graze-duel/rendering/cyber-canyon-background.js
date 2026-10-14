export function createCyberCanyonBackground(width, height) {
  const tile = document.createElement("canvas");
  tile.width = width;
  tile.height = height * 2;
  const tileContext = tile.getContext("2d");
  if (tileContext) {
    tileContext.lineWidth = 1;
    for (const side of [-1, 1]) {
      for (let contour = 0; contour < 24; contour += 1) {
        const depth = contour / 23;
        tileContext.strokeStyle = `rgba(72, 187, 217, ${0.18 + depth * 0.1})`;
        tileContext.beginPath();
        for (let sample = 0; sample <= 256; sample += 1) {
          const progress = sample / 256;
          const phase = progress * Math.PI * 2;
          const bank = 0.28 + depth * 0.28;
          const ridge = Math.sin(phase * 3 + side * 1.2 + depth * 2) * 0.05
            + Math.sin(phase * 7 + depth * 3.1) * 0.027
            + Math.sin(phase + depth * 0.8) * 0.04
            + Math.sin(phase * 19 + depth * 2.4 + side) * 0.006;
          const terrace = Math.tanh(Math.sin(phase * 4 + depth * 1.7 + side) * 2) * 0.025;
          const bankDistance = Math.max(0.24 + depth * 0.15, bank + ridge + terrace);
          const horizontal = width * (0.5 + side * bankDistance);
          const vertical = progress * tile.height;
          if (sample === 0) tileContext.moveTo(horizontal, vertical);
          else tileContext.lineTo(horizontal, vertical);
        }
        tileContext.stroke();
      }
    }
  }

  return {
    draw(context, fieldX, fieldTop, elapsed) {
      context.save();
      context.translate(fieldX, fieldTop);
      const scrollTime = elapsed * 2.5;
      const offset = (scrollTime * 46) % tile.height;
      context.drawImage(tile, 0, offset - tile.height);
      context.drawImage(tile, 0, offset);

      context.lineWidth = 0.9;
      for (const side of [-1, 1]) {
        for (let index = 0; index < 12; index += 1) {
          const phase = (scrollTime * (0.3 + index % 3 * 0.025) + index * 0.618) % 1;
          const distance = Math.pow(phase, 1.55);
          const lateral = 0.33 + (index % 4) * 0.045;
          const horizontal = width * (0.5 + side * lateral * (0.72 + distance * 0.28));
          const vertical = distance * (height + 48) - 24;
          const length = 5 + distance * (18 + index % 3 * 6);
          context.strokeStyle = `rgba(83, 196, 218, ${0.1 + distance * 0.12})`;
          context.beginPath();
          context.moveTo(horizontal, vertical - length);
          context.lineTo(horizontal, vertical);
          context.stroke();
        }
      }
      context.restore();
    },
    dispose() {
      tile.width = 0;
      tile.height = 0;
    },
  };
}
