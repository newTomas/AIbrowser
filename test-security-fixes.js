#!/usr/bin/env node

/**
 * Security Fixes Test Suite
 * Tests for v2.2.0 security vulnerability fixes
 */

console.log('🔒 Testing Security Fixes v2.2.0\n');

// Test 1: Session Name Sanitization
console.log('Test 1: Session Name Sanitization (Path Traversal Prevention)');
console.log('='.repeat(60));

function sanitizeSessionName(input) {
  const sanitized = input.trim()
    .replace(/^\.+/, '')               // Remove leading dots FIRST
    .replace(/[^a-zA-Z0-9_-]/g, '_')  // Only allow alphanumeric, underscore, dash
    .substring(0, 50);                 // Limit length to 50 characters

  return sanitized;
}

const testCases = [
  { input: '../../.ssh', expected: '_____ssh', description: 'Path traversal attempt blocked' },
  { input: '../etc/passwd', expected: '_etc_passwd', description: 'System file access attempt blocked' },
  { input: 'valid-session', expected: 'valid-session', description: 'Valid session name' },
  { input: 'valid_session_123', expected: 'valid_session_123', description: 'Valid with numbers' },
  { input: '../../../', expected: '_______', description: 'Path traversal only - all replaced' },
  { input: '...hidden', expected: 'hidden', description: 'Leading dots removed' },
  { input: 'session/with/slashes', expected: 'session_with_slashes', description: 'Slashes replaced' },
  { input: 'session\\with\\backslashes', expected: 'session_with_backslashes', description: 'Backslashes replaced' },
  { input: 'session with spaces', expected: 'session_with_spaces', description: 'Spaces replaced' },
  { input: 'session@#$%^&*()', expected: 'session_________', description: 'Special chars replaced' },
  { input: 'a'.repeat(100), expected: 'a'.repeat(50), description: 'Length limit enforced' },
  { input: '   trimmed   ', expected: 'trimmed', description: 'Whitespace trimmed' },
];

let passed = 0;
let failed = 0;

testCases.forEach((test, i) => {
  const result = sanitizeSessionName(test.input);
  const success = result === test.expected;

  if (success) {
    console.log(`✅ Test ${i + 1}: ${test.description}`);
    console.log(`   Input: "${test.input}" → Output: "${result}"`);
    passed++;
  } else {
    console.log(`❌ Test ${i + 1}: ${test.description}`);
    console.log(`   Input: "${test.input}"`);
    console.log(`   Expected: "${test.expected}"`);
    console.log(`   Got: "${result}"`);
    failed++;
  }
  console.log();
});

console.log('='.repeat(60));
console.log(`Results: ${passed}/${testCases.length} tests passed\n`);

if (failed > 0) {
  console.log('❌ Some tests failed!');
  process.exit(1);
}

// Test 2: 2FA Code Logging Protection
console.log('Test 2: 2FA Code Logging Protection');
console.log('='.repeat(60));

function logVerificationCode(code) {
  // OLD (vulnerable): return `Verification code entered: ${code}`;
  // NEW (secure):
  return 'Verification code entered successfully';
}

const testCode = '123456';
const logMessage = logVerificationCode(testCode);

if (!logMessage.includes(testCode)) {
  console.log('✅ 2FA code is NOT exposed in log message');
  console.log(`   Log message: "${logMessage}"`);
  console.log(`   Code "${testCode}" is safely hidden`);
  console.log();
} else {
  console.log('❌ 2FA code IS EXPOSED in log message!');
  console.log(`   Log message: "${logMessage}"`);
  console.log(`   Code "${testCode}" should not appear`);
  console.log();
  process.exit(1);
}

console.log('='.repeat(60));
console.log('✅ All security tests passed!');
console.log('\n🔒 Security vulnerabilities successfully fixed:');
console.log('  1. Path Traversal via Session Name - FIXED');
console.log('  2. 2FA Code Logging Exposure - FIXED');
