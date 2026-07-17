# 计划：块级内容折叠体验优化（Thinking clamp / 尾部锚定 / sticky Show more / Read 聚合增强）

本计划覆盖 4 个需求，涉及 6 个文件（2 个新建，4 个修改）。所有调研已完成，按本文档执行即可，不需要再读其他代码做决策。

## 需求回顾

1. **Thinking block 加最大高度**：和 ToolBlock 一样（300px），超出显示 Show more 按钮。
2. **所有有最大高度限制的块，折叠时显示内容的最后几行（尾部锚定）**，而不是前几行。要求优雅、高性能、可维护。
3. **Show more/less 按钮 sticky 化**：展开一个超长块后，按钮（变成 Show less）要一直悬浮在滚动视口底部附近，滚到块末尾时落回它在卡片里的自然位置。Sidebar 的 Show less 也要同样效果。
4. **Read 聚合视图（"Looked into N files"，即 `CollapsedReadGroup`）增强**：
   - a. 两个 read 聚合块中间的 thinking-only assistant 块，不再单独展示，折叠进聚合块成为一行（形如 `thinking blablabla…`）。
   - b. 去掉"最后一个命令行上的光栅（shimmer）动画"，改为在列表下方加一行 `Working...` 文字，动画做在它上面（因为 read 通常很快完成，慢的是模型思考，动画在 read 行上误导）。
   - c. 折叠列表每行最前面加状态图标：成功打绿色勾、失败打红色 x，颜色与 ToolBlock 的 STATUS_CONFIG 一致（success `#166534`、error `#991b1b`、cancelled `#3f3f46`）。

## 核心技术决策（已实现验证思路，照做即可）

### 决策 1：尾部锚定用纯 CSS，不做 JS 切片

被 clamp 的内容容器用 `display: flex; flex-direction: column; justify-content: flex-end` + `max-height` + `overflow: hidden`。内容超高时，溢出部分从**顶部**被裁掉，视口内自然显示最后几行。

- 优雅、零 JS 计算、流式内容（streaming）自动跟随、文本选择/搜索高亮不受影响。
- 配套的淡出 mask 从"底部淡出"改为"**顶部淡出**"（因为切口在顶部）：
  `linear-gradient(to bottom, transparent, black 16px)`。
- 展开时 `max-height` 移除，`justify-end` 在无高度约束时无任何副作用，可以常挂。

### 决策 2：sticky Show less 用 `position: sticky; bottom: N`

按钮放在卡片内、内容之后（DOM 顺序在内容后面，自然绘制在其上方）。当卡片比视口高时，`sticky bottom-4` 会把按钮从它的自然位置（卡片底部）向上推，悬浮在滚动视口底部上方 16px 处；滚到卡片末尾时落回自然位置。这正是需求 3 描述的行为，纯 CSS 实现。

**关键陷阱：sticky 会被中间任何 `overflow: hidden/auto/scroll` 的祖先"截获"**（sticky 相对于最近的 scrollport 定位，overflow:hidden 的祖先会成为一个不能滚动的 scrollport，sticky 失效）。

- 消息列表区的滚动容器是 `MessageList.tsx` 里 `data-testid="message-list"` 的 div。
- Sidebar 列表区的滚动容器是 `sidebar/index.tsx` 里的 `SidebarGroupContent`（`overflow-auto no-scrollbar content-fade-bottom`）。
- 因此按钮与滚动容器之间的所有祖先都**不能有 overflow:hidden/auto/scroll**。需要视觉裁切圆角的卡片，把 `overflow-hidden` 改成 **`overflow-clip`**（`overflow: clip` 不创建 scroll container，sticky 不受影响；Tailwind v4 有 `overflow-clip` 类。本项目 tailwindcss ^4.2.2，支持）。
- 虚拟列表（@tanstack/react-virtual）的 `transform: translateY(...)` 包裹层**不影响** sticky（transform 只影响 fixed/absolute 的 containing block）。
- 按钮的 sticky 活动范围 = 它的 containing block（即卡片 div），所以按钮不可能飘出卡片范围，也不会和后面的卡片重叠——卡片滚走前按钮已经随卡片落回自然位置。

