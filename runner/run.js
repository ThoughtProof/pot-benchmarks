#!/usr/bin/env node
/**
 * pot-benchmarks runner
 * Runs benchmark cases against pot-sdk and reports results.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... node run.js
 *   ANTHROPIC_API_KEY=... node run.js --category hallucination
 *   ANTHROPIC_API_KEY=... node run.js --id hal-001
 */

import { verify } from 'pot-sdk';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const benchmarkPath = resolve(__dir, '../benchmark.json');
const { cases } = JSON.parse(readFileSync(benchmarkPath, 'utf8'));

// Parse CLI args
const args = process.argv.slice(2);
const filterCategories = [];
const filterIds = [];
const autoEvolve = args.includes('--auto-evolve'); // opt-in: triggers evolve.js after run
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--category' && args[i+1]) filterCategories.push(args[++i]);
  if (args[i] === '--id' && args[i+1]) filterIds.push(args[++i]);
}

// Build apiKeys from env
const apiKeys = {};
if (process.env.ANTHROPIC_API_KEY) apiKeys.anthropic = process.env.ANTHROPIC_API_KEY;
if (process.env.XAI_API_KEY) apiKeys.xai = process.env.XAI_API_KEY;
if (process.env.DEEPSEEK_API_KEY) apiKeys.deepseek = process.env.DEEPSEEK_API_KEY;
if (process.env.MOONSHOT_API_KEY) apiKeys.moonshot = process.env.MOONSHOT_API_KEY;

if (!apiKeys.anthropic) {
  console.error('❌ ANTHROPIC_API_KEY required');
  process.exit(1);
}

// Filter cases
let toRun = cases;
if (filterCategories.length) toRun = toRun.filter(c => filterCategories.includes(c.category));
if (filterIds.length) toRun = toRun.filter(c => filterIds.includes(c.id));

console.log(`\n🔍 pot-benchmarks — running ${toRun.length} cases\n`);

const results = [];
let passed = 0, failed = 0, errors = 0;

for (const testCase of toRun) {
  process.stdout.write(`  [${testCase.id}] ${testCase.category} — "${testCase.output.substring(0, 50)}..." `);

  try {
    const result = await verify(testCase.output, {
      tier: 'basic',
      apiKeys,
      question: testCase.question,
    });

    // Check: did we correctly identify groundTruth?
    const expectedWrong = !testCase.groundTruth;
    const gotFlagged = result.flags && result.flags.length > 0;
    const correct = expectedWrong ? gotFlagged : !gotFlagged;

    // Check expected flags
    const missingFlags = (testCase.expectedFlags || []).filter(f => !(result.flags || []).includes(f));

    // Claim-injection: track propagation (did false claim survive into synthesis?)
    let claim_propagated = null;
    let dpr_score = null;
    if (testCase.category === 'claim-injection' && testCase.injectedFalseClaim && result.synthesis) {
      const synthLower = result.synthesis.toLowerCase();
      const claimTerms = testCase.injectedFalseClaim.toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
        .filter(w => w.length > 3);
      const hits = claimTerms.filter(t => synthLower.includes(t)).length;
      claim_propagated = hits >= 2; // false claim survived into synthesis
      dpr_score = result.dpr?.score ?? null;
    }

    const status = correct ? '✅' : '❌';
    const propagationNote = claim_propagated === true ? ' 🚨 claim propagated'
      : claim_propagated === false ? ' 🛡️ claim blocked' : '';
    console.log(`${status} confidence=${result.confidence?.toFixed(2)} flags=[${(result.flags||[]).join(',')}]${propagationNote}`);
    if (dpr_score !== null) console.log(`     📊 DPR: ${dpr_score.toFixed(3)} | false_consensus: ${result.dpr?.false_consensus}`);
    if (missingFlags.length) console.log(`     ⚠️  Missing expected flags: ${missingFlags.join(', ')}`);

    correct ? passed++ : failed++;
    results.push({ id: testCase.id, category: testCase.category, correct, result, missingFlags, claim_propagated, dpr_score });
  } catch (err) {
    console.log(`💥 ERROR: ${err.message}`);
    errors++;
    results.push({ id: testCase.id, category: testCase.category, correct: false, error: err.message });
  }
}

// Summary
console.log('\n─────────────────────────────────');
console.log(`✅ Passed: ${passed}/${toRun.length}`);
console.log(`❌ Failed: ${failed}/${toRun.length}`);
if (errors) console.log(`💥 Errors: ${errors}/${toRun.length}`);
console.log(`📊 Score:  ${((passed / (toRun.length - errors)) * 100).toFixed(1)}%`);

// Breakdown by category
const byCategory = {};
for (const r of results) {
  if (!byCategory[r.category]) byCategory[r.category] = { passed: 0, total: 0 };
  byCategory[r.category].total++;
  if (r.correct) byCategory[r.category].passed++;
}
console.log('\nBy category:');
for (const [cat, stats] of Object.entries(byCategory)) {
  const pct = ((stats.passed / stats.total) * 100).toFixed(0);
  console.log(`  ${cat.padEnd(20)} ${stats.passed}/${stats.total} (${pct}%)`);
}

// Claim-injection propagation summary
const ciResults = results.filter(r => r.category === 'claim-injection' && r.claim_propagated !== null);
if (ciResults.length > 0) {
  const propagated = ciResults.filter(r => r.claim_propagated).length;
  const blocked = ciResults.filter(r => !r.claim_propagated).length;
  const avgDpr = ciResults.filter(r => r.dpr_score !== null).reduce((s, r) => s + r.dpr_score, 0) / ciResults.length;
  console.log('\n🧪 Claim-Injection Propagation Analysis:');
  console.log(`  🛡️  Blocked (claim didn't reach synthesis): ${blocked}/${ciResults.length}`);
  console.log(`  🚨 Propagated (false claim survived):       ${propagated}/${ciResults.length}`);
  console.log(`  📊 Avg DPR across claim-injection cases:   ${avgDpr.toFixed(3)}`);
  console.log(`  → Detection rate: ${((blocked / ciResults.length) * 100).toFixed(1)}%`);
}

// Save results
const timestamp = new Date().toISOString().substring(0, 10);
const outputPath = resolve(__dir, `../results/${timestamp}.json`);
writeFileSync(outputPath, JSON.stringify({
  runDate: new Date().toISOString(),
  score: passed / (toRun.length - errors),
  passed, failed, errors,
  byCategory,
  cases: results,
}, null, 2));
console.log(`\n💾 Results saved to results/${timestamp}.json`);

// --auto-evolve: trigger self-evolving engine after run (opt-in)
if (autoEvolve) {
  console.log('\n🧬 --auto-evolve: triggering Self-Evolving Benchmark Engine...');
  const { execSync } = await import('child_process');
  try {
    execSync('node evolve.js --count 3', {
      cwd: __dir,
      stdio: 'inherit',
      env: process.env,
    });
  } catch (e) {
    console.warn('⚠️  Auto-evolve failed (non-fatal):', e.message);
  }
}
