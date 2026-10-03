// Screen and exported legends share the same shaded sphere artwork.
function shade(color, target, amount) {
  const rgb = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16));
  return 'rgb(' + rgb.map(value => Math.round(value + (target - value) * amount)).join(',') + ')';
}

export function drawLegendBall(ctx, x, y, radius, color) {
  ctx.save();
  const surface = ctx.createRadialGradient(x - radius * .2, y - radius * .25, radius * .03, x - radius * .02, y - radius * .04, radius * 1.06);
  surface.addColorStop(0, shade(color, 255, .26));
  surface.addColorStop(.32, shade(color, 255, .1));
  surface.addColorStop(.58, color);
  surface.addColorStop(.85, shade(color, 0, .44));
  surface.addColorStop(1, shade(color, 0, .78));
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = surface;
  ctx.fill();
  ctx.strokeStyle = shade(color, 0, .65);
  ctx.lineWidth = Math.max(.6, radius * .045);
  ctx.stroke();
  ctx.clip();
  const highlight = ctx.createRadialGradient(x - radius * .22, y - radius * .27, 0, x - radius * .22, y - radius * .27, radius * .34);
  highlight.addColorStop(0, 'rgba(255,255,255,0.3)');
  highlight.addColorStop(.5, 'rgba(255,255,255,0.1)');
  highlight.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = highlight;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  ctx.restore();
}

export function paintLegendBall(canvas, color) {
  const size = 38, ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
  canvas.width = Math.round(size * ratio);
  canvas.height = Math.round(size * ratio);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  drawLegendBall(ctx, size / 2, size / 2, size * .46, color);
}

export function layoutElementLegend(ctx, elements, width, height) {
  if (!elements.length) return { width: 0, columns: [] };
  const initialFont = Math.max(12, Math.round(Math.min(width, height) * .057));
  const minimumFont = Math.max(6, Math.floor(initialFont * .52));
  ctx.save();
  try {
    for (let font = initialFont; font >= minimumFont; font--) {
      const padding = Math.max(6, font * .8), radius = font * .48, gap = font * .85;
      const lineHeight = font * 1.55, rowsPerColumn = Math.floor((height - padding * 2) / lineHeight);
      if (rowsPerColumn < 1) continue;
      ctx.font = font + 'px system-ui';
      const columns = [];
      for (let offset = 0; offset < elements.length; offset += rowsPerColumn) {
        const entries = elements.slice(offset, offset + rowsPerColumn).map(element => ({ element, label: element.symbol }));
        const columnWidth = radius * 2 + font * .55 + Math.max(...entries.map(entry => ctx.measureText(entry.label).width));
        columns.push({ width: columnWidth, entries });
      }
      const legendWidth = Math.ceil(padding * 2 + columns.reduce((sum, column) => sum + column.width, 0) + gap * (columns.length - 1));
      if (legendWidth <= Math.floor(width * .32)) {
        return { width: legendWidth, font, radius, padding, lineHeight, gap, columns };
      }
    }
    throw new Error('Increase the figure dimensions or turn off the element legend to fit all labels.');
  } finally { ctx.restore(); }
}

export function drawElementLegend(ctx, layout, colors) {
  if (!layout.width) return;
  ctx.save();
  ctx.font = layout.font + 'px system-ui';
  ctx.textBaseline = 'middle';
  let x = layout.padding;
  for (const column of layout.columns) {
    for (const [index, entry] of column.entries.entries()) {
      const y = layout.padding + layout.lineHeight * (index + .5);
      drawLegendBall(ctx, x + layout.radius, y, layout.radius, colors[entry.element.symbol] || entry.element.color);
      ctx.fillStyle = '#151c1f';
      ctx.fillText(entry.label, x + layout.radius * 2 + layout.font * .55, y);
    }
    x += column.width + layout.gap;
  }
  ctx.restore();
}
