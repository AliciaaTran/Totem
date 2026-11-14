import qrcode from 'qrcode-generator';

export interface QrResult {
  svg: string;
  version: number;
  modules: number;
}

/** Black-on-white QR code as SVG, with the standard 4-module quiet zone. */
export function makeQrSvg(text: string, label: string): QrResult {
  const qr = qrcode(0, 'M'); // auto size, ~15% damage tolerance
  qr.addData(text, 'Byte');
  qr.make();

  const n = qr.getModuleCount();
  const margin = 4;
  const size = n + margin * 2;
  let path = '';
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (qr.isDark(row, col)) path += `M${col + margin},${row + margin}h1v1h-1z`;
    }
  }
  const escapedLabel = label.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="${escapedLabel}">` +
    `<rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
  return { svg, version: (n - 17) / 4, modules: n };
}
