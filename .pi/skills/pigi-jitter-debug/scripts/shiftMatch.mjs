#!/usr/bin/env node
/** Track vertical content shift between consecutive frames via template matching.
 *  If the content vibrates, cumulative shift zigzags; if stable, it is monotonic.
 *
 *  Usage: node shiftMatch.mjs <bmpDir> <count> [rectJson]
 *  rectJson: {"left":244.5,"top":44,"right":1200,"bottom":648,"winW":1200}
 *  (CSS px rect of the region to track; defaults to the message list at
 *  1200x800 window. Get it in-page via:
 *    const r = el.getBoundingClientRect(); ({left:r.left, top:r.top, right:r.right, bottom:r.bottom, winW: innerWidth})
 *  Frames must be 640-wide 24-bit BMPs named 0000.bmp, 0001.bmp, ... — convert
 *  with: sips -s format bmp -Z 640 in.jpg --out out.bmp */
import fs from 'node:fs';

const dir = process.argv[2];
const count = parseInt(process.argv[3], 10);
const rect = process.argv[4]
  ? JSON.parse(process.argv[4])
  : { left: 244.5, top: 44, right: 1200, bottom: 648, winW: 1200 };
const listLeft = rect.left,
  listRight = rect.right,
  listTop = rect.top,
  listBottom = rect.bottom,
  winW = rect.winW;

function load(i) {
  const buf = fs.readFileSync(`${dir}/${String(i).padStart(4, '0')}.bmp`);
  const dataOffset = buf.readUInt32LE(10);
  const width = buf.readInt32LE(18);
  const heightRaw = buf.readInt32LE(22);
  const topDown = heightRaw < 0;
  const height = Math.abs(heightRaw);
  const rowSize = Math.floor((24 * width + 31) / 32) * 4;
  return { buf, dataOffset, width, height, topDown, rowSize };
}

function gray(img, x, y) {
  const row = img.topDown ? y : img.height - 1 - y;
  const o = img.dataOffset + row * img.rowSize + x * 3;
  return (img.buf[o] + img.buf[o + 1] + img.buf[o + 2]) / 3;
}

const scale = 640 / winW;
const x0 = Math.floor((listLeft + 20) * scale);
const x1 = Math.floor((listRight - 40) * scale); // avoid minimap at right edge
// template band in the middle of the viewport
const bandY = Math.floor(((listTop + listBottom) / 2 - 40) * scale);
const bandH = Math.floor(80 * scale);
const yMin = Math.floor(listTop * scale) + 4;
const yMax = Math.floor(listBottom * scale) - bandH - 4;
const MAX_SHIFT = Math.floor(70 * scale);

let cumulative = 0;
const out = [];
let prev = load(0);
for (let i = 1; i < count; i++) {
  const cur = load(i);
  let bestShift = 0;
  let bestCost = Infinity;
  for (let shift = -MAX_SHIFT; shift <= MAX_SHIFT; shift++) {
    const yy = bandY + shift;
    if (yy < yMin || yy > yMax) continue;
    let cost = 0;
    for (let y = 0; y < bandH; y += 3) {
      for (let x = x0; x < x1; x += 5) {
        cost += Math.abs(gray(prev, x, bandY + y) - gray(cur, x, bandY + y + shift));
      }
    }
    if (cost < bestCost) {
      bestCost = cost;
      bestShift = shift;
    }
  }
  // normalized cost to judge match confidence
  const samples = Math.ceil(bandH / 3) * Math.ceil((x1 - x0) / 5);
  const avg = bestCost / samples;
  cumulative += bestShift / scale;
  out.push({
    i,
    shiftCss: Math.round((bestShift / scale) * 10) / 10,
    cum: Math.round(cumulative * 10) / 10,
    avg: Math.round(avg * 10) / 10,
  });
  prev = cur;
}
console.log(JSON.stringify(out));