**按钮样式改为小药丸（pill）**：因为它悬浮时会压在滚动的内容上方，需要有背景。统一样式：

```
sticky bottom-4 z-10 mt-1 w-fit rounded-full border border-border/65 bg-background px-2.5 py-0.5 text-xs text-muted-foreground shadow-sm hover:text-foreground
```

- `bottom-4`（16px）刚好避开 MessageList 底部 `h-4` 的渐变 fade（absolute、pointer-events-none）。
- 折叠状态下按钮本来就在视口内，sticky 无副作用。

### 决策 3：抽出共享组件 `OverflowClamp`

三处需要 clamp + tail 锚定 + sticky 按钮（ToolBlock 内容、ThinkingBlock、UserBubble），抽成一个组件保证可维护性。

### 决策 4：thinking 吸收用"后处理合并"，保证分组 id 稳定

`buildRenderItems` 先按现有逻辑分租，再做一次线性扫描：遇到 `[readGroup, thinkingOnlyAssistant, readGroup]` 模式，把 thinking 和后一个组合并进前一个组。组 id 仍取第一个工具节点的 `group-<id>`，`expandedGroupIds` 的展开状态不会因合并丢失。

- thinking-only 定义：`role === 'assistant' && thinking.length > 0 && text.length === 0 && !errorMessage`。
- 只有**夹在两个组之间**的 thinking 才吸收（严格符合需求措辞）。组后面跟的"收尾思考"（后面没有更多 read）保持独立 ThinkingBlock 展示——它本身就是用户要看的内容，也自然承担了"正在工作"的指示作用。
- 连续多个 thinking 的情况天然处理：`g1, t1, g2, t2, g3` 会级联合并成一个大组（t1、t2 都在里面）。

---

## 文件变更明细

### 1. 修改 `src/renderer/src/lib/layoutConstants.ts`

新增共享常量（消除现有 `TOOL_BLOCK_MAX_HEIGHT` 和 `TOOL_BLOCK_CONTENT_MAX_HEIGHT` 两处重复定义）：

```ts
/** Max height (px) for collapsible block content (tool output, thinking) before showing expand button */
export const BLOCK_CONTENT_MAX_HEIGHT = 300;
```

### 2. 新建 `src/renderer/src/components/overflowClamp.tsx`

共享 clamp 组件。要点：

- 外层 div：`flex flex-col justify-end overflow-hidden`，inline style 里始终带 `maxHeight`（折叠时）——**必须保持 inline style**，因为 `MessageList.tsx` 的搜索自动展开逻辑用 `root.querySelector('[style*="max-height"]')` 找这个元素（见下文"不要踩的坑"）。
- 内层 div 包裹 children，用于 ResizeObserver 测量真实内容高度。注意：内层 div 加 `flow-root` 类（建立 BFC），防止子元素（如 `pre.mt-2`）的 margin 塌陷到内层 div 之外导致 `offsetHeight` 少算。
- 用 ResizeObserver 观察内层 div，而不是 useEffect + scrollHeight：外层被 clamp 住之后自身高度不变，RO 不会触发；内层高度随流式内容增长，RO 每次都触发。RO 在 `observe()` 后会立即回调一次，无需手动初始测量。
- 按钮带 `data-action="expand-overflow"` 属性——**搜索自动展开依赖这个 attribute**，不能删改。

完整实现：

