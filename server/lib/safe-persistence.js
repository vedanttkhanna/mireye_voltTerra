import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export async function writeJsonAtomic(outPath, value) {
  await mkdir(path.dirname(outPath), { recursive: true });
  const tempPath = `${outPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, JSON.stringify(value, null, 2), { flag: 'wx' });
  await rename(tempPath, outPath);
}
