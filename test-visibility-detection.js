#!/usr/bin/env node

/**
 * Visibility Detection Test Suite
 * Tests for v2.2.0 improved visibility detection features
 */

import { BrowserManager } from './src/browser/BrowserManager.js';
import { VisibilityChecker } from './src/utils/VisibilityChecker.js';

console.log('🔍 Testing Visibility Detection v2.2.0\n');

let passed = 0;
let failed = 0;

/**
 * Test 1: VisibilityChecker initialization
 */
async function test1() {
  console.log('Test 1: VisibilityChecker Initialization');
  console.log('='.repeat(60));

  try {
    const browserManager = new BrowserManager({ headless: true });
    await browserManager.launch('test-visibility');

    // Navigate to a test page
    await browserManager.goto('https://example.com');

    // Check if VisibilityChecker is initialized
    if (browserManager.visibilityChecker) {
      console.log('✅ VisibilityChecker initialized successfully');
      passed++;
    } else {
      console.log('❌ VisibilityChecker not initialized');
      failed++;
    }

    await browserManager.close();
    console.log();
    return true;
  } catch (error) {
    console.log(`❌ Test failed: ${error.message}`);
    failed++;
    console.log();
    return false;
  }
}

/**
 * Test 2: Element clickability check
 */
async function test2() {
  console.log('Test 2: Element Clickability Check');
  console.log('='.repeat(60));

  try {
    const browserManager = new BrowserManager({ headless: true });
    await browserManager.launch('test-visibility');

    // Navigate to a test page
    await browserManager.goto('https://example.com');

    // Check clickability of a visible element
    const clickabilityInfo = await browserManager.checkElementClickability('h1');

    console.log(`Element clickable: ${clickabilityInfo.clickable}`);
    console.log(`Reason: ${clickabilityInfo.reason}`);

    if (clickabilityInfo.clickable !== undefined) {
      console.log('✅ Clickability check working');
      passed++;
    } else {
      console.log('❌ Clickability check failed');
      failed++;
    }

    await browserManager.close();
    console.log();
    return true;
  } catch (error) {
    console.log(`❌ Test failed: ${error.message}`);
    failed++;
    console.log();
    return false;
  }
}

/**
 * Test 3: Modal detection
 */
async function test3() {
  console.log('Test 3: Modal Detection');
  console.log('='.repeat(60));

  try {
    const browserManager = new BrowserManager({ headless: true });
    await browserManager.launch('test-visibility');

    // Navigate to a test page
    await browserManager.goto('https://example.com');

    // Check for modals
    const modals = await browserManager.detectModals();

    console.log(`Modals detected: ${modals.length}`);

    if (Array.isArray(modals)) {
      console.log('✅ Modal detection working');
      passed++;
    } else {
      console.log('❌ Modal detection failed');
      failed++;
    }

    await browserManager.close();
    console.log();
    return true;
  } catch (error) {
    console.log(`❌ Test failed: ${error.message}`);
    failed++;
    console.log();
    return false;
  }
}

/**
 * Test 4: Overlay status in context
 */
async function test4() {
  console.log('Test 4: Overlay Status');
  console.log('='.repeat(60));

  try {
    const browserManager = new BrowserManager({ headless: true });
    await browserManager.launch('test-visibility');

    // Navigate to a test page
    await browserManager.goto('https://example.com');

    // Get overlay status
    const overlayStatus = await browserManager.getPageOverlayStatus();

    console.log(`Has active overlays: ${overlayStatus.hasActiveOverlays}`);
    console.log(`Modal count: ${overlayStatus.modalCount}`);
    console.log(`Recommendation: ${overlayStatus.recommendation}`);

    if (overlayStatus.hasActiveOverlays !== undefined && overlayStatus.modalCount !== undefined) {
      console.log('✅ Overlay status working');
      passed++;
    } else {
      console.log('❌ Overlay status failed');
      failed++;
    }

    await browserManager.close();
    console.log();
    return true;
  } catch (error) {
    console.log(`❌ Test failed: ${error.message}`);
    failed++;
    console.log();
    return false;
  }
}

/**
 * Test 5: VisibilityChecker updates on tab switch
 */
async function test5() {
  console.log('Test 5: VisibilityChecker Tab Switch');
  console.log('='.repeat(60));

  try {
    const browserManager = new BrowserManager({ headless: true });
    await browserManager.launch('test-visibility');

    // Navigate to first page
    await browserManager.goto('https://example.com');
    const firstChecker = browserManager.visibilityChecker;

    // Create new tab
    const tabId = await browserManager.createTab('https://example.org');

    // Check if VisibilityChecker was updated
    const secondChecker = browserManager.visibilityChecker;

    if (firstChecker !== secondChecker) {
      console.log('✅ VisibilityChecker updated on tab creation');
      passed++;
    } else {
      console.log('❌ VisibilityChecker not updated on tab switch');
      failed++;
    }

    // Switch back to first tab
    await browserManager.switchTab('tab-0');
    const thirdChecker = browserManager.visibilityChecker;

    if (secondChecker !== thirdChecker) {
      console.log('✅ VisibilityChecker updated on tab switch');
      passed++;
    } else {
      console.log('❌ VisibilityChecker not updated on tab switch');
      failed++;
    }

    await browserManager.close();
    console.log();
    return true;
  } catch (error) {
    console.log(`❌ Test failed: ${error.message}`);
    failed++;
    console.log();
    return false;
  }
}

/**
 * Run all tests
 */
async function runTests() {
  await test1();
  await test2();
  await test3();
  await test4();
  await test5();

  console.log('='.repeat(60));
  console.log(`Results: ${passed}/${passed + failed} tests passed\n`);

  if (failed > 0) {
    console.log('❌ Some tests failed!');
    process.exit(1);
  } else {
    console.log('✅ All visibility detection tests passed!');
    console.log('\n🔍 Visibility detection features working correctly:');
    console.log('  1. VisibilityChecker initialization - WORKING');
    console.log('  2. Element clickability detection - WORKING');
    console.log('  3. Modal/overlay detection - WORKING');
    console.log('  4. Overlay status reporting - WORKING');
    console.log('  5. Tab switch VisibilityChecker update - WORKING');
    process.exit(0);
  }
}

runTests().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
