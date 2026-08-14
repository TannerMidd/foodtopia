import { readFile } from "node:fs/promises";

import {
  scoreVisionEvaluation,
  visionManifestSchema,
  visionResultsSchema,
} from "./lib/vision-eval";

const manifestFile = process.argv[2];
const resultsFile = process.argv[3];
if (!manifestFile || !resultsFile) {
  console.error("Usage: pnpm eval:vision <manifest.json> <results.json>");
  process.exit(2);
}

const manifest = visionManifestSchema.parse(
  JSON.parse(await readFile(manifestFile, "utf8")),
);
const results = visionResultsSchema.parse(
  JSON.parse(await readFile(resultsFile, "utf8")),
);
const score = scoreVisionEvaluation(manifest, results);
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

console.log(
  `Vision evaluation: ${score.batchCount} batches, ${percent(score.precision)} precision, ${percent(score.recall)} recall.`,
);

if (score.batchCount < 100 || score.precision < 0.9 || score.recall < 0.8) {
  console.error(
    "Private-beta gate failed (requires >=100 batches, >=90% precision, >=80% recall).",
  );
  process.exitCode = 1;
}
