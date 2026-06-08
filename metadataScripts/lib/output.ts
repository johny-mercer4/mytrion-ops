/** Write analyzer results to metadataScripts/output/ as both JSON (machine) and Markdown (human). */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUTPUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'output');

export interface WrittenPaths {
  jsonPath: string;
  mdPath: string;
}

export async function writeMetadata(
  name: string,
  json: unknown,
  markdown: string,
): Promise<WrittenPaths> {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const jsonPath = join(OUTPUT_DIR, `${name}.json`);
  const mdPath = join(OUTPUT_DIR, `${name}.md`);
  await writeFile(jsonPath, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
  await writeFile(mdPath, markdown.endsWith('\n') ? markdown : `${markdown}\n`, 'utf8');
  return { jsonPath, mdPath };
}

/** ISO timestamp for stamping generated artifacts. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Run an analyzer's main(), print where output landed, and set the exit code. */
export function runAnalyzer(label: string, main: () => Promise<WrittenPaths>): void {
  main()
    .then(({ jsonPath, mdPath }) => {
      console.log(`[${label}] wrote:\n  ${jsonPath}\n  ${mdPath}`);
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error(`[${label}] failed:`, err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
