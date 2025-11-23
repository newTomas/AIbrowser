#!/usr/bin/env node

// Simple test to check tab creation
const { chromium } = require('playwright');

async function testTabCreation() {
  console.log('Testing Playwright tab creation...');

  const browser = await chromium.launch({
    headless: false
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 }
  });

  console.log('Context created');

  // Check if pages exist after context creation
  const initialPages = context.pages();
  console.log(`Initial pages after context creation: ${initialPages.length}`);

  // Set up event listener
  context.on('page', (page) => {
    console.log(`New page event triggered: ${page.url()}`);
  });

  // Create a new page
  console.log('Creating first page...');
  const page1 = await context.newPage();
  console.log('First page created');

  const pagesAfterFirst = context.pages();
  console.log(`Pages after first creation: ${pagesAfterFirst.length}`);

  // Try to create second page manually
  console.log('Creating second page...');
  const page2 = await context.newPage();
  console.log('Second page created');

  const pagesAfterSecond = context.pages();
  console.log(`Pages after second creation: ${pagesAfterSecond.length}`);

  await browser.close();
  console.log('Test completed');
}

testTabCreation().catch(console.error);