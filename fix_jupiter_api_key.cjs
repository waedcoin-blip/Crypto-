const fs = require('fs');
const file = 'src/services/jupiterService.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
`const getJupiterApiClient = () => {
  const customApiKey = localStorage.getItem('juipter_auto_apiKey') || '';
  if (customApiKey && customApiKey.startsWith('http')) {
    return createJupiterApiClient({ basePath: customApiKey });
  }
  return createJupiterApiClient();
};`,
`const getJupiterApiClient = () => {
  const customApiKey = localStorage.getItem('juipter_auto_apiKey') || '';
  if (customApiKey) {
    if (customApiKey.startsWith('http')) {
      return createJupiterApiClient({ basePath: customApiKey });
    } else {
      return createJupiterApiClient({ apiKey: customApiKey });
    }
  }
  return createJupiterApiClient();
};`
);

fs.writeFileSync(file, code);
