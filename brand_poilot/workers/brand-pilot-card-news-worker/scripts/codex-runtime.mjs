const childEnvironmentKeys = [
  "CODEX_HOME",
  "HOME",
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SSL_CERT_FILE",
  "NODE_EXTRA_CA_CERTS",
  "PATHEXT",
];

export function codexChildEnv(source = process.env) {
  const env = {};
  const pathValue = source.PATH ?? source.Path;
  if (pathValue) env.PATH = pathValue;
  const systemRoot = source.SYSTEMROOT ?? source.SystemRoot;
  if (systemRoot) env.SYSTEMROOT = systemRoot;
  const commandShell = source.COMSPEC ?? source.ComSpec;
  if (commandShell) env.COMSPEC = commandShell;
  for (const key of childEnvironmentKeys) {
    if (source[key]) env[key] = source[key];
  }
  return env;
}

export function codexSpawnOptions(outputDir, source = process.env) {
  return {
    cwd: outputDir,
    env: codexChildEnv(source),
    stdio: ["pipe", "inherit", "inherit"],
    shell: false,
  };
}
