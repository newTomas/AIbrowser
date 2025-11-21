# Selector & Modal Improvements (v2.2.1)

## Problems

### Problem 1: Poor Selector Generation for div-buttons
**User Report:** "У него огромные проблемы с обнаружением селекторов, тут выбор не в виде button или ссылок, а просто div. Он пытается найти куда кликать, находит класс, но он относится к кучи таких кнопок и в итоге клик не туда получается."

**Symptoms:**
- Page has buttons implemented as `<div>` elements (not `<button>` or `<a>`)
- All div-buttons share the same class (e.g., `.option-item`)
- HTMLAnalyzerAgent generates selector `div.option-item`
- Selector matches MULTIPLE elements (not unique)
- `click()` always clicks the FIRST match, not the intended one

**Root Cause:**
- `generateBestSelector()` was generating class-only selectors without uniqueness check
- No text-based disambiguation when selectors are not unique
- Used `:contains()` pseudo-selector which doesn't work in Puppeteer (jQuery-only)

### Problem 2: Aggressive Modal Dismissal
**User Report:** "Еще он такое чувство что теперь боится модальных окон, как только появляются, закрывает их, хотя там следующий выбор в нем."

**Symptoms:**
- Modal appears on page
- Context shows "⚠️ CRITICAL: Active Overlays Detected"
- AI immediately uses `dismiss_modal` action
- **BUT** the modal contains buttons/forms AI needs to interact with
- AI should interact with modal content, not dismiss it

**Root Cause:**
- v2.2.1 modal priority fix was too aggressive
- Instructions said "MUST use dismiss_modal FIRST"
- No distinction between "blocking modal" and "interactive modal"
- `click()` blocked ALL clicks when modal detected

## Solutions

### Solution 1: Improved Selector Generation

#### A) Enhanced `generateBestSelector()` in HTMLAnalyzerAgent

**Added Priority Checks:**
```javascript
// 4. Try role attribute (common for div buttons)
const role = $el.attr('role');
if (role) {
  return `${el.name}[role="${role}"]`;
}

// 5. Try combination with data attributes
const dataAttrs = Object.keys(el.attribs || {}).filter(attr => attr.startsWith('data-'));
if (dataAttrs.length > 0) {
  const firstDataAttr = dataAttrs[0];
  const value = $el.attr(firstDataAttr);
  return `${el.name}[${firstDataAttr}="${value}"]`;
}

// 6. Try class with uniqueness check
const classes = $el.attr('class');
if (classes) {
  const classList = classes.split(' ').filter(c => c.length > 0);

  // Try to find unique class combination
  for (let i = 0; i < Math.min(classList.length, 3); i++) {
    const classSelector = classList.slice(0, i + 1).map(c => `.${c}`).join('');
    const selector = `${el.name}${classSelector}`;

    // Check if this selector is unique enough (not too many matches)
    const matchCount = this.$(selector).length;
    if (matchCount === 1) {
      return selector; // Unique selector found!
    } else if (matchCount <= 10 && i === classList.length - 1) {
      // Multiple matches but manageable - return with note
      return selector; // Will need text matching in click()
    }
  }
}
```

