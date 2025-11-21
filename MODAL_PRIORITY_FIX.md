# Modal/Overlay Priority Fix (v2.2.1)

## Problem

AI was detecting modal overlays (showing "Detected 2 active overlay(s)/modal(s)") but still trying to click elements **behind** the modal, ignoring the blocking overlay.

### User Report
```
Он нажимает кнопку, появляется попап, система показывает "Detected 2 active overlay(s)/modal(s)"
он пытается нажать кнопку за модальным окном, игнорируя его.
```

**Symptoms:**
- System correctly detects modals with `getPageOverlayStatus()`
- Context shows "⚠️ Active Overlays Detected"
- AI sees the modal information in context
- **BUT** AI still attempts to click page elements behind the modal
- Click attempts fail because element is blocked

## Root Cause

Two issues:

1. **Insufficient instructions** - AI instructions didn't emphasize that modals MUST be dismissed FIRST before clicking page elements
2. **No enforcement** - `BrowserManager.click()` logged warnings about blocked elements but still attempted the click

Result: AI understood modals exist but didn't understand they have **priority** over other actions.

## Solution

### 1. Enhanced Instructions (ContextManager)

#### Added Rule #8 - Modal/Overlay Priority
```javascript
8. **CRITICAL - Modal/Overlay Priority**:
   - If you see "⚠️ Active Overlays Detected" section in context, you MUST use dismiss_modal FIRST
   - DO NOT try to click elements on the page while modals/overlays are active - they are blocking access
   - After dismissing modal, wait 1-2 seconds before continuing with page interactions
   - If dismiss_modal fails, use request_human_help to ask user to close the modal manually
```

#### Improved Overlay Warning in Context
**Before:**
```
## ⚠️ Active Overlays Detected
2 modal(s)/overlay(s) detected on page
...
You can use dismiss_modal action to close modals, or request human help.
```

**After:**
```
## ⚠️ ⚠️ ⚠️ CRITICAL: Active Overlays Detected ⚠️ ⚠️ ⚠️
BLOCKING ISSUE: 2 modal(s)/overlay(s) are currently active on the page.
These overlays are BLOCKING access to page elements beneath them.

🚨 ACTION REQUIRED: You MUST use dismiss_modal action BEFORE attempting to click any page elements!
...
⚠️ NEXT STEP: Use dismiss_modal action with modalIndex parameter, or request_human_help if needed.
DO NOT proceed with clicking page elements until modals are dismissed!
```

### 2. Enforced Check in BrowserManager.click()

**Before:**
```javascript
if (modals.length > 0) {
  console.log(`   Active modals detected: ${modals.length}`);
  console.log(`   Consider dismissing modals before clicking`);
}
// Still attempt click with DOM method (may work despite warning)
```

**After:**
```javascript
if (modals.length > 0) {
  console.log(`   ❌ Active modals detected: ${modals.length}`);
  console.log(`   🚨 Cannot click - element is blocked by modal overlay!`);

  // CRITICAL: Return error instead of attempting click
  return {
    success: false,
    error: `Cannot click element - blocked by ${modals.length} active modal(s). Use dismiss_modal action first to close the modal, then try clicking again.`,
    blockedByModal: true,
    modalCount: modals.length,
  };
}
```

Now the click attempt **fails immediately** with a clear error message instructing AI to use `dismiss_modal`.

## How It Works Now

### Detection Flow

1. **MainAgent** calls `browserManager.getPageOverlayStatus()` before each step
2. If overlays detected, **ContextManager** adds CRITICAL warning to context
3. AI sees prominent warning and should use `dismiss_modal` action first
4. If AI ignores warning and tries to click, **BrowserManager.click()** blocks it with error

### Two-Layer Protection

**Layer 1: Proactive (Instructions)**
- Context shows CRITICAL warning with emojis ⚠️ 🚨
- Rule #8 explicitly states modals must be dismissed first
- Next step guidance provided

