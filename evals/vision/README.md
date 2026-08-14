# Vision benchmark

Production photographs never belong in this directory. Build this benchmark
from separately consented, staged images that contain no people, addresses,
receipts, account details, or other personal data.

The private-beta gate requires at least 100 batches spanning:

- loose produce and packaged food;
- clutter and partial occlusion;
- duplicate views of the same physical item;
- unfamiliar/non-food objects;
- uneven and poor lighting.

Copy `manifest.example.json` to `manifest.json`, keep image files outside Git,
and record only stable benchmark IDs plus expected concept IDs. Run
`pnpm eval:vision manifest.json results.json` after the evaluation runner
produces exactly one `{ id, proposedConceptIds }` result per manifest batch.
Duplicate, missing, or unlinked batch IDs fail validation. The scorer fails
unless it sees 100 manifest batches, proposal
precision of at least 90%, and recall of at least 80%.

Do not tune against the final benchmark. Keep a separate prompt-development
split and record the model, prompt version, and image-detail setting with every
run.