```tsx
import { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/utils';

/** Fade applied at the top edge where tail-anchored content is clipped */
const TAIL_FADE_MASK = 'linear-gradient(to bottom, transparent, black 16px)';

/**
 * Clamps tall content to `maxHeight`, keeping the LAST lines visible instead
 * of the first: content sits in a flex column anchored to the bottom
 * (`justify-end`), so overflow is clipped at the top where a fade mask
 * softens the cut. Pure CSS — no JS slicing, streaming-friendly.
 *
 * The Show more/less toggle is a sticky pill: while scrolling through long
 * expanded content it hovers above the bottom of the scrollport, and settles
 * into its natural place at the end of the block. Sticky requires that no
 * ancestor between this component and the scroll container has
 * `overflow: hidden/auto/scroll` — use `overflow: clip` where visual
 * clipping (e.g. rounded corners) is needed.
 */
export default function OverflowClamp({
  maxHeight,
  children,
  className,
  contentStyle,
  buttonClassName,
}: {
  /** Max visible height in px while collapsed */
  maxHeight: number;
  children: React.ReactNode;
  /** Extra classes for the clamped content wrapper */
  className?: string;
  /** Extra inline styles for the clamped content wrapper */
  contentStyle?: React.CSSProperties;
  /** Extra classes for the Show more/less button */
  buttonClassName?: string;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const innerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;
    // inner grows with streamed content even while the outer box is clamped
    const observer = new ResizeObserver(() => {
      setIsOverflowing(inner.offsetHeight > maxHeight);
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, [maxHeight]);

  const clamped = !expanded && isOverflowing;

  return (
    <>
      <div
        className={cn('flex flex-col justify-end overflow-hidden', className)}
        style={{
          ...contentStyle,
          // inline max-height is required: message search auto-expand
          // locates this element via '[style*="max-height"]'
          maxHeight: expanded ? undefined : maxHeight,
          maskImage: clamped ? TAIL_FADE_MASK : undefined,
          WebkitMaskImage: clamped ? TAIL_FADE_MASK : undefined,
        }}
      >
        <div ref={innerRef} className="flow-root min-h-px">
          {children}
        </div>
      </div>
      {isOverflowing && (
        <button
          type="button"
          data-action="expand-overflow" // search auto-expand relies on this attr
          onClick={() => setExpanded((current) => !current)}
          className={cn(
            'sticky bottom-4 z-10 mt-1 w-fit rounded-full border border-border/65 bg-background px-2.5 py-0.5 text-xs text-muted-foreground shadow-sm hover:text-foreground',
            buttonClassName,
          )}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </>
  );
}
```

注意：组件返回 fragment（内容 div + 按钮是兄弟节点），这样按钮的 containing block 是**调用方的卡片 div**，sticky 活动范围覆盖整个卡片。不要在组件根部再包一层 div。

### 3. 新建 `src/renderer/src/components/thinkingBlock.tsx`

从 `MessageList.tsx` 抽出 `ThinkingBlock`，加上 clamp。`CollapsedReadGroup` 展开态也要复用它。

```tsx
import OverflowClamp from './overflowClamp';
import { BLOCK_CONTENT_MAX_HEIGHT } from '../lib/layoutConstants';

export default function ThinkingBlock({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="rounded-md bg-muted/70 px-3 py-1.5 text-muted-foreground">
      <div className="text-[13px] font-medium" data-search-ignore>
        Thinking
      </div>
      <OverflowClamp maxHeight={BLOCK_CONTENT_MAX_HEIGHT}>
        <pre className="whitespace-pre-wrap break-words font-sans text-[14px] leading-5 text-muted-foreground">
          {text}
        </pre>
      </OverflowClamp>
    </div>
  );
}
```

注意：这个卡片本身没有 overflow（背景是卡片自己绘制的，圆角天然生效，不需要 overflow 裁切），所以 sticky 按钮直接可用，无需改动卡片。

### 4. 新建 `src/renderer/src/lib/readGrouping.ts`

把分组逻辑从 `MessageList.tsx` 移出来（避免 `MessageList` ↔ `CollapsedReadGroup` 循环 import；type-only 循环虽然可行，但放 lib 更干净）。

