import test from "node:test";
import assert from "node:assert/strict";
import { scoreSummary, summarizeLiveResult } from "../tools/dsl-autoresearch-runner.mjs";

test("summarizeLiveResult derives aggregate gate metrics", () => {
  const payload = {
    summaries: [
      { model: "a", parseOkPct: 100, requiredPassPct: 80 },
      { model: "b", parseOkPct: 90, requiredPassPct: 70 },
    ],
    qualityGate: { violations: [{ model: "b", metric: "requiredPassPct" }] },
  };
  const out = summarizeLiveResult(payload);
  assert.equal(out.gatePass, false);
  assert.equal(out.minParse, 90);
  assert.equal(out.minRequired, 70);
  assert.equal(out.modelCount, 2);
  assert.equal(out.violations.length, 1);
});

test("scoreSummary strongly prefers gate-passing outcomes", () => {
  const passing = scoreSummary({
    gatePass: true,
    violations: [],
    minParse: 90,
    minRequired: 90,
    avgParse: 95,
    avgRequired: 95,
  });
  const failing = scoreSummary({
    gatePass: false,
    violations: [{ metric: "requiredPassPct" }],
    minParse: 100,
    minRequired: 100,
    avgParse: 100,
    avgRequired: 100,
  });
  assert.ok(passing > failing);
});
