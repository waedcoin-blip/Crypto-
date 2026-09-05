import fetch from 'node-fetch';
import { ExecutionAuthority } from '../server/execution/ExecutionAuthority.js';
import { tradingSupervisor } from '../server/trading/TradingSupervisor.js';
import { assert } from 'console';

async function runTests() {
  console.log('🚀 Running Phase 3.3 Authoritative State & Auth Suite...\n');
  let failed = 0;

  // TEST 1: ExecutionAuthority Firewall in Paper Mode
  console.log('▶ [TEST 1] ExecutionAuthority Firewall in Paper Mode');
  try {
    tradingSupervisor.network = 'paper';
    tradingSupervisor.state = 'TRADING'; // Ensure state is active so it fails on network check
    
    let caught = false;
    try {
      ExecutionAuthority.assertLiveExecutionAllowed('mainnet');
    } catch (e: any) {
      caught = true;
      if (!e.message.includes('LIVE_EXECUTION_BLOCKED_IN_PAPER_MODE')) {
        console.error('  ❌ [FAIL] Expected LIVE_EXECUTION_BLOCKED_IN_PAPER_MODE, got:', e.message);
        failed++;
      } else {
        console.log('  ✔ [PASS] ExecutionAuthority correctly blocks live execution in paper mode');
      }
    }
    if (!caught) {
      console.error('  ❌ [FAIL] ExecutionAuthority allowed live execution in paper mode!');
      failed++;
    }
  } catch (e: any) {
    console.error('  ❌ [FAIL] Test 1 encountered error:', e);
    failed++;
  }

  // TEST 2: TradingSupervisor Authoritative Status Exposure
  console.log('▶ [TEST 2] TradingSupervisor Authoritative Status');
  try {
    tradingSupervisor.network = 'paper';
    const status = tradingSupervisor.getStatus();
    
    if (status.network === 'paper' && status.mode === 'paper' && status.isLiveTrading === false && status.executionAuthority === 'PAPER') {
      console.log('  ✔ [PASS] Supervisor accurately exposes authoritative PAPER state');
    } else {
      console.error('  ❌ [FAIL] Supervisor returned incorrect PAPER state:', status);
      failed++;
    }
    
    tradingSupervisor.network = 'mainnet';
    const liveStatus = tradingSupervisor.getStatus();
    
    if (liveStatus.network === 'mainnet' && liveStatus.mode === 'live' && liveStatus.isLiveTrading === true && liveStatus.executionAuthority === 'LIVE') {
      console.log('  ✔ [PASS] Supervisor accurately exposes authoritative LIVE state');
    } else {
      console.error('  ❌ [FAIL] Supervisor returned incorrect LIVE state:', liveStatus);
      failed++;
    }
  } catch (e: any) {
    console.error('  ❌ [FAIL] Test 2 encountered error:', e);
    failed++;
  }

  console.log('\n======================================================');
  console.log(`PHASE 3.3 TEST RESULTS: ${2 - failed} passed, ${failed} failed`);
  console.log('======================================================');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runTests().catch(err => {
  console.error('Fatal error during test suite execution:', err);
  process.exit(1);
});
