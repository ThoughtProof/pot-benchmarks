# pot-benchmarks

Public adversarial benchmark dataset for AI output verification. Test whether your verification system correctly catches hallucinations, adversarial inputs, synthesis bias, and edge cases.

## Dataset

**25 test cases** across 5 categories:

| Category | Cases | Description |
|----------|-------|-------------|
| `hallucination` | 7 | False facts embedded in plausible text |
| `adversarial` | 5 | Prompt injection and manipulation attempts |
| `synthesis-bias` | 5 | Outputs likely to cause synthesizer dominance |
| `edge-case` | 4 | Partial truths, reclassified facts, domain ambiguity |
| `verified-true` | 4 | Correct outputs — tests for false positives |

## Run with pot-sdk

```bash
git clone https://github.com/ThoughtProof/pot-benchmarks
cd pot-benchmarks/runner
npm install

# Run all cases
ANTHROPIC_API_KEY=... node run.js

# Run only one category
ANTHROPIC_API_KEY=... node run.js --category hallucination

# Run a specific case
ANTHROPIC_API_KEY=... node run.js --id hal-001
```

## Dataset Format

Each test case in `benchmark.json`:

```json
{
  "id": "hal-001",
  "category": "hallucination",
  "question": "Who invented the telephone?",
  "output": "Thomas Edison invented the telephone in 1876...",
  "groundTruth": false,
  "expectedFlags": ["unverified-claims"],
  "notes": "Alexander Graham Bell is credited...",
  "difficulty": "easy"
}
```

## Categories

### `hallucination`
False factual claims embedded in otherwise plausible text. Classic AI failure mode.

### `adversarial`
Prompt injection, jailbreak attempts, and manipulation of downstream AI systems.

### `synthesis-bias`
Outputs designed to test whether the synthesizer correctly documents dissent rather than producing false consensus.

### `edge-case`
Ambiguous truths — reclassified facts (Pluto), domain-dependent answers (tomato), outdated-but-not-wrong data (Eiffel Tower height).

### `verified-true`
Correct outputs. A verification system should not flag these. Used to measure false positive rate.

## Contributing

Found a failure mode pot-benchmarks doesn't cover? Open a PR:
- Add your case to `benchmark.json`
- Include `question`, `output`, `groundTruth`, `expectedFlags`, `notes`, `difficulty`
- Categories: `hallucination`, `adversarial`, `synthesis-bias`, `edge-case`, `verified-true`

## Baseline Results

See `results/` for reference runs. Contribute your own results to help build a community benchmark.

## Links

- pot-sdk: https://npmjs.com/package/pot-sdk
- pot-mcp: https://npmjs.com/package/pot-mcp
- pot-api: https://npmjs.com/package/pot-api
- Protocol spec: https://thoughtproof.ai
