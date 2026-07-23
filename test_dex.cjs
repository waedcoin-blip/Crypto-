const fetch = require('node-fetch');

async function test() {
  const ids = '4NborgnPENJYf7U2ENHdmRvzsVftZhWo2Lan8Rv6pump,32CdQdBUxbCsLy5AUHWmyidfwhgGUr9N573NBUrDpump';
  const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${ids}`);
  const text = await response.text();
  console.log(text);
}
test();
