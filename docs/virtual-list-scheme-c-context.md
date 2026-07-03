# Virtual List Scheme C Context

## Goal
Eliminate visual flickering/jitter at the bottom of a virtual list during AI streaming (especially long thinking blocks).

## Tech Stack
- `@tanstack/react-virtual` v3.14.5 (upgraded from 3.13.24)
- `@tanstack/virtual-core` v3.17.3
- File: `src/renderer/src/components/MessageList.tsx`
- Constant: `MESSAGE_ROW_GAP = 4` (from `layoutConstants.ts`)

## Final Virtualizer Config

```typescript
const rowVirtualizer = useVirtualizer({
  count: renderItems.length,
  getScrollElement: () => containerRef.current,
  getItemKey,
  estimateSize: (index) => estimateRenderItemHeight(renderItems[index]),
  overscan: 8,
  gap: MESSAGE_ROW_GAP,        // 4px item spacing
  anchorTo: 'end',             // bottom anchoring
  followOnAppend: true,        // follow new messages
  scrollEndThreshold: 10,      // "at end" threshold: 10px
  paddingEnd: 16,              // bottom breathing room (replaces CSS pb-8)
})
```

## Render Structure (Official chat.md Pattern)

```tsx
<div ref={containerRef}>                           // scroll container
  <div className="mx-auto px-5 pt-6 user-content">  // Note: no pb-8
    <div style={{ height: getTotalSize() }}>          // spacer
      {virtualItems.map(virtualItem => (
        <div
          ref={measureElement}
          style={{
            position: 'absolute',
            top: 0, left: 0, width: '100%',
            transform: `translateY(${virtualItem.start}px)`,  // individual positioning
          }}
        >
          <RenderItemRenderer />
        </div>
      ))}
    </div>
  </div>
</div>
```

## Attempted & Discarded Approaches

| Approach | Result | Reason |
|----------|--------|--------|
| `useAnimationFrameWithResizeObserver: true` | Removed | Docs: "Generally should not be enabled". Causes 1-frame position lag, making jitter worse |
| Block translation (all items in one absolute div, natural flow layout) | Incompatible with `anchorTo`, worse flicker | Official chat example uses individual positioning, not block translation |
| `scrollEndThreshold: 80` | Severe drift | `anchorTo` does incremental adjustment (`scrollTop += totalSizeDelta`), not absolute `scrollToEnd()`. Large threshold lets viewport sit at the threshold edge, increment can't close the gap |
| `directDomUpdates: true` + `containerRef` | Freezes after long streaming | Official example may not be tested for prolonged streaming |

## Known Issue

Slight bottom drift after prolonged streaming (viewport slowly moves away from the bottom).

**Root cause**: `anchorTo: 'end'` uses `applyScrollAdjustment(totalSizeDelta)` — incremental scroll position adjustment, not absolute `scrollToEnd()`. During rapid streaming, small errors accumulate and the viewport drifts away from the bottom.

## Why Each Config Choice

| Config | Rationale |
|--------|-----------|
| Individual `absolute` + `translateY(start)` | Only positioning pattern in official chat.md, compatible with `anchorTo` |
| `paddingEnd: 16` replaces CSS `pb-8` | CSS padding sits outside the spacer, virtualizer doesn't know about it, so `scrollToEnd()` scrolls to wrong position. `paddingEnd` is included in `getTotalSize()` |
| `gap: MESSAGE_ROW_GAP` | Provides visual spacing between individually-positioned items |
| `scrollEndThreshold: 10` | Threshold of 1: stops adjusting after slight drift (freezes). Threshold of 80: too much drift. 10 is the compromise |
| No manual ResizeObserver/scrollToEnd | User explicitly rejected hand-rolled approach, prefers TanStack Virtual built-in mechanisms |
