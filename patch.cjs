const fs = require('fs');
let code = fs.readFileSync('server/services/criteriaService.ts', 'utf8');

code = code.replace(
  'export class CriteriaService extends EventEmitter {',
  'let isAdminDbFunctional = true;\n\nexport class CriteriaService extends EventEmitter {'
);

code = code.replace(
  'if (adminDb) {',
  'if (adminDb && isAdminDbFunctional) {'
);

// We need to replace all instances.
fs.writeFileSync('server/services/criteriaService.ts', code);
