// Physical export layout, independent of WebGL and the live camera.
import { MAX_EXPORT_DPI } from './model.js';

export const EXPORT_SIDE_CAP = 8192;
export const EXPORT_PIXEL_CAP = 32_000_000;

export function validateCaptureSize(width, height, dpi, limit = EXPORT_SIDE_CAP) {
  if (![width, height].every(Number.isInteger) || width < 1 || height < 1 ||
      width > limit || height > limit) {
    throw new Error("Reduce the figure size or DPI to fit this device's export limit.");
  }
  if (width * height > EXPORT_PIXEL_CAP) {
    throw new Error('Exports support up to 32 million pixels. Reduce the figure size or DPI.');
  }
  if (!Number.isInteger(dpi) || dpi < 72 || dpi > MAX_EXPORT_DPI) {
    throw new Error('Use an integer resolution from 72 to 5,000 DPI.');
  }
}

export function physicalGapPixels(dpi, centimetres = 1) {
  if (!Number.isFinite(dpi) || dpi <= 0 || !Number.isFinite(centimetres) || centimetres < 0) {
    throw new Error('Invalid physical legend spacing.');
  }
  return Math.round(dpi * centimetres / 2.54);
}

export function fitExportFrame({ width, height, bounds, atomLeft, targetLeft, margin, leftGuard }) {
  const values = [width, height, bounds.minX, bounds.maxX, bounds.minY, bounds.maxY,
    atomLeft, targetLeft, margin, leftGuard];
  if (!values.every(Number.isFinite) || bounds.minX > bounds.maxX ||
      bounds.minY > bounds.maxY || width <= margin * 2 || height <= margin * 2 ||
      targetLeft <= leftGuard || targetLeft >= width - margin - 1) {
    throw new Error('Increase the figure dimensions or turn off the legend to fit the structure.');
  }
  const scales = [
    (height - margin * 2) / Math.max(bounds.maxY - bounds.minY, 1e-8),
    (width - margin - 1 - targetLeft) / Math.max(bounds.maxX - atomLeft, 1e-8),
  ];
  if (atomLeft > bounds.minX) scales.push((targetLeft - leftGuard) / (atomLeft - bounds.minX));
  const scale = Math.min(...scales);
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('The structure cannot fit the figure.');
  const left = atomLeft - targetLeft / scale;
  const middleY = (bounds.minY + bounds.maxY) / 2;
  return { left, right: left + width / scale, top: middleY + height / scale / 2,
    bottom: middleY - height / scale / 2, scale };
}

export function scanAlphaBounds(ctx, width, height, region = {}) {
  const x = Math.max(0, Math.floor(region.x ?? 0));
  const y = Math.max(0, Math.floor(region.y ?? 0));
  const scanWidth = Math.max(0, Math.min(width - x, Math.ceil(region.width ?? width)));
  const scanHeight = Math.max(0, Math.min(height - y, Math.ceil(region.height ?? height)));
  if (!scanWidth || !scanHeight) return null;
  let left = Infinity, top = Infinity, right = -1, bottom = -1;
  for (let row = 0; row < scanHeight; row += 32) {
    const rows = Math.min(32, scanHeight - row);
    const pixels = ctx.getImageData(x, y + row, scanWidth, rows).data;
    for (let py = 0; py < rows; py++) {
      for (let px = 0; px < scanWidth; px++) {
        if (!pixels[(py * scanWidth + px) * 4 + 3]) continue;
        const actualX = x + px, actualY = y + row + py;
        if (actualX < left) left = actualX;
        if (actualX > right) right = actualX;
        if (actualY < top) top = actualY;
        if (actualY > bottom) bottom = actualY;
      }
    }
  }
  return right < 0 ? null : { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1 };
}

export function translateBounds(bounds, dx, dy = 0) {
  return bounds ? { ...bounds, left: bounds.left + dx, right: bounds.right + dx,
    top: bounds.top + dy, bottom: bounds.bottom + dy } : null;
}

export function alignRasterBounds({ legendBounds, atomBounds, sceneBounds, gapPixels, width, height }) {
  if (!sceneBounds) throw new Error('There is no visible structure to export.');
  const reference = atomBounds || sceneBounds;
  const targetLeft = legendBounds ? legendBounds.right + gapPixels + 1 : reference.left;
  const dx = targetLeft - reference.left;
  const placedScene = translateBounds(sceneBounds, dx);
  if (placedScene.left < 0 || placedScene.right >= width ||
      placedScene.top < 0 || placedScene.bottom >= height ||
      (legendBounds && placedScene.left <= legendBounds.right)) {
    throw new Error('Increase the figure dimensions or hide the cell/axes to fit the legend and structure.');
  }
  return { dx, sceneBounds: placedScene, atomBounds: translateBounds(atomBounds, dx),
    referenceBounds: translateBounds(reference, dx), gapPixels: legendBounds ? gapPixels : null,
    gapReference: atomBounds ? 'atoms' : 'visible-geometry' };
}
