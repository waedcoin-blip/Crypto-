import fs from 'fs';
import path from 'path';

const dangerousPatterns = [
  { name: 'Unsafe Decimal Fallback (?? 6 or || 6)', regex: /\?\?\s*6|\|\|\s*6/g, severity: 'BUG' },
  { name: 'Floating Point Division by 1e6', regex: /\/\s*1e6/g, severity: 'BUG' },
  { name: 'Floating Point Multiplication by 1e6', regex: /\*\s*1e6/g, severity: 'WARNING' },
  { name: 'Unsafe Number Conversion on Raw Amounts', regex: /Number\s*\(\s*(raw|amountRaw|lamports)/g, severity: 'BUG' },
  { name: 'Overlapping Async Interval', regex: /setInterval\s*\(\s*async/g, severity: 'BUG' },
  { name: 'Swallowed Errors (catch {})', regex: /catch\s*\(\s*\)\s*\{\s*\}/g, severity: 'BUG' },
  { name: 'Hardcoded Secret / Private Key', regex: /privateKey|secret|seed|mnemonic/gi, severity: 'WARNING' },
  { name: 'Artificial History Truncation (slice(-500))', regex: /slice\s*\(\s*-\s*\d+\s*\)/g, severity: 'WARNING' },
];

const targetDirs = ['server', 'src'];

function scanDir(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
      results.push(...scanDir(fullPath));
    } else if (entry.isFile() && /\.(ts|tsx|js|mjs)$/.test(entry.name)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        for (const pattern of dangerousPatterns) {
          if (pattern.regex.test(line)) {
            results.push({
              file: fullPath,
              line: idx + 1,
              pattern: pattern.name,
              severity: pattern.severity,
              code: line.trim()
            });
          }
        }
      });
    }
  }
  return results;
}

console.log('=== ARINA X-RAY ALPHA STATIC PRODUCTION AUDIT ===');
let allFindings = [];
for (const dir of targetDirs) {
  allFindings.push(...scanDir(dir));
}

let bugs = allFindings.filter(f => f.severity === 'BUG');
let warnings = allFindings.filter(f => f.severity === 'WARNING');

console.log(`Total findings: ${allFindings.length} (Bugs: ${bugs.length}, Warnings: ${warnings.length})`);
for (const f of allFindings.slice(0, 30)) {
  console.log(`[${f.severity}] ${f.file}:${f.line} -> ${f.pattern} | ${f.code}`);
}

const report = `# Final Production Audit Report
Generated at: ${new Date().toISOString()}
Total Findings: ${allFindings.length}
Bugs: ${bugs.length}
Warnings: ${warnings.length}

## Findings Details
${allFindings.map(f => `- **[${f.severity}]** \`${f.file}:${f.line}\`: ${f.pattern} (\`${f.code}\`)`).join('\n')}
`;

fs.writeFileSync('FINAL_PRODUCTION_AUDIT_REPORT.md', report);
console.log('Wrote FINAL_PRODUCTION_AUDIT_REPORT.md successfully.');
