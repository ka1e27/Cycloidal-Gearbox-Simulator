// Cross-platform runner for the parity harness.
//   node scripts/parity/run.mjs          run the TS side with the report table (PARITY_REPORT=1)
//   node scripts/parity/run.mjs --gen    regenerate scripts/parity/fixture.json with Python + numpy
// Python is taken from $PYTHON (default: python). numpy must be importable, see README.md.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const gen = process.argv.includes('--gen');

let r;
if (gen) {
  const py = process.env.PYTHON || 'python';
  r = spawnSync(py, [join(here, 'generate_fixture.py')], { stdio: 'inherit', cwd: root });
} else {
  r = spawnSync(process.execPath, [join(root, 'node_modules', 'vitest', 'vitest.mjs'), 'run', 'src/calc/__tests__/parity.test.ts', '--reporter=verbose'], {
    stdio: 'inherit', cwd: root, env: { ...process.env, PARITY_REPORT: '1' },
  });
}
process.exit(r.status ?? 1);
