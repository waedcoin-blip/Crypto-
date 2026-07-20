const fs = require('fs');
let code = fs.readFileSync('src/components/pages/PnLPage.tsx', 'utf-8');

const target = `  const fetchJupiterPriceFallback = useCallback(async (tokenMint: string): Promise<number | null> => {
    try {
      const headers: Record<string, string> = {};
      if (apiKey && !apiKey.startsWith('http')) {
        headers['x-api-key'] = apiKey;
      }
      
      // 1. Try direct price vs SOL first
      const res = await fetch(\`/api/jup/price?ids=\${tokenMint}&vsToken=\${SOL_MINT}&t=\${Date.now()}\`, { headers });
      if (res.ok) {
        const data = await res.json();
        if (data && data.data && data.data[tokenMint] && data.data[tokenMint].price) {
          const val = parseFloat(data.data[tokenMint].price);
          if (val > 0) return val;
        }
      }
      
      // 2. Fallback: Parse USD price of token and USD price of SOL to calculate exact SOL price
      const usdRes = await fetch(\`/api/jup/price?ids=\${tokenMint},\${SOL_MINT}&t=\${Date.now()}\`, { headers });
      if (usdRes.ok) {
        const usdData = await usdRes.json();
        if (usdData && usdData.data) {
          const tokenUsd = parseFloat(usdData.data[tokenMint]?.price || '0');
          const solUsd = parseFloat(usdData.data[SOL_MINT]?.price || '150');
          if (tokenUsd > 0 && solUsd > 0) {
            const calculatedSolPrice = tokenUsd / solUsd;
            return calculatedSolPrice;
          }
        }
      }`;

const replacement = `  const fetchJupiterPriceFallback = useCallback(async (tokenMint: string): Promise<number | null> => {
    try {
      const headers: Record<string, string> = {};
      if (apiKey && !apiKey.startsWith('http')) {
        headers['x-api-key'] = apiKey;
      }
      
      const fetchWithFallback = async (proxyUrl: string, directUrl: string) => {
        try {
          const res = await fetch(proxyUrl, { headers });
          if (res.ok) {
             const contentType = res.headers.get("content-type");
             if (contentType && contentType.includes("application/json")) {
                 return await res.json();
             }
          }
        } catch (e) {}
        try {
          const resDirect = await fetch(directUrl);
          if (resDirect.ok) return await resDirect.json();
        } catch(e) {}
        return null;
      };
      
      const data = await fetchWithFallback(
        \`/api/jup/price?ids=\${tokenMint}&vsToken=\${SOL_MINT}&t=\${Date.now()}\`,
        \`https://api.jup.ag/price/v2?ids=\${tokenMint}&vsToken=\${SOL_MINT}\`
      );
      if (data && data.data && data.data[tokenMint] && data.data[tokenMint].price) {
        const val = parseFloat(data.data[tokenMint].price);
        if (val > 0) return val;
      }
      
      const usdData = await fetchWithFallback(
        \`/api/jup/price?ids=\${tokenMint},\${SOL_MINT}&t=\${Date.now()}\`,
        \`https://api.jup.ag/price/v2?ids=\${tokenMint},\${SOL_MINT}\`
      );
      if (usdData && usdData.data) {
        const tokenUsd = parseFloat(usdData.data[tokenMint]?.price || '0');
        const solUsd = parseFloat(usdData.data[SOL_MINT]?.price || '150');
        if (tokenUsd > 0 && solUsd > 0) {
          return tokenUsd / solUsd;
        }
      }`;

if (code.includes(target)) {
    fs.writeFileSync('src/components/pages/PnLPage.tsx', code.replace(target, replacement));
    console.log("Replaced successfully!");
} else {
    console.log("Target not found!");
}
