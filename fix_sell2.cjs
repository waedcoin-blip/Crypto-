const fs = require('fs');
let code = fs.readFileSync('src/components/pages/PnLPage.tsx', 'utf8');

const targetStr2 = `        }).finally(() => {
          pendingSellMintsRef.current.delete(mint);
        });
        return prev;
      });
    } catch (e: any) {`;

const targetStr3 = `        }).finally(() => {
          pendingSellMintsRef.current.delete(mint);
        });
        
        return prev;
      });
    } catch (e: any) {`;


code = code.replace(targetStr2, `        }).finally(() => {
          pendingSellMintsRef.current.delete(mint);
        });
    } catch (e: any) {`);
code = code.replace(targetStr3, `        }).finally(() => {
          pendingSellMintsRef.current.delete(mint);
        });
    } catch (e: any) {`);


fs.writeFileSync('src/components/pages/PnLPage.tsx', code);
console.log("Replaced successfully 2!");
