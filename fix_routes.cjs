const fs = require('fs');
let code = fs.readFileSync('server/routes/dexscreener.ts', 'utf8');

const regexMint = /\/\/ GET \/api\/dex\/tokens\/:mint\nrouter\.get\('\/tokens\/:mint'[\s\S]*?(?=\/\/ GET \/api\/dex\/tokens\/trending)/;
const matchMint = code.match(regexMint);

const regexTrending = /\/\/ GET \/api\/dex\/tokens\/trending\nrouter\.get\('\/tokens\/trending'[\s\S]*?(?=\/\/ GET \/api\/dex\/token-profiles)/;
const matchTrending = code.match(regexTrending);

if (matchMint && matchTrending) {
  code = code.replace(matchTrending[0], '');
  code = code.replace(matchMint[0], matchTrending[0] + '\n\n' + matchMint[0]);
  fs.writeFileSync('server/routes/dexscreener.ts', code);
  console.log("Fixed route order");
} else {
  console.log("Could not find routes to swap");
}