```ts
import {
  type AssistantNode,
  type ToolNode,
  type TranscriptNode,
  getToolArgs,
} from '../state/transcriptController';
import { isReadOnlyBashCommand } from './readOnlyCommand';

/** A read group entry is either a read-only tool call or an absorbed thinking-only assistant message */
export type ReadGroupEntry =
  | { kind: 'tool'; node: ToolNode }
  | { kind: 'thinking'; node: AssistantNode };

/** A render item is either a single transcript node or a collapsed group of read-only entries */
export type RenderItem =
  | { type: 'node'; node: TranscriptNode; id: string }
  | { type: 'readGroup'; entries: ReadGroupEntry[]; id: string };

function isReadToolNode(node: TranscriptNode): boolean {
  if (node.role !== 'tool') return false;
  if (node.name === 'read') return true;
  if (node.name === 'bash') {
    const args = getToolArgs(node);
    const command = typeof args?.command === 'string' ? args.command : '';
    return isReadOnlyBashCommand(command);
  }
  return false;
}

function isThinkingOnlyNode(node: TranscriptNode): node is AssistantNode {
  return (
    node.role === 'assistant' &&
    node.thinking.length > 0 &&
    node.text.length === 0 &&
    !node.errorMessage
  );
}

/**
 * Folds thinking-only assistant messages sandwiched between two read groups
 * into the surrounding group, so the collapsed view renders the thought as a
 * single row ("thinking ...") instead of a separate block. Group identity is
 * preserved (first group's id) so expanded state survives the merge.
 */
function absorbThinkingIntoReadGroups(items: RenderItem[]): RenderItem[] {
  const result: RenderItem[] = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const previous = result[result.length - 1];
    const next = items[index + 1];
    if (
      item.type === 'node' &&
      isThinkingOnlyNode(item.node) &&
      previous?.type === 'readGroup' &&
      next?.type === 'readGroup'
    ) {
      previous.entries.push({ kind: 'thinking', node: item.node }, ...next.entries);
      index++; // skip the merged-away group
      continue;
    }
    result.push(item);
  }
  return result;
}

/**
 * Groups consecutive read-only tool nodes into collapsed groups.
 * Non-read-only nodes break the consecutive sequence. Thinking-only
 * assistant messages between two groups are absorbed into the group.
 */
export function buildRenderItems(nodes: TranscriptNode[], compact: boolean): RenderItem[] {
  if (!compact) {
    return nodes.map((node) => ({ type: 'node', node, id: node.id }));
  }

  const items: RenderItem[] = [];
  let currentGroup: ToolNode[] = [];

  function flushGroup(): void {
    if (currentGroup.length > 0) {
      items.push({
        type: 'readGroup',
        entries: currentGroup.map((node) => ({ kind: 'tool', node })),
        id: `group-${currentGroup[0].id}`,
      });
      currentGroup = [];
    }
  }

  for (const node of nodes) {
    if (node.role === 'tool' && isReadToolNode(node)) {
      currentGroup.push(node);
    } else {
      flushGroup();
      items.push({ type: 'node', node, id: node.id });
    }
  }
  flushGroup();

  return absorbThinkingIntoReadGroups(items);
}
```

注意：`absorbThinkingIntoReadGroups` 里 `previous.entries.push(...)` 的"突变"是安全的——`items` 是 `buildRenderItems` 每次调用新建的局部数组，不和外部共享。

### 5. 修改 `src/renderer/src/components/ToolBlock.tsx`

- 删除本地常量 `TOOL_BLOCK_MAX_HEIGHT`，改用 `BLOCK_CONTENT_MAX_HEIGHT`（从 layoutConstants import）。
- 删除 `expanded` / `isOverflowing` / `contentRef` state 和相关 effect 分支（这些内容 clamp 逻辑移交给 OverflowClamp）。保留 `commandExpanded` / `isCommandTruncated` / `commandRef`；其测量 effect 的依赖从 `[node, expanded]` 改为 `[node, commandExpanded]`。
- 卡片根 div：`overflow-hidden` 改成 `overflow-clip`（sticky 需要，视觉完全等价：底部状态条自带 `rounded-b-md`，卡片背景自己绘制，唯一的裁切需求就是圆角）。
- 原来的内容 div（`ref={contentRef}` + maxHeight + 底部淡出 mask）+ `<div className="mb-2">` 里的 Show more 按钮，整体替换为：

