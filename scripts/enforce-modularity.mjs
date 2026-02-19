import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const REPORT_PATH = path.join(ROOT, '.modularity-report.json');
const POLICY_PATH = path.join(ROOT, 'config/modularity-budgets.json');
const REPORT_ONLY = process.argv.includes('--report-only');

function read(relPath) {
  return readFileSync(path.join(ROOT, relPath), 'utf8');
}

function readJson(absPath) {
  return JSON.parse(readFileSync(absPath, 'utf8'));
}

function lineCount(text) {
  return String(text).split('\n').length;
}

function safeRegex(source) {
  return new RegExp(source, 'm');
}

function getFunctionSpans(sourceText) {
  const lines = sourceText.split('\n');
  const spans = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/^\s*(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/);
    if (!match?.[1]) continue;
    const name = match[1];
    let depth = 0;
    let started = false;
    let end = i;
    for (let j = i; j < lines.length; j += 1) {
      const line = lines[j];
      for (const ch of line) {
        if (ch === '{') {
          depth += 1;
          started = true;
        } else if (ch === '}') {
          depth = Math.max(0, depth - 1);
        }
      }
      if (started && depth === 0) {
        end = j;
        break;
      }
    }
    spans.push({ name, start: i + 1, end: end + 1, lines: end - i + 1 });
  }
  return spans.sort((a, b) => b.lines - a.lines);
}

function analyzeBudget(filePolicy) {
  const relPath = String(filePolicy.path || '');
  const source = read(relPath);
  const current = lineCount(source);
  const baseline = Number(filePolicy.baselineLines || 0);
  const growthPct = Number(filePolicy.maxGrowthPct || 0);
  const warnAtPct = Number(filePolicy.warnAtPct || 90);
  const threshold = Math.ceil(baseline * (1 + growthPct / 100));
  const ratio = threshold > 0 ? current / threshold : 0;
  const warnRatio = Math.max(0.01, Math.min(1, warnAtPct / 100));

  let status = 'ok';
  if (current > threshold) {
    status = 'error';
  } else if (ratio >= warnRatio) {
    status = 'warning';
  }

  const recommendations = [];
  if (status !== 'ok') {
    recommendations.push(
      `Extract one cohesive concern from ${relPath} into one of: ${(filePolicy.nextModules || []).join(', ') || 'new module path'}.`
    );
  }
  if (relPath.endsWith('.js')) {
    const spans = getFunctionSpans(source).slice(0, 3);
    for (const span of spans) {
      if (span.lines >= 120) {
        recommendations.push(
          `Large function candidate: ${span.name} (${span.lines} lines @ ${relPath}:${span.start}). Split into helper module(s).`
        );
      }
    }
  }

  return {
    type: 'budget',
    path: relPath,
    goal: filePolicy.goal || '',
    baselineLines: baseline,
    maxGrowthPct: growthPct,
    warnAtPct,
    thresholdLines: threshold,
    currentLines: current,
    status,
    recommendations
  };
}

function analyzeBoundary(rule) {
  const relPath = String(rule.path || '');
  const source = read(relPath);
  const finding = {
    type: 'boundary',
    id: String(rule.id || 'unknown-rule'),
    path: relPath,
    message: String(rule.message || ''),
    severity: String(rule.severity || 'error'),
    remediation: String(rule.remediation || ''),
    status: 'ok'
  };

  if (rule.mustNotContainRegex) {
    const re = safeRegex(String(rule.mustNotContainRegex));
    if (re.test(source)) {
      finding.status = finding.severity === 'warning' ? 'warning' : 'error';
    }
  }
  if (rule.mustContainRegex) {
    const re = safeRegex(String(rule.mustContainRegex));
    if (!re.test(source)) {
      finding.status = finding.severity === 'warning' ? 'warning' : 'error';
    }
  }
  return finding;
}

function writeReport(report) {
  mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

const policy = readJson(POLICY_PATH);
const budgetFindings = (policy.files || []).map(analyzeBudget);
const boundaryFindings = (policy.boundaryRules || []).map(analyzeBoundary);
const findings = [...budgetFindings, ...boundaryFindings];
const errors = findings.filter((entry) => entry.status === 'error');
const warnings = findings.filter((entry) => entry.status === 'warning');

const report = {
  generatedAt: new Date().toISOString(),
  policyPath: path.relative(ROOT, POLICY_PATH),
  summary: {
    errors: errors.length,
    warnings: warnings.length,
    checks: findings.length
  },
  findings
};

writeReport(report);

if (errors.length > 0) {
  console.error('Modularity enforcement failed:\n');
  for (const issue of errors) {
    if (issue.type === 'budget') {
      console.error(
        `- [budget] ${issue.path}: ${issue.currentLines}/${issue.thresholdLines} lines exceeds contextual growth budget.`
      );
      for (const rec of issue.recommendations || []) {
        console.error(`  -> ${rec}`);
      }
      continue;
    }
    console.error(`- [${issue.id}] ${issue.path}: ${issue.message}`);
    if (issue.remediation) {
      console.error(`  -> ${issue.remediation}`);
    }
  }
  console.error(`\nSee ${path.relative(ROOT, REPORT_PATH)} for full modularization guidance.`);
  if (!REPORT_ONLY) {
    process.exit(1);
  }
}

if (warnings.length > 0) {
  console.warn('Modularity warnings:\n');
  for (const warn of warnings) {
    if (warn.type === 'budget') {
      console.warn(
        `- [budget] ${warn.path}: ${warn.currentLines}/${warn.thresholdLines} lines is near budget.`
      );
      for (const rec of warn.recommendations || []) {
        console.warn(`  -> ${rec}`);
      }
      continue;
    }
    console.warn(`- [${warn.id}] ${warn.path}: ${warn.message}`);
  }
}

console.log(`Modularity enforcement passed. Report written to ${path.relative(ROOT, REPORT_PATH)}.`);
