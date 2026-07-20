const fs = require('fs');
let code = fs.readFileSync('src/components/pages/PnLPage.tsx', 'utf-8');

const target = `        const res = await fetch('/api/laserstream/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            enabled: laserstreamEnabled,
            apiKey: laserstreamApiKey,
            endpoint: laserstreamEndpoint,
            customWsUrl: externalSettings.customWsUrl,
            programAddresses: [
              '6EF87t756LkSg6GptZTEAtgX9v7R24C4FtsZbXm9o6RA', // Pump.fun Program
              '675k1q2AYp74sk2Wym6L6nd56N7Y5D7T6jhpxS22bbe'  // Raydium AMM Program
            ]
          })
        });
        const data = await res.json();
        if (data.success && data.active) {`;

const replacement = `        const res = await fetch('/api/laserstream/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            enabled: laserstreamEnabled,
            apiKey: laserstreamApiKey,
            endpoint: laserstreamEndpoint,
            customWsUrl: externalSettings.customWsUrl,
            programAddresses: [
              '6EF87t756LkSg6GptZTEAtgX9v7R24C4FtsZbXm9o6RA', // Pump.fun Program
              '675k1q2AYp74sk2Wym6L6nd56N7Y5D7T6jhpxS22bbe'  // Raydium AMM Program
            ]
          })
        });
        
        let data = { success: false, active: false, isFallback: false, isSimulated: false, activeEndpoint: null };
        if (res.ok) {
           const contentType = res.headers.get("content-type");
           if (contentType && contentType.includes("application/json")) {
               data = await res.json();
           } else {
               // Vercel deployment without backend, fallback to client-side websocket
               data = { success: true, active: laserstreamEnabled, isFallback: true, isSimulated: false, activeEndpoint: 'WebSocket (Vercel Fallback)' };
           }
        } else {
           data = { success: true, active: laserstreamEnabled, isFallback: true, isSimulated: false, activeEndpoint: 'WebSocket (Network Fallback)' };
        }

        if (data.success && data.active) {`;

if (code.includes(target)) {
    fs.writeFileSync('src/components/pages/PnLPage.tsx', code.replace(target, replacement));
    console.log("Replaced laserstream successfully!");
} else {
    console.log("Target not found!");
}