```tsx
<OverflowClamp
  maxHeight={BLOCK_CONTENT_MAX_HEIGHT}
  contentStyle={{ minHeight: node.name === 'edit' ? '1px' : undefined }}
  buttonClassName="mb-2"
>
  {/* 原有三个内容块原样移入：editDiffFromDetails 的 DiffView、
      writeEntries 的 WritePreview、以及输出 pre（含 SyntaxHighlightedCode） */}
</OverflowClamp>
```

- 原 mask 是底部淡出，现在由 OverflowClamp 统一做顶部淡出，本地 mask 相关代码全部删除。

### 6. 修改 `src/renderer/src/components/MessageList.tsx`

改动点：

**a. 删除本地分组逻辑**：`RenderItem` 类型、`isReadToolNode`、`buildRenderItems` 移到 `lib/readGrouping.ts`，改为 `import { buildRenderItems, type RenderItem } from '../lib/readGrouping';`。`isReadOnlyBashCommand`、`getToolArgs` 如不再直接使用则清理 import（`getToolArgs` 还被 `estimateToolCommandLineCount` / `getToolSearchMeta` 使用，保留）。

**b. 所有 `item.nodes` 改 `item.entries`**：

- `buildSearchTargets` 的 readGroup 分支：遍历 entries。`kind === 'tool'` 走原有逻辑；`kind === 'thinking'` 生成 assistant 型 target：
  ```ts
  targets.push({
    renderIndex,
    itemId: item.id,
    groupId: item.id,
    toolNodeId: entry.node.id,
    role: 'assistant',
    text: entry.node.thinking,
    meta: '',
    preview: entry.node.thinking,
  });
  ```
  （`toolNodeId` 用于组内定位，展开态里 thinking entry 的包裹 div 也带 `data-tool-node-id`，见 CollapsedReadGroup 改动。）
- `estimateRenderItemHeight`：`item.nodes.length` → `item.entries.length`。
- `RenderItemRenderer`：`<CollapsedReadGroup nodes={item.nodes} ...>` → `entries={item.entries}`。

**c. ThinkingBlock 替换**：删除本地 `ThinkingBlock` 函数，改为 `import ThinkingBlock from './thinkingBlock';`（`AssistantBubble` 里调用方式不变）。

**d. UserBubble 换用 OverflowClamp**：

- 气泡 div：`rounded-2xl bg-muted overflow-hidden` → `rounded-2xl bg-muted overflow-clip`。
- 原 `max-h-[40vh]`（实际是 inline `maxHeight: '40vh'`）改为数值 px。OverflowClamp 需要 number，在 UserBubble 内把 40vh 换算成 px 并监听 resize：

  ```tsx
  const USER_MESSAGE_MAX_HEIGHT_VH = 0.4;

  const [maxHeight, setMaxHeight] = useState(() =>
    Math.round(window.innerHeight * USER_MESSAGE_MAX_HEIGHT_VH),
  );
  useEffect(() => {
    const handleResize = (): void =>
      setMaxHeight(Math.round(window.innerHeight * USER_MESSAGE_MAX_HEIGHT_VH));
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  ```

- 删除 `expanded` / `isOverflowing` / `contentRef` 及测量 effect、本地 mask。内容 div + 按钮替换为：

  ```tsx
  <OverflowClamp
    maxHeight={maxHeight}
    className="px-3.5 py-1.5 text-[15px] leading-6 text-foreground whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
    buttonClassName="ml-3.5 mb-1.5"
  >
    {highlightMatches(text, searchQuery, activeOccurrenceIndex)}
  </OverflowClamp>
  ```

- 删除不再使用的 `USER_MESSAGE_MAX_HEIGHT` 常量（`USER_MESSAGE_MAX_ESTIMATE_HEIGHT = 400` 保留给估算用）。

**e. 搜索自动展开适配尾部锚定**（重要，容易漏）：`handleSearchJump` 里 `expandIfHidden` 的可见性判断原来是 `if (matchRect.bottom <= overflowRect.bottom) return;`——只检查了内容从底部被裁的情况。现在裁切发生在**顶部**，要改成"完全可见才跳过"：

