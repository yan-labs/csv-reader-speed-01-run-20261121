// csv-reader-speed-01-run-20261121: the program the harness runs. It reads
// every case from /input/cases.json, answers each one alone with run() from
// solve.js, and writes /output/answers.json: one answer per case, in the
// cases' order. Outside a container MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR
// stand in for /input and /output:
//   mkdir -p out && MAKEFUN_INPUT_DIR=... MAKEFUN_OUTPUT_DIR=out node main.ts

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// V8's incremental marking off, set before solve.js is imported so all of its
// work runs under it (the rules allow an entry to tune V8's flags this way).
setFlagsFromString('--no-incremental-marking');

const { run } = (await import(new URL('./solve.js', import.meta.url).href));

const inDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(inDir, 'cases.json'), 'utf8'));
const answers = cases.map((c) => run(c.input));
writeFileSync(join(outDir, 'answers.json'), JSON.stringify(answers));
console.log(`answered ${cases.length} cases -> ${join(outDir, 'answers.json')}`);
