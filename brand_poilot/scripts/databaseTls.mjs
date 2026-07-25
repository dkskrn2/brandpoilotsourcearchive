export function decodeCaCertificate(value) {
  if (!value) return undefined;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("invalid_environment: DB_SSL_CA_BASE64");
  }
  const decoded = Buffer.from(value, "base64");
  if (!decoded.length || decoded.toString("base64") !== value) {
    throw new Error("invalid_environment: DB_SSL_CA_BASE64");
  }
  return decoded.toString("utf8");
}

export function isSupabaseHostname(hostname) {
  return hostname.endsWith(".supabase.com")
    || hostname.endsWith(".supabase.co");
}

export function removeSslQueryOverrides(url) {
  for (const key of [...url.searchParams.keys()]) {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey.startsWith("ssl")
      || normalizedKey === "uselibpqcompat"
    ) {
      url.searchParams.delete(key);
    }
  }
}

export function resolveVerifiedTlsConfig(
  connectionString,
  { caCertificate } = {},
) {
  const url = new URL(connectionString);
  if (!isSupabaseHostname(url.hostname)) return { connectionString };

  removeSslQueryOverrides(url);
  return {
    connectionString: url.toString(),
    ssl: {
      rejectUnauthorized: true,
      ...(caCertificate ? { ca: caCertificate } : {}),
    },
  };
}
