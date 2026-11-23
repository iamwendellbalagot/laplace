// Avoid another disk-exhausting build. Does not install tools or delete caches.
import { statfsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const disk = statfsSync(process.cwd());
const freeGiB = disk.bavail * disk.bsize / 1024 ** 3;
if (freeGiB < 6) {
  throw new Error(`Native probe needs at least 6 GiB free (operational budget, not a measured minimum); available: ${freeGiB.toFixed(2)} GiB. Free space yourself; this probe never deletes user data.`);
}
for (const tool of ['cargo', 'rustc']) {
  console.log(execFileSync(tool, ['--version'], { encoding: 'utf8' }).trim());
}
