const fs = require('fs');
let content = fs.readFileSync('src/components/pages/PnLPage.tsx', 'utf8');
content = content.replace(/msg: finalMsg,\s*useEffect\(\(\) => \{/g, `msg: finalMsg,
        type: finalType,
        category: finalCategory,
        metadata: finalMetadata,
        count: 1
      };
      return [newLog, ...prev].slice(0, retentionLimit);
    });
  }, [retentionLimit]);

  useEffect(() => {`);
fs.writeFileSync('src/components/pages/PnLPage.tsx', content);