```ts
const firstSegment = segments[0];
const lastSegment = segments[segments.length - 1];
const firstRect = firstSegment.getBoundingClientRect();
const lastRect = lastSegment.getBoundingClientRect();
const overflowRect = overflowEl.getBoundingClientRect();
if (firstRect.top >= overflowRect.top && lastRect.bottom <= overflowRect.bottom) return;
```

**f. 估算微调**：`estimateAssistantHeight` 里 thinking 行数按 clamp 封顶，避免超长 thinking 的估算虚高（虚拟列表会二次测量修正，这只是让首估更准）：

```ts
function estimateAssistantHeight(node: AssistantNode): number {
  const thinkingLineCap = Math.ceil(BLOCK_CONTENT_MAX_HEIGHT / 20) + 4; // lines + header slack
  const thinkingLineCount = Math.min(countLines(node.thinking), thinkingLineCap);
  const textLength = node.text.length + Math.min(node.thinking.length, thinkingLineCap * 84);
  const lineCount = countLines(node.text) + thinkingLineCount;
  return Math.max(80, Math.max(Math.ceil(textLength / 84), lineCount) * 24 + 56);
}
```

**g. 删除本地 `TOOL_BLOCK_CONTENT_MAX_HEIGHT`**，`estimateToolHeight` 改用 `BLOCK_CONTENT_MAX_HEIGHT`。

**h. （可选但推荐）SystemBubble 的 shimmer span 换成共享组件**（见第 8 节）。

### 7. 重写 `src/renderer/src/components/CollapsedReadGroup.tsx`

整体重写，要点：

- props：`nodes: ToolNode[]` 改为 `entries: ReadGroupEntry[]`（`import type { ReadGroupEntry } from '../lib/readGrouping';`）。
- 标题计数只算工具条目：`const toolCount = entries.reduce((count, entry) => (entry.kind === 'tool' ? count + 1 : count), 0);`，label 逻辑不变（`Looking into N file(s)` / `Looked into N file(s)`）。
- **删除** `latestNodeId` 和命令行上的 shimmer 覆盖层。
- 折叠列表每行渲染：
  - 工具条目：状态图标 + 命令 label。

    ```tsx
    const ENTRY_STATUS_ICON = {
      success: { Icon: IconCheck, className: 'text-[#166534]' },
      error: { Icon: IconX, className: 'text-[#991b1b]' },
      cancelled: { Icon: IconMinus, className: 'text-[#3f3f46]' },
    } as const;
    ```

    行结构（truncate 在 span 上，图标 `shrink-0`）：

    ```tsx
    <div
      className={cn(
        'flex items-center gap-1.5',
        isRunning ? 'text-foreground' : 'text-foreground/70',
      )}
    >
      {node.status === 'running' ? (
        <IconLoader2 className="size-3.5 shrink-0 animate-[spin_1.8s_linear_infinite] text-muted-foreground" />
      ) : (
        <Icon className={cn('size-3.5 shrink-0', iconClassName)} />
      )}
      <span className="truncate font-mono text-[14px]">{getCommandLabel(node)}</span>
    </div>
    ```

    （running 行保持原来的高亮语义：running 的行 `text-foreground`，其余 `text-foreground/70`。颜色 hex 与 ToolBlock STATUS_CONFIG 一致，这是需求明确要求。）

  - thinking 条目：一行斜体 muted 文本，CSS `truncate` 自动出省略号：

    ```tsx
    const snippet = entry.node.thinking.trim().split('\n', 1)[0];
    <div className="flex items-center text-muted-foreground">
      <span className="truncate text-[13px] italic">thinking {snippet}</span>
    </div>;
    ```

- **`Working...` 行**：`isActive` 时显示，放在头部容器内、折叠列表 div **之后**（不放在 `group-data-[state=open]/collapsible:hidden` 里面，这样展开态也能看到）。shimmer 动画做在这行文字上：

  ```tsx
  {
    isActive && (
      <div className="mt-0.5 flex items-center" data-search-ignore>
        <span className="relative overflow-hidden text-[13px] text-muted-foreground">
          Working...
          <ShimmerOverlay />
        </span>
      </div>
    );
  }
  ```

