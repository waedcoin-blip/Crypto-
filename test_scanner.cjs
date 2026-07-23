const fetch = require('node-fetch');

async function test() {
  const response = await fetch('http://localhost:3000/api/dex/tokens/trending');
  const data = await response.json();
  console.log(data);
}
test();
