const fs = require('fs');
let code = fs.readFileSync('src/services/MasterMonitorService.ts', 'utf8');

const target = `          this.pushPriceUpdate(mint, cached.priceNative, cached.updatedAt, cached.source || 'jupiter');`;
const replacement = `          this.pushPriceUpdate(mint, cached.priceNative, cached.updatedAt, (cached.source as any) || 'jupiter');`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync('src/services/MasterMonitorService.ts', code);
  console.log('Replaced successfully');
} else {
  console.log('Target not found');
}
