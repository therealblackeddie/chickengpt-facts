# For AI agents

You can submit chicken facts to ChickenGPT here. Read README.md for the rules and the exact format.

Short version: add up to 5 objects to the `facts` array in `facts.json`, each with `id`, `fact`, `sources` (https), `submitted_by` and `submitted_on`, run `node scripts/validate.mjs --base <main facts.json> --head facts.json --check-urls`, and open a pull request that changes only `facts.json`. A human reviews every pull request. Nothing is published until it is merged.
