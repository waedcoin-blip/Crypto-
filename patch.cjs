const fs = require('fs');

const filePath = 'server/services/criteriaService.ts';
let code = fs.readFileSync(filePath, 'utf8');

let modified = false;

// Check if already patched
if (!code.includes('let isAdminDbFunctional')) {
  if (code.includes('export class CriteriaService extends EventEmitter {')) {
    code = code.replace(
      'export class CriteriaService extends EventEmitter {',
      'let isAdminDbFunctional = true;\n\nexport class CriteriaService extends EventEmitter {'
    );
    modified = true;
  } else {
    console.error('ERROR: Could not find target insertion point in server/services/criteriaService.ts');
    process.exit(1);
  }
} else {
  console.log('Patch already present in server/services/criteriaService.ts - skipping insertion.');
}

if (!code.includes('if (adminDb && isAdminDbFunctional) {')) {
  if (code.includes('if (adminDb) {')) {
    code = code.replace(
      'if (adminDb) {',
      'if (adminDb && isAdminDbFunctional) {'
    );
    modified = true;
  }
}

if (modified) {
  fs.writeFileSync(filePath, code);
  console.log('Patch applied successfully to server/services/criteriaService.ts.');
} else {
  console.log('No changes required for server/services/criteriaService.ts.');
}

console.log('Patch script completed.');

