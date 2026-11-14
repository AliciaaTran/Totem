/** Where printed QR codes point (GitHub Pages; the /Totem/ path is case-sensitive). */
export const PRODUCTION_DECODE_BASE = 'https://aliciaatran.github.io/Totem/decode/';

/**
 * Production build → the real site.
 * Dev server → this server, so you can test. Open the generator through the
 * "Network" address Vite prints and a phone on the same Wi-Fi can scan it.
 * Override with VITE_DECODE_BASE in .env.local if needed.
 */
export function decodeBase(): string {
  const override = import.meta.env.VITE_DECODE_BASE as string | undefined;
  if (override) return override;
  if (import.meta.env.DEV) return `${location.origin}/decode/`;
  return PRODUCTION_DECODE_BASE;
}
