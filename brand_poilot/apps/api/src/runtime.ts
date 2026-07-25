export function resolveServerHost({
  host = process.env.HOST,
  vercel = process.env.VERCEL
}: {
  host?: string;
  vercel?: string;
} = {}) {
  return host ?? (vercel ? "0.0.0.0" : "127.0.0.1");
}
