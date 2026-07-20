const fs = require('fs');
const file = 'src/App.tsx';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
`      // MONITORING LOOP 2: ENTRIES (Hardened Scanner Engine)
      if (state.autoSniperEnabled) {
        const tokens = tokensForTracking;
        const currentActiveCount = activePositionEntries.length;`,
`      // MONITORING LOOP 2: ENTRIES (Hardened Scanner Engine)
      if (state.autoSniperEnabled) {
        const tokens = tokensForTracking;
        let currentActiveCount = activePositionEntries.length;`
);

code = code.replace(
`            console.log(\`[HARDENED ENTRY] ✅ \${token.symbol} MC=\$\${metrics.marketCapUsd.toFixed(0)} vol/liq=\${volMcRatio.toFixed(2)} buyP=\${(buyPressure*100).toFixed(0)}% momentum=\${momentumScore.toFixed(3)}\`);
            fns.current.executeAutoTrade(token.address, token.symbol);
          }
        }
      }`,
`            console.log(\`[HARDENED ENTRY] ✅ \${token.symbol} MC=\$\${metrics.marketCapUsd.toFixed(0)} vol/liq=\${volMcRatio.toFixed(2)} buyP=\${(buyPressure*100).toFixed(0)}% momentum=\${momentumScore.toFixed(3)}\`);
            fns.current.executeAutoTrade(token.address, token.symbol);
            currentActiveCount++;
          }
        }
      }`
);

fs.writeFileSync(file, code);
