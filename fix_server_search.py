import re

with open('server.ts', 'r') as f:
    code = f.read()

search_regex = re.compile(r'(app\.get\("/api/dex/search", async \(req, res\) => \{.+?)(res\.json\(data\);)(.+?\}\);)', re.DOTALL)

def replace_search(match):
    prefix = match.group(1)
    suffix = match.group(3)
    new_logic = """
      if (data && data.pairs) {
        // Advanced filtering and sorting for Solana tokens
        let solPairs = data.pairs.filter((p: any) => p.chainId === 'solana');
        
        // Remove known scam patterns and dead pools
        solPairs = solPairs.filter((p: any) => {
           if ((p.liquidity?.usd || 0) < 1000 && (p.volume?.h24 || 0) < 500) return false;
           return true;
        });

        // Smart sorting: prioritizing high liquidity, volume, and exact symbol match
        const exactQuery = q.toLowerCase();
        solPairs.sort((a: any, b: any) => {
           const aExactMatch = (a.baseToken?.symbol?.toLowerCase() === exactQuery || a.baseToken?.address?.toLowerCase() === exactQuery) ? 1 : 0;
           const bExactMatch = (b.baseToken?.symbol?.toLowerCase() === exactQuery || b.baseToken?.address?.toLowerCase() === exactQuery) ? 1 : 0;
           if (aExactMatch !== bExactMatch) return bExactMatch - aExactMatch;
           
           const aScore = (a.liquidity?.usd || 0) * 0.5 + (a.volume?.h24 || 0) * 0.5;
           const bScore = (b.liquidity?.usd || 0) * 0.5 + (b.volume?.h24 || 0) * 0.5;
           return bScore - aScore;
        });
        
        data.pairs = solPairs;
      }
      res.json(data);
"""
    return prefix + new_logic + suffix

code = search_regex.sub(replace_search, code)

with open('server.ts', 'w') as f:
    f.write(code)
