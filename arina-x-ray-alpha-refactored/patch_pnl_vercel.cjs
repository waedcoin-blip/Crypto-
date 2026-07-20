const fs = require('fs');
let code = fs.readFileSync('src/components/pages/PnLPage.tsx', 'utf-8');

const targetSSE = `    const connectSSE = () => {
      console.log("🔗 Connecting to server-side Helius LaserStream stream...");
      eventSource = new EventSource('/api/laserstream/stream');

      eventSource.onerror = (err) => {
        console.error("LaserStream SSE connection error:", err);
        setLaserstreamStatus('disconnected');
        eventSource?.close();
        
        // Reconnect after 5 seconds
        reconnectTimeout = window.setTimeout(() => {
          connectSSE();
        }, 5000);
      };

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);`;

const replacementSSE = `    const connectSSE = () => {
      if (laserstreamActiveEndpoint === 'WebSocket (Vercel Fallback)') {
        // Vercel serverless doesn't support SSE, connect WebSocket directly
        console.log("🔗 Vercel Detected: Connecting directly via WebSocket...");
        const wsUrl = (laserstreamApiKey && laserstreamApiKey.length > 20) 
          ? \`wss://mainnet.helius-rpc.com/?api-key=\${laserstreamApiKey}\` 
          : 'wss://mainnet.helius-rpc.com/?api-key=e161791f-b336-40b9-80d6-f4c9f626833c';
        
        const ws = new WebSocket(wsUrl);
        let pingTimer: any = null;
        
        ws.onopen = () => {
          setLaserstreamStatus('connected');
          pingTimer = setInterval(() => ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })), 30000);
          
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'logsSubscribe',
            params: [{ mentions: [ '6EF87t756LkSg6GptZTEAtgX9v7R24C4FtsZbXm9o6RA' ] }, { commitment: 'confirmed' }]
          }));
        };
        
        ws.onmessage = (event) => {
          try {
             const data = JSON.parse(event.data);
             if (data.method === 'logsNotification') {
               const sig = data.params.result.value.signature;
               const slot = data.params.result.context.slot;
               addLog(\`⚡ Live Direct Feed: [slot: \${slot}] sig: \${sig.substring(0, 8)}... (Client WebSocket)\`, 'success');
             }
          } catch(e) {}
        };
        
        ws.onerror = () => {
           setLaserstreamStatus('disconnected');
        };
        
        ws.onclose = () => {
           setLaserstreamStatus('disconnected');
           clearInterval(pingTimer);
           reconnectTimeout = window.setTimeout(connectSSE, 5000);
        };
        
        return;
      }

      console.log("🔗 Connecting to server-side Helius LaserStream stream...");
      eventSource = new EventSource('/api/laserstream/stream');

      eventSource.onerror = (err) => {
        console.error("LaserStream SSE connection error:", err);
        setLaserstreamStatus('disconnected');
        eventSource?.close();
        
        // Reconnect after 5 seconds
        reconnectTimeout = window.setTimeout(() => {
          connectSSE();
        }, 5000);
      };

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);`;

if (code.includes(targetSSE)) {
    fs.writeFileSync('src/components/pages/PnLPage.tsx', code.replace(targetSSE, replacementSSE));
    console.log("Replaced PnLPage SSE logic successfully!");
} else {
    console.log("Target SSE not found!");
}