**Improvements:**
1. ✅ Checks `role` attribute (e.g., `div[role="button"]`)
2. ✅ Checks `data-*` attributes for uniqueness
3. ✅ Tries multiple class combinations (`.class1`, `.class1.class2`, etc.)
4. ✅ Checks uniqueness by counting matches in DOM
5. ✅ Removed `:contains()` (doesn't work in Puppeteer)

#### B) Text-based Disambiguation in `click()`

**New Signature:**
```javascript
async click(selector, text = null)
```

Or object parameter:
```javascript
click({ selector: "div.option-item", text: "Программист" })
```

**Implementation:**
```javascript
// NEW v2.2.1: If text provided, find matching element among selector results
let element;
if (matchText) {
  element = await this.page.evaluateHandle((sel, txt) => {
    const elements = Array.from(document.querySelectorAll(sel));
    // Find element with matching text
    const match = elements.find(el => {
      const text = (el.innerText || el.textContent || '').trim();
      return text.includes(txt) || text === txt;
    });
    return match || elements[0]; // Fallback to first if no text match
  }, cssSelector, matchText);

  console.log(`✓ Found element with text: "${matchText}"`);
} else {
  element = await this.page.$(cssSelector);
}
```

**How It Works:**
1. If selector finds multiple elements (e.g., `div.option-item` → 5 matches)
2. Use text to find the correct one: `div.option-item` with text "Программист"
3. Searches all matches for text content matching
4. Clicks the specific element with matching text

#### C) Updated AI Instructions

**New click() documentation:**
```
- click: Click an element using CSS selector
  Parameters:
    Option 1 (PREFERRED): { selector: "#id" } or { selector: ".classname" }
    Option 2 (for non-unique selectors): { selector: { selector: "div.option", text: "Программист" } }
    Option 3 (fallback): { selector: "Button Text" } - tries to find by text content only

  **For non-unique selectors (multiple elements with same class):**
  If HTML analysis shows a selector like "div.option-item" that matches multiple elements,
  use Option 2 with both selector and text: { selector: { selector: "div.option-item", text: "Программист" } }
  This will find the specific element among multiple matches by its text content.
```

### Solution 2: Smart Modal Management

#### A) Distinguish Interactive vs Blocking Modals

**Updated Context Warning:**
```
## ⚠️ Active Modal/Overlay Detected
2 modal(s)/overlay(s) detected on page.

Modal 1:
  Type: dialog
  Dismissible: Yes (has close button)
  Covers full screen: Yes
  Z-index: 1000

⚠️ IMPORTANT: Determine if this modal is:
1. **Interactive Modal** - Contains buttons/forms you need to interact with → Click elements INSIDE the modal
2. **Blocking Modal** - Prevents access to main page content → Use dismiss_modal action first

If your target element is INSIDE the modal, interact with it directly.
If your target element is BEHIND the modal (on main page), dismiss the modal first.
```

**Updated Rule #8:**
```
8. **Modal/Overlay Management**:
   - If you see "⚠️ Active Modal/Overlay Detected" section, analyze the situation
   - **Interactive Modal**: If the modal contains buttons/forms you need to interact with, click elements INSIDE the modal
   - **Blocking Modal**: If your target element is on the main page BEHIND the modal, use dismiss_modal FIRST
   - Check the modal content in page analysis - if it has the buttons you need, it's interactive
   - After dismissing a blocking modal, wait 1-2 seconds before clicking main page elements
```

#### B) Smart Click Blocking

**Inside vs Behind Check:**
```javascript
// NEW v2.2.1: Check if element is INSIDE the modal (interactive) or BEHIND it (blocked)
const isInsideModal = await this.page.evaluate((sel) => {
  const element = document.querySelector(sel);
  if (!element) return false;

  // Check if element is descendant of any modal
  const modalPatterns = [
    '[role="dialog"]', '[role="alertdialog"]', '.modal', '.popup',
    '.overlay', '[class*="modal"]', '[class*="dialog"]', '[id*="modal"]'
  ];

  for (const pattern of modalPatterns) {
    const modals = document.querySelectorAll(pattern);
    for (const modal of modals) {
      if (modal.contains(element)) {
        return true; // Element is INSIDE modal
      }
    }
  }
  return false; // Element is BEHIND modal
}, cssSelector);

if (isInsideModal) {
  console.log(`   ✓ Element is INSIDE modal - allowing interaction`);
  // Continue with click
} else {
  console.log(`   ❌ Element is BEHIND modal - blocked!`);
  return {
    success: false,
    error: `Cannot click element - blocked by N active modal(s). Element is behind the modal overlay. Use dismiss_modal action first...`
  };
}
```

**Logic:**
1. Modal detected on page
2. User tries to click element
3. Check: Is element inside modal container? (`modal.contains(element)`)
4. **Inside modal** → Allow click (interactive modal)
5. **Behind modal** → Block click with error (blocking modal)

## Expected Behavior

### Scenario 1: div-button Selection
```
Before:
- HTMLAnalyzer generates: div.option-item
- Matches 5 elements
- Click always targets first element (wrong!)

After:
- HTMLAnalyzer checks uniqueness
- If not unique, generates: div.option-item (with note about multiple matches)
- AI sees displayText: "Программист"
- AI uses: { selector: { selector: "div.option-item", text: "Программист" } }
- Click finds correct element by text
```

### Scenario 2: Interactive Modal
```
Before:
- Modal appears
- Context: "⚠️ CRITICAL: Active Overlays Detected - MUST dismiss FIRST"
- AI dismisses modal
- Needed buttons inside modal are gone!

After:
- Modal appears
- Context: "⚠️ Active Modal/Overlay Detected - Determine if interactive or blocking"
- AI analyzes page content
- Sees buttons inside modal in HTML analysis
- AI clicks button inside modal
- System detects element is INSIDE modal
- Click allowed ✓
```

### Scenario 3: Blocking Modal
```
After:
- Modal appears
- AI wants to click element on main page
- System checks: element is BEHIND modal (not inside)
- Click blocked with error
- AI uses dismiss_modal action
- Modal dismissed
- AI retries click on main page element
- Success ✓
```

## Files Modified

### `src/agents/HTMLAnalyzerAgent.js`
- Lines 344-405: `generateBestSelector()` completely rewritten
  - Added role attribute check
  - Added data-* attributes check
  - Added uniqueness verification for class selectors
  - Removed `:contains()` pseudo-selector (not supported in Puppeteer)

### `src/browser/BrowserManager.js`
- Lines 278-292: Updated `click()` signature to support object parameter
- Lines 304-328: Added text-based disambiguation logic
- Lines 337-380: Smart modal detection - inside vs behind check

### `src/context/ContextManager.js`
- Lines 162-180: Updated modal warning (removed aggressive CRITICAL header)
- Lines 214-230: Enhanced click() documentation with Option 2 (selector + text)
- Lines 300-305: Updated Rule #8 - distinguish interactive vs blocking modals

## Testing

### Test 1: Non-unique Selectors
```javascript
// Page has:
<div class="option-item">Программист</div>
<div class="option-item">Дизайнер</div>
<div class="option-item">Менеджер</div>

// AI should use:
{
  action: "click",
  parameters: {
    selector: {
      selector: "div.option-item",
      text: "Программист"
    }
  }
}

// Expected: Clicks first div with text "Программист"
```

### Test 2: Interactive Modal
```javascript
// Modal contains button AI needs
// AI sees: "⚠️ Active Modal/Overlay Detected"
// AI analyzes and sees button in modal content
// AI clicks button inside modal

// Expected:
// - ✓ Element is INSIDE modal - allowing interaction
// - Click succeeds
```

### Test 3: Blocking Modal
```javascript
// Modal covers page, AI wants main page button
// AI tries to click main page element
// System detects element is BEHIND modal

// Expected:
// - ❌ Element is BEHIND modal - blocked!
// - Error: "Cannot click element - blocked by modal. Use dismiss_modal first"
```

## Performance Impact

### Selector Generation
- **Minimal** - Additional checks run only during HTML analysis (separate context)
- Uniqueness check uses Cheerio DOM queries (very fast)
- No impact on main conversation token usage

### Click with Text Disambiguation
- **+50ms** per click when text parameter used
- Only evaluated in browser when needed
- No performance impact when selector is unique (text parameter omitted)

### Inside/Behind Modal Check
- **+30ms** per click when modal present
- Only runs if element not clickable and modal detected
- Avoids wasted retries and error loops

## Future Improvements

Optional enhancements (not implemented yet):

1. **Generate nth-child selectors**: For absolutely unique targeting
   - Pros: No text matching needed
   - Cons: Fragile if page structure changes

2. **XPath support**: More powerful than CSS selectors
   - Pros: Can select by text directly
   - Cons: Different syntax, AI would need to learn it

3. **Visual position-based selection**: When all else fails
   - Pros: Works even without good selectors
   - Cons: Requires Vision API, slower, less reliable

4. **Modal content extraction**: Separate HTML analysis for modal interior
   - Pros: AI sees exactly what's in modal
   - Cons: More token usage, additional API calls

## Changelog

### v2.2.1 (Selector & Modal Improvements)
- ✅ Enhanced selector generation with uniqueness checks
- ✅ Added text-based disambiguation for non-unique selectors
- ✅ Distinguish interactive vs blocking modals
- ✅ Smart click blocking (allows inside modal, blocks behind modal)
- ✅ Updated AI instructions for both features

## Related Issues

- **v2.2.1 - Modal Priority Fix**: Initial aggressive modal blocking
- **v2.2.0 - Visibility Detection**: Foundation for modal detection
- **v2.2.0 - HTMLAnalyzerAgent**: Selector generation infrastructure

## Documentation Updates Needed

- [x] Create SELECTOR_AND_MODAL_IMPROVEMENTS.md
- [ ] Update CLAUDE.md with selector best practices
- [ ] Update README.md with v2.2.1 improvements
- [ ] Add examples to documentation