- 展开态（`CollapsibleContent`）：遍历 entries，工具条目照旧渲染 `ToolBlock`；thinking 条目渲染共享的 `ThinkingBlock`。把现有 `HighlightedToolNode` 泛化成 `HighlightedEntry`（包 children + `data-tool-node-id`），两种条目都用它包，保证搜索 occurrence 定位一致：

  ```tsx
  function HighlightedEntry({
    nodeId,
    searchQuery,
    activeOccurrenceIndex,
    children,
  }: {
    nodeId: string;
    searchQuery: string;
    activeOccurrenceIndex: number | null;
    children: React.ReactNode;
  }): React.JSX.Element {
    const containerRef = useRef<HTMLDivElement>(null);
    useHighlightTextNodes(containerRef, searchQuery, activeOccurrenceIndex);
    return (
      <div ref={containerRef} data-tool-node-id={nodeId} className="group">
        {children}
      </div>
    );
  }
  ```

  展开态 map：

  ```tsx
  {
    entries.map((entry) => (
      <HighlightedEntry
        key={entry.node.id}
        nodeId={entry.node.id}
        searchQuery={searchQuery}
        activeOccurrenceIndex={entry.node.id === activeToolNodeId ? activeOccurrenceIndex : null}
      >
        {entry.kind === 'tool' ? (
          <ToolBlock node={entry.node} />
        ) : (
          <ThinkingBlock text={entry.node.thinking} />
        )}
      </HighlightedEntry>
    ));
  }
  ```

- 外层结构（Collapsible、卡片 div、trigger）保持不变。卡片没有 overflow，内部 ToolBlock 的 sticky 按钮不受影响。

### 8. 新建 `src/renderer/src/components/shimmerOverlay.tsx`（小共享组件）

`Working...` 行和 `SystemBubble` 用的是同一段 shimmer 覆盖层代码，抽出来：

```tsx
/** Absolute overlay that sweeps a highlight across its (relative) parent, used for shimmer text effects */
export default function ShimmerOverlay(): React.JSX.Element {
  return (
    <span
      className="absolute inset-0 animate-[shimmer_2.5s_linear_infinite]"
      style={{
        background:
          'linear-gradient(90deg, transparent 0%, transparent 30%, rgba(255,255,255,0.95) 50%, transparent 70%, transparent 100%)',
        backgroundSize: '200% 100%',
      }}
    />
  );
}
```

`shimmer` keyframes 已在 `src/renderer/src/assets/main.css` 定义，直接用。`MessageList.tsx` 的 `SystemBubble` 里那段相同的 span 顺手替换掉。

### 9. 修改 `src/renderer/src/components/sidebar/sessionList.tsx`

把 "Show less" 从折叠动画容器里挪出来做成 sticky（"Show more" 不动——折叠时它本来就紧贴可见区域，无需 sticky）。

- 现在的结构是：动画 grid wrapper > `div.min-h-0.overflow-hidden` > `SidebarMenuSub` > (sessions + Show more + Show less)。那个 `overflow-hidden` 会截获 sticky，所以 Show less 必须移到 wrapper **外面**（作为 SessionList 返回值的第二个根节点，包一层 fragment `<>...</>`）。
- 渲染条件：`showList && showAll && sessionsToRender.length > visibleSessionCount && !isCollapsedWithPinned`（`showList` 条件必须加——自动展开 effect 可能在分组折叠时把 `showAll` 置 true，不能让按钮孤悬在折叠的分组外面）。
- sticky 相对于 `SidebarGroupContent`（`overflow-auto`，在 `sidebar/index.tsx`）生效；中间祖先 `SidebarMenu`/`SidebarMenuItem` 均无 overflow，通路是干净的。

```tsx
{
  showList &&
    showAll &&
    sessionsToRender.length > visibleSessionCount &&
    !isCollapsedWithPinned && (
      <div className="sticky bottom-0 z-10 bg-sidebar">
        <SidebarMenuSub className="mx-0 border-l-0 px-0">
          <SidebarMenuSubItem>
            <SidebarMenuSubButton
              asChild
              className="w-full justify-start pl-6 text-left text-muted-foreground"
            >
              <button type="button" onClick={() => setShowAll(false)}>
                <span>Show less</span>
              </button>
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
        </SidebarMenuSub>
      </div>
    );
}
```

