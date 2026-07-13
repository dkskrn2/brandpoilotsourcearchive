interface LocalLocation {
  protocol: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  hash: string;
}

export function canonicalLocalDevUrl(location: LocalLocation) {
  if (location.protocol !== "http:" || location.hostname !== "127.0.0.1") return null;
  const port = location.port ? `:${location.port}` : "";
  return `http://localhost${port}${location.pathname}${location.search}${location.hash}`;
}
