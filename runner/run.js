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

    const status = correct ? '✅' : '❌';
    console.log(`${status} confidence=${result.confidence?.toFixed(2)} flags=[${(result.flags||[]).join(',')}]`);
    if (missingFlags.length) console.log(`     ⚠️  Missing expected flags: ${missingFlags.join(', ')}`);

    correct ? passed++ : failed++;
    results.push({ id: testCase.id, category: testCase.category, correct, result, missingFlags });
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
