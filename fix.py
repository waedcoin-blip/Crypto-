import re

with open("src/components/pages/PnLPage.tsx", "r") as f:
    text = f.read()

old = r"      if \(tokens.length === 0\) return;\s*// Batch fetch prices.*?const interval = setInterval\(updatePrices, 2000\);\s*return \(\) => clearInterval\(interval\);\s*\}, \[hasSimPosition, updateSimPrice\]\);"

new_code = """      if (tokens.length === 0) return;

      // Batch fetch prices
      for (let i = 0; i < tokens.length; i += 5) { 
        const batch = tokens.slice(i, i + 5); 
        await Promise.all(batch.map(async (token) => {
          try {
            const response = await fetch(`/api/dex/tokens/${token.address}`);
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

    const interval = setInterval(updatePrices, 2000);
    return () => clearInterval(interval);
  }, [hasSimPosition, updateSimPrice]);"""

text = re.sub(old, new_code, text, flags=re.DOTALL)

with open("src/components/pages/PnLPage.tsx", "w") as f:
    f.write(text)

