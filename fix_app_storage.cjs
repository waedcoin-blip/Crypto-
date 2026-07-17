const fs = require('fs');
const file = 'src/App.tsx';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
`  useEffect(() => {
    localStorage.setItem('app_buyAmountSol', buyAmountSol.toString());`,
`  useEffect(() => {
    localStorage.setItem('juipter_auto_apiKey', apiKey);
  }, [apiKey]);
  useEffect(() => {
    localStorage.setItem('juipter_auto_privateKey', privateKey);
  }, [privateKey]);
  useEffect(() => {
    localStorage.setItem('app_buyAmountSol', buyAmountSol.toString());`
);

fs.writeFileSync(file, code);
