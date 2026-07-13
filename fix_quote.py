import re

with open('src/services/jupiterService.ts', 'r') as f:
    code = f.read()

# Add automatic route and quote validation
quote_live_regex = re.compile(r'(const quote = await quoteRes\.json\(\) as QuoteResponse;.+?if \(!quote \|\| \(quote as any\)\.error \|\| \(quote as any\)\.errorCode\) return null;)', re.DOTALL)

def replace_quote(match):
    return match.group(1) + """
    
    // Validate quote routes
    if (!quote.routePlan || quote.routePlan.length === 0) {
      console.warn(`[QUOTE REJECTED]: No valid route plan found`);
      return null;
    }
    
    // Expiration checks
    const quoteTime = (quote as any).contextSlot ? ((quote as any).contextSlot * 400) : Date.now();
    if (Date.now() - quoteTime > 15000) {
       console.warn(`[QUOTE REJECTED]: Quote is too stale based on context slot`);
       return null;
    }
"""

code = quote_live_regex.sub(replace_quote, code)

with open('src/services/jupiterService.ts', 'w') as f:
    f.write(code)

