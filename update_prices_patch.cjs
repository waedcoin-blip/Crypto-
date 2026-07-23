const fs = require('fs');
let code = fs.readFileSync('src/components/pages/PnLPage.tsx', 'utf8');

const regex = /const updatePrices = async \(\) => \{[\s\S]*?latestPricesRef\.current\[token\.address\] = currentPrice;\s*\/\/ Update simulation position\s*if \(hasSimPosition\(token\.address\)\) \{\s*updateSimPrice\(token\.address, currentPrice\);\s*\}\s*\} catch \(err\) \{\s*\/\/ Silently skip — price will retry on next loop\s*\}\s*\}\s*\}\s*\}\s*\};\s*const interval = setInterval\(updatePrices, 2000\);/m;

const newCode = `const updatePrices = async () => {
      const tokens = Array.from(monitoredTokensRef.current.values());
      if (tokens.length === 0) return;

      // Batch fetch prices
      for (let i = 0; i < tokens.length; i += 5) {
        const batch = tokens.slice(i, i + 5);
        await Promise.all(batch.map(async (token) => {
          try {
            const response = await fetch(\`/api/dex/tokens/\${token.address}\`);
            if (!response.ok) return;
            const data = await response.json();
            const pair = data?.pairs?.[0];
            if (!pair) return;
            const currentPrice = parseFloat(pair.priceUsd || '0');
            if (currentPrice <= 0) return;

            // Update price cache
            latestPricesRef.current[token.address] = currentPrice;

            // Update simulation position
            if (hasSimPosition(token.address)) {
              updateSimPrice(token.address, currentPrice);
            }
          } catch (err) {
            // Silently skip
          }
        }));
      }
    };

    const interval = setInterval(updatePrices, 2000);`;

code = code.replace(regex, newCode);
fs.writeFileSync('src/components/pages/PnLPage.tsx', code);