- `bg-sidebar` 必须有：sticky 悬浮时下方滚动经过的 session 行不能透出来。
- 原来 wrapper 内 Show less 的那个 `SidebarMenuSubItem` 分支删除。
- 小注意：滚动容器上有 `content-fade-bottom`（底部 16px mask 淡出），sticky 按钮贴 bottom-0 时会被轻微淡出，可接受；如在意可用 `bottom-1`。

---

## 不要踩的坑（检查清单）

1. **`[style*="max-height"]` 选择器**：`MessageList.tsx` 的 `expandIfHidden` 靠它找 clamp 容器。OverflowClamp 的外层 div 必须保持 inline `maxHeight`（展开时 React 会移除该属性，正好让选择器失效，行为正确）。
2. **`data-action="expand-overflow"`**：搜索自动展开靠它找按钮并 `.click()`，OverflowClamp 按钮上必须保留。
3. **不要给 OverflowClamp 加根 wrapper**：按钮必须是内容 div 的兄弟、卡片 div 的直接子孙，否则 sticky 活动范围被限制在组件内部，失效。
4. **`overflow-hidden` → `overflow-clip` 只改卡片根**（ToolBlock 卡片、UserBubble 气泡）；OverflowClamp 自己的内容容器保留 `overflow-hidden` 没问题——sticky 元素（按钮）不在它里面。
5. **组 id 稳定性**：合并后组 id 取第一个工具节点 id，不要改成合并后重新生成，否则 `expandedGroupIds` 和搜索定位会丢状态。
6. **虚拟列表估算**：`estimateRenderItemHeight` 的 readGroup 分支记得改用 `entries.length`。
7. **`getToolSearchMeta` 只适用于工具节点**，thinking entry 的 search target 不要调它。
8. **eslint**：本项目禁止 `eslint-disable` 注释、禁止 `as` 断言（除非不可避免并加注释）、禁止 inline import。按上面给的实现写不会触发这些。
9. `OverflowClamp` 的测量依赖 `inner.offsetHeight`，不要用外层（外层被 clamp 后高度恒定，永远测不出增长）。

## 验证步骤

1. `npm run check`（type + lint + format），完整读输出，不要用 grep 截断。
2. 用 `pigi-debug` skill 启动 dev 实例，构造/找一个长 session 验证：
   - 超长 thinking：折叠时显示**最后**几行、顶部淡出、Show more 可展开；展开后向下滚动，Show less 悬浮在视口底部，滚到块尾落位。
   - 超长 tool 输出（如 `cat` 大文件）：同上，且折叠显示尾部。
   - 超长用户消息（粘贴长文本）：同上。
   - Read 聚合：两个 read 组之间有 thinking 时折叠成 `thinking ...` 行；组活跃时下方有 `Working...` shimmer；完成行绿色勾、失败行红色 x；展开后 thinking 完整显示为 ThinkingBlock。
   - `Cmd+F` 搜索一个在被 clamp 隐藏区域（现在隐藏在**顶部**）的词，确认会自动展开并滚到匹配处。
   - Sidebar 展开超过 5 个 session 的项目 → Show more → 滚动列表，Show less 悬浮底部；点 Show less 收回。
3. 深色/浅色主题各过一遍（状态图标 hex 颜色与 ToolBlock 一致是需求指定，两种主题下保持相同即可）。

## 影响面与回归风险

- 低风险：OverflowClamp 是纯 CSS 方案，不改变数据流；`overflow-clip` 与 `overflow-hidden` 视觉等价。
- 中风险：搜索自动展开的可见性判断逻辑改动（e 条）——按验证步骤第 6 条覆盖。
- 中风险：readGroup 数据结构从 `nodes` 变 `entries`，所有引用点已在上文列全（`buildSearchTargets`、`estimateRenderItemHeight`、`RenderItemRenderer`、`CollapsedReadGroup`），TypeScript 编译会兜底遗漏点。
