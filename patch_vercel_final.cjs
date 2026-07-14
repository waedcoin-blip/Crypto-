const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const target1 = `      if (process.env.VERCEL) {
        // Vercel serverless functions do not support long-lived child processes or websockets.
        // Force the client to use the WebSocket fallback.
        return res.json({ 
          success: true, 
          active: enabled, 
          options: currentStreamOptions,
          clientsCount: 0,
          isFallback: true,
          isSimulated: false,
          activeEndpoint: 'WebSocket (Vercel)'
        });
      }`;

const target2 = `      if (process.env.VERCEL || process.env.VERCEL_REGION) {
        // Vercel serverless functions do not support long-lived child processes or websockets.
        // Force the client to use the WebSocket fallback.
        return res.json({ 
          success: true, 
          active: enabled, 
          options: currentStreamOptions,
          clientsCount: 0,
          isFallback: true,
          isSimulated: false,
          activeEndpoint: 'WebSocket (Vercel Fallback)'
        });
      }`;


const target3 = `        if (process.env.VERCEL) {
          // Vercel serverless functions do not support long-lived child processes or websockets.
          // Force the client to use the WebSocket fallback.
          return res.json({ 
             success: true, 
             active: enabled, 
             options: currentStreamOptions,
            clientsCount: 0,
            isFallback: true,
            isSimulated: false,
            activeEndpoint: 'WebSocket (Vercel)'
          });
        }`;

if (code.includes('if (process.env.VERCEL')) {
  // It's there, adjust it to return WebSocket (Vercel Fallback) so the UI connects
  code = code.replace(target1, target2);
  code = code.replace(target3, target2);
  fs.writeFileSync('server.ts', code);
  console.log("patched process.env.VERCEL endpoint return logic");
}

