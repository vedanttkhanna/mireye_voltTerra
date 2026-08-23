import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export async function writeJsonAtomic(outPath, value) {
  await mkdir(path.dirname(outPath), { recursive: true });
  const tempPath = `${outPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, JSON.stringify(value, null, 2), { flag: 'wx' });
    await rename(tempPath, outPath);
  } catch (err) {
    await unlink(tempPath).catch(() => {});
    throw err;
  }
}
