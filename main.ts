// House driver variant (research): identical behavior — reads every case from
// /input/cases.json, answers each with run, writes /output/answers.json with identical
// bytes — but stringifies per case so the six answer graphs never coexist on the heap.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';
setFlagsFromString('--no-incremental-marking');
const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as { run: (input: unknown) => unknown };
const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const cases = JSON.parse(readFileSync(join(INPUT_DIR, 'cases.json'), 'utf8')) as { id: string; input: unknown }[];
const parts: string[] = ['['];
for (let i = 0; i < cases.length; i++) {
  if (i) parts.push(',');
  parts.push(JSON.stringify(run(cases[i].input)));
}
parts.push(']');
writeFileSync(join(OUTPUT_DIR, 'answers.json'), parts.join(''));
