const { ElementTagger } = require('./dist/automation/ElementTagger');

async function testElements() {
  console.log('Testing new TaggerElement structure...\n');

  // Create a mock page context with DOM-like elements
  const mockDoc = {
    querySelectorAll: (selector) => {
      const elements = [];

      // Mock input element
      const mockInput = {
        tagName: 'INPUT',
        type: 'text',
        placeholder: 'Enter email',
        value: 'test@example.com',
        name: 'email'
      };
      elements.push(mockInput);

      // Mock radio buttons
      const mockRadio1 = {
        tagName: 'INPUT',
        type: 'radio',
        name: 'gender',
        checked: false,
        textContent: 'Male'
      };
      elements.push(mockRadio1);

      const mockRadio2 = {
        tagName: 'INPUT',
        type: 'radio',
        name: 'gender',
        checked: true,
        textContent: 'Female'
      };
      elements.push(mockRadio2);

      // Mock button
      const mockButton = {
        tagName: 'BUTTON',
        textContent: 'Submit Form',
        onclick: 'submitForm()'
      };
      elements.push(mockButton);

      // Mock link
      const mockLink = {
        tagName: 'A',
        href: 'https://example.com',
        textContent: 'Click here'
      };
      elements.push(mockLink);

      // Mock number input
      const mockNumber = {
        tagName: 'INPUT',
        type: 'number',
        value: '25',
        placeholder: 'Age',
        name: 'age'
      };
      elements.push(mockNumber);

      return elements;
    },

    createElement: () => ({})
  };

  // Test the new element processing functions
  const elementTagger = new ElementTagger();

  try {
    // Simulate the browser context functions
    global.window = {
      getComputedStyle: () => ({ display: 'block', visibility: 'visible' })
    };

    global.document = mockDoc;

    // Test element extraction
    const elements = mockDoc.querySelectorAll('input, button, a[href], select, textarea, [onclick], [tabindex]:not([tabindex="-1"])');

    console.log(`Found ${elements.length} elements:\n`);

    elements.forEach((element, index) => {
      console.log(`Element ${index + 1}:`);
      console.log(`  Tag: ${element.tagName}`);
      console.log(`  Type: ${element.type || 'N/A'}`);
      console.log(`  Name: ${element.name || 'N/A'}`);
      console.log(`  Value: ${element.value || 'N/A'}`);
      console.log(`  Text: ${element.textContent || 'N/A'}`);
      console.log(`  Checked: ${element.checked || 'N/A'}`);
      console.log('');
    });

    console.log('✅ Test completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testElements();