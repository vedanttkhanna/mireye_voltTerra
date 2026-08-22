import { rename, rm, writeFile } from 'node:fs/promises';

/** Writes JSON beside its destination, then atomically replaces the target. */
export async function writeJsonAtomic(outPath, value, { space = 2 } = {}) {
  const tempPath = `${outPath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    await writeFile(tempPath, JSON.stringify(value, null, space));
    await rename(tempPath, outPath);
  } finally {
    await rm(tempPath, { force: true }).catch(() => {});
  }
}
