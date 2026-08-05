import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { generateArtifactSet } from "./generateArtifacts.js";
import { compareUnicodeCodePoints } from "./catalog.js";

const GENERATED_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), "../generated");

export async function checkGenerated(outputDirectory = GENERATED_DIRECTORY): Promise<void> {
  const expected = await generateArtifactSet();
  const actualNames = existsSync(outputDirectory) ? readdirSync(outputDirectory).sort(compareUnicodeCodePoints) : [];
  const expectedNames = [...expected.keys()].sort(compareUnicodeCodePoints);
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new Error("generated_content_contracts_drift");
  }
  for (const [filename, text] of expected) {
    if (readFileSync(join(outputDirectory, filename), "utf8") !== text) {
      throw new Error(`generated_content_contracts_drift:${filename}`);
    }
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  await checkGenerated();
}
