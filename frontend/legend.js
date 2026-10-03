// Screen and exported legends share the same shaded sphere artwork.
function shade(color, target, amount) {
  const rgb = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16));
  return 'rgb(' + rgb.map(value => Math.round(value + (target - value) * amount)).join(',') + ')';
}

export function drawLegendBall(ctx, x, y, radius, color) {
  ctx.save();
  ctx.fillStyle = 'rgba(20,35,40,0.18)';
  ctx.beginPath();
  ctx.ellipse(x, y + radius * .88, radius * .78, radius * .18, 0, 0, Math.PI * 2);
  ctx.fill();
  const surface = ctx.createRadialGradient(x - radius * .34, y - radius * .38, radius * .04, x - radius * .08, y - radius * .06, radius * 1.25);
  surface.addColorStop(0, shade(color, 255, .82));
  surface.addColorStop(.25, shade(color, 255, .28));
  surface.addColorStop(.52, color);
  surface.addColorStop(.8, shade(color, 0, .35));
  surface.addColorStop(1, shade(color, 0, .68));
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = surface;
  ctx.fill();
  ctx.strokeStyle = shade(color, 0, .48);
  ctx.lineWidth = Math.max(.5, radius * .06);
  ctx.stroke();
  ctx.clip();
  const highlight = ctx.createRadialGradient(x - radius * .35, y - radius * .42, 0, x - radius * .35, y - radius * .42, radius * .42);
  highlight.addColorStop(0, 'rgba(255,255,255,0.8)');
  highlight.addColorStop(.4, 'rgba(255,255,255,0.28)');
  highlight.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = highlight;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  ctx.restore();
}

export function paintLegendBall(canvas, color) {
  const size = 22, ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
  canvas.width = Math.round(size * ratio);
  canvas.height = Math.round(size * ratio);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  drawLegendBall(ctx, size / 2, size * .46, size * .4, color);
}

export function layoutElementLegend(ctx, elements, width, height) {
  if (!elements.length) return { height: 0, rows: [] };
  const initialFont = Math.max(12, Math.round(Math.min(width, height) * .023));
  const minimumFont = Math.max(6, Math.floor(initialFont * .55));
  ctx.save();
  try {
    for (let font = initialFont; font >= minimumFont; font--) {
      const padding = font * 1.2, radius = font * .62, gap = font * 1.5;
      const lineHeight = font * 1.8, available = width - padding * 2;
      ctx.font = font + 'px system-ui';
      const rows = []; let row = { width: 0, entries: [] }, fits = true;
      for (const element of elements) {
        const label = element.symbol + ' (' + element.count + ')';
        const entryWidth = radius * 2 + font * .55 + ctx.measureText(label).width;
        if (entryWidth > available) { fits = false; break; }
        if (row.entries.length && row.width + gap + entryWidth > available) {
          rows.push(row); row = { width: 0, entries: [] };
        }
        row.width += (row.entries.length ? gap : 0) + entryWidth;
        row.entries.push({ element, label, width: entryWidth });
      }
      if (row.entries.length) rows.push(row);
      const headerHeight = Math.ceil(padding * 2 + rows.length * lineHeight);
      if (fits && headerHeight <= Math.floor(height * .35)) {
        return { height: headerHeight, width, font, radius, padding, lineHeight, gap, rows };
      }
    }
    throw new Error('Increase the figure dimensions or turn off the element legend to fit all labels.');
  } finally { ctx.restore(); }
}

export function drawElementLegend(ctx, layout, colors) {
  if (!layout.height) return;
  ctx.save();
  ctx.font = layout.font + 'px system-ui';
  ctx.textBaseline = 'middle';
  for (const [index, row] of layout.rows.entries()) {
    let x = (layout.width - row.width) / 2;
    const y = layout.padding + layout.lineHeight * (index + .5);
    for (const entry of row.entries) {
      drawLegendBall(ctx, x + layout.radius, y, layout.radius, colors[entry.element.symbol] || entry.element.color);
      ctx.fillStyle = '#213b40';
      ctx.fillText(entry.label, x + layout.radius * 2 + layout.font * .55, y);
      x += entry.width + layout.gap;
    }
  }
  ctx.restore();
}
