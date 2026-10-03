import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCaptureSize, physicalGapPixels, fitExportFrame, scanAlphaBounds, alignRasterBounds } from '../frontend/export-layout.js';
import { layoutElementLegend } from '../frontend/legend.js';

const box = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left + 1, height: bottom - top + 1 });

test('physical spacing is quantized to the nearest pixel and aligned at export DPI', () => {
  for (const dpi of [300, 600, 1200, 2400]) {
    const gapPixels = physicalGapPixels(dpi, 1);
    assert.ok(Math.abs(gapPixels - dpi / 2.54) <= 0.5);
    const legendBounds = box(10, 10, 35, 80);
    const aligned = alignRasterBounds({ legendBounds, atomBounds: box(80, 50, 240, 250), sceneBounds: box(65, 35, 260, 260), gapPixels, width: 1600, height: 1600 });
    assert.equal(aligned.atomBounds.left - legendBounds.right - 1, gapPixels);
    assert.ok(aligned.sceneBounds.right < 1600);
    assert.equal(aligned.gapReference, 'atoms');
  }
});

test('asymmetric export framing includes geometry and aligns atom extent', () => {
  const bounds = { minX: -4, maxX: 12, minY: -3, maxY: 7 };
  const frame = fitExportFrame({ width: 2000, height: 1500, bounds, atomLeft: -1, targetLeft: 500, margin: 60, leftGuard: 220 });
  const px = x => (x - frame.left) * frame.scale;
  const py = y => (frame.top - y) * frame.scale;
  assert.ok(Math.abs(px(-1) - 500) < 1e-8);
  assert.ok(px(bounds.minX) >= 220 - 1e-8);
  assert.ok(px(bounds.maxX) <= 1940 + 1e-8);
  assert.ok(py(bounds.maxY) >= 60 - 1e-8);
  assert.ok(py(bounds.minY) <= 1440 + 1e-8);
  assert.throws(() => fitExportFrame({ width: 50, height: 50, bounds, atomLeft: -1, targetLeft: 70, margin: 8, leftGuard: 20 }));
});

test('alpha scan includes antialiasing pixels, honors regions, and reads bounded strips', () => {
  const width = 50;
  const height = 80;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (const [x, y, alpha] of [[6, 2, 1], [40, 75, 255], [13, 34, 12]]) pixels[(y * width + x) * 4 + 3] = alpha;
  let largestRead = 0;
  const ctx = { getImageData(x, y, w, h) {
    largestRead = Math.max(largestRead, h);
    const data = new Uint8ClampedArray(w * h * 4);
    for (let row = 0; row < h; row++) for (let col = 0; col < w; col++) {
      const from = ((y + row) * width + x + col) * 4;
      data.set(pixels.subarray(from, from + 4), (row * w + col) * 4);
    }
    return { data };
  } };
  assert.deepEqual(scanAlphaBounds(ctx, width, height), box(6, 2, 40, 75));
  assert.deepEqual(scanAlphaBounds(ctx, width, height, { x: 10, y: 30, width: 10, height: 10 }), box(13, 34, 13, 34));
  assert.equal(scanAlphaBounds(ctx, width, height, { width: 0 }), null);
  assert.ok(largestRead <= 32);
});

test('legend keeps every element in a single bounded vertical column', () => {
  const ctx = { save() {}, restore() {}, measureText(text) { return { width: text.length * 10 }; } };
  const elements = Array.from({ length: 14 }, (_, i) => ({ symbol: i % 2 ? 'Na' : 'Cl' }));
  const layout = layoutElementLegend(ctx, elements, 1500, 1500);
  assert.equal(layout.columns.length, 1);
  assert.equal(layout.columns[0].entries.length, elements.length);
  assert.ok(layout.height <= 1500);
  assert.ok(layout.width <= 1500 * 0.32);
  assert.throws(() => layoutElementLegend(ctx, elements, 30, 30));
});

test('high resolution obeys both device side limit and total pixel budget', () => {
  assert.doesNotThrow(() => validateCaptureSize(4724, 4724, 2400, 8192));
  assert.doesNotThrow(() => validateCaptureSize(8192, 3000, 300, 8192));
  assert.throws(() => validateCaptureSize(8192, 8192, 300, 8192));
  assert.throws(() => validateCaptureSize(9000, 100, 300, 8192));
  assert.throws(() => validateCaptureSize(100, 100, 599.5, 8192));
});

test('bonds-only exports use visible geometry and refuse an overlapping translation', () => {
  const legendBounds = box(2, 2, 20, 80);
  const aligned = alignRasterBounds({ legendBounds, atomBounds: null, sceneBounds: box(75, 30, 170, 190), gapPixels: 118, width: 500, height: 500 });
  assert.equal(aligned.referenceBounds.left - legendBounds.right - 1, 118);
  assert.equal(aligned.gapReference, 'visible-geometry');
  assert.throws(() => alignRasterBounds({ legendBounds, atomBounds: box(100, 50, 200, 150), sceneBounds: box(0, 30, 230, 190), gapPixels: 10, width: 500, height: 500 }));
});