**Layer 2: Reactive (Enforcement)**
- click() checks for blocking modals before attempting click
- Returns error if modal detected: `Cannot click element - blocked by N active modal(s)`
- Error message instructs to use `dismiss_modal` action

## Expected Behavior

### Scenario 1: Modal Appears After Click
```
1. AI clicks button → popup appears
2. Next step: getPageOverlayStatus() detects modal
3. Context shows: "⚠️ ⚠️ ⚠️ CRITICAL: Active Overlays Detected"
4. AI reads context, sees warning
5. AI uses: dismiss_modal action (modalIndex: 0)
6. Modal dismissed → AI continues with page interactions
```

### Scenario 2: AI Ignores Warning (Fallback)
```
1. Context shows modal warning
2. AI tries to click page element anyway (ignoring warning)
3. BrowserManager.click() detects blocking modal
4. Returns error: "Cannot click element - blocked by 2 active modal(s). Use dismiss_modal..."
5. AI receives error in result
6. AI adjusts strategy: uses dismiss_modal instead
```

## Files Modified

### `src/context/ContextManager.js`
- Lines 162-180: Enhanced overlay warning in context (CRITICAL header, emojis, next step guidance)
- Lines 285-301: Added Rule #8 about modal/overlay priority

### `src/browser/BrowserManager.js`
- Lines 305-316: Modified click() to return error when element blocked by modal

## Testing

### Manual Test
1. Navigate to page with modal triggers
2. Trigger modal (button click, page load, etc.)
3. Check console: should show "Detected N active overlay(s)/modal(s)"
4. Verify AI decision:
   - ✅ Should use `dismiss_modal` action first
   - ❌ Should NOT try to click page elements

### Error Message Test
1. Manually trigger AI to click while modal active (bypass instructions)
2. Should receive error: `Cannot click element - blocked by N active modal(s)`
3. Error should include `blockedByModal: true` and `modalCount: N`

## Edge Cases

### Multiple Modals
- System detects all active modals
- AI can specify which to dismiss via `modalIndex` parameter
- Default: dismiss first modal (index 0)

### Dismissible vs Non-Dismissible
- Context shows whether modal has close button
- If non-dismissible, AI should use `request_human_help`
- User can manually close or provide alternative approach

### Modal Fails to Dismiss
- dismiss_modal returns `success: false`
- AI should try `request_human_help` next
- Don't retry dismiss_modal in loop (loop detection will catch it)

## Performance Impact

- **Negligible** - getPageOverlayStatus() already called before each step
- click() modal check only runs if element not clickable (rare case)
- Instructions add ~150 characters to context when modal active

## Future Improvements

Optional enhancements (not implemented yet):

1. **Auto-dismiss on click**: Automatically try dismiss_modal before click()
   - Pros: Fully automatic, no AI decision needed
   - Cons: May dismiss modals user wants to read/interact with

2. **Filter HTML by z-index**: Remove elements behind modals from HTML analysis
   - Pros: AI won't see blocked elements at all
   - Cons: Complex implementation, may filter useful info

3. **Modal content extraction**: Extract text/buttons from modal itself
   - Pros: AI can interact with modal content
   - Cons: Modals already included in page content extraction

## Changelog

### v2.2.1 (Modal Priority Fix)
- ✅ Enhanced modal warning in context (CRITICAL header, emojis)
- ✅ Added Rule #8 about modal/overlay priority
- ✅ Modified click() to block clicks on modal-covered elements
- ✅ Return clear error message with dismiss_modal recommendation

## Related Issues

- **v2.2.0 - Overlay Detection**: Original implementation of getPageOverlayStatus()
- **v2.2.0 - Visibility Checking**: isElementClickable() detects covered elements
- **v2.2.0 - Modal Dismissal**: dismiss_modal action implementation

## Documentation Updates Needed

- [ ] Update CLAUDE.md with modal priority rule
- [ ] Update README.md with modal handling example
- [ ] Update V2.2_COMPLETE_SUMMARY.md with v2.2.1 notes
