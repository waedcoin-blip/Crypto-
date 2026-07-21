import re

with open('src/components/pages/SimRealPage.tsx', 'r') as f:
    content = f.read()

content = content.replace("const stageInfo = tokenMetric ? detectTokenStage(tokenMetric) : { type: 'UNKNOWN', isRaydiumListed: false };", "const stageInfo = tokenMetric ? detectTokenStage(tokenMetric) : { stage: 'UNKNOWN', platform: 'UNKNOWN', isBonding: false, isMigrated: false, isNewListing: false, isNearMigration: false, bondingProgress: 0 } as const;")
content = content.replace("|| stageInfo.isRaydiumListed", "|| stageInfo.isMigrated")

with open('src/components/pages/SimRealPage.tsx', 'w') as f:
    f.write(content)

