const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

// 1. Remove val === 2 ? 3 : val
content = content.replace(/const val = Number\(data\.maxRebuyTimes\);\s*setMaxRebuyTimes\(val === 2 \? 3 : val\);/g, 'const val = Number(data.maxRebuyTimes);\n            setMaxRebuyTimes(val);');

// 2. Fix the race condition
content = content.replace(/const isFirestoreLoading = useRef\(false\);/g, 'const isFirestoreLoading = useRef(true);');

content = content.replace(/useEffect\(\(\) => \{\s*if \(\!user\) return;\s*const loadSettings = async \(\) => \{/g, `useEffect(() => {
    if (!authLoaded) return;
    if (!user) {
      isFirestoreLoading.current = false;
      return;
    }
    const loadSettings = async () => {`);

// Also need to add authLoaded to dependency array of this effect
content = content.replace(/loadSettings\(\);\s*\}, \[user\]\);/g, 'loadSettings();\n  }, [user, authLoaded]);');

fs.writeFileSync('src/App.tsx', content);
console.log('App.tsx patched');
