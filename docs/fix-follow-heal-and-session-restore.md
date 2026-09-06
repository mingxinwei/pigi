# 消息列表跟随修复：会话切换错位与流式抖动/卡死

> 分支：`fix/follow-heal-and-session-restore` · 日期：2026-09-07 · 前置：v0.4.7（`3bb4b38` 系列滚动重构）

## 背景

v0.4.7 发布后，实际使用中暴露出四类症状：

1. **流式抖动**：自动跟随新输出向上滚动时，列表周期性上下振动。
2. **跟随卡死**：消息向下出现时，自动滚动随机停住，不再更新，需要手动滚回底部才恢复。
3. **卡片越过底部空白**：输出时经常看到最后一张卡片跨过底部 72px 的呼吸留白。
4. **会话切换恢复错乱**：切回会话经常恢复不到记忆位置——落在开头，或落在从没看过的中间位置。

## 排查过程

### 复现环境

- 新开 session、DeepSeek V4 Flash（快模型、持续流式输出、大量工具卡）
- 技巧：隐藏窗口（`visibilityState: hidden`）会冻结 rAF/RO/timer，用 `node scripts/cdp.mjs capture` 逐帧冲刷渲染管线，配合 painted-state 探针（在 rows wrapper 的 ResizeObserver 里记录 `d = scrollHeight − scrollTop − clientHeight` 和 `gap = wrapper底 − spacer底`）采样"被画出来的真实状态"
- 对照基线：v0.4.7 代码，长诗回合 33/149 帧贴底失败（最大落后 537px）、工具卡回合出现 `d=73.5` 冻结 3.5 秒、`gap` 峰值 856px

### 根因一：会话切换泄漏（症状 4）

`3bb4b38` 的原生恢复方案（`initialOffset` 种子 + 行高缓存）建立在一个前提上：**切换会话会通过 `key={activeSessionPath}` 重挂载 MessageList**。但检查 App.tsx 发现这个 key **从未存在过**——提交信息里的假设是错的。

没有重挂载意味着：

- virtualizer 实例跨会话存活，`initialOffset` 只在应用首次挂载时读一次，之后永不生效
- 切换会话时 virtualizer 的 tracked offset 仍带着**上一个会话**的滚动位置；transcript 加载（count 0→N）触发的 anchor pass 把这个遗留值写进新会话的元素

实测抓到直接证据：把 pi-mono 会话滚到 9000 并保存，切到"星际"会话（自己的存值是 5000），星际恢复到了 **9000**——完整复现了"恢复到没见过的中间位置"。此前偶尔"恢复成功"的测试，其实是两个会话位置恰好接近造成的巧合。

### 根因二：估算滞后 + 阈值死区（症状 1/2/3 同源）

机制链条（每一步都有探针数据支撑）：

1. **估算远低于实测**：新出现的工具卡估算高度 ~150px，真实渲染 300-500px（流式期间持续增长）。在 RO 测量回流前，模型 totalSize 落后于真实内容（`gap` 最高观测 856px）。
2. **锚定修正落点短缺**：行增长的端锚定修正写 `scrollTop += 模型增量`。写入瞬间真实增量 > 模型增量，落点离真实底部差 `gap`。
3. **恰好越过 72px 阈值**：RO 随后让模型追平，但视口不动 → `d` 冻结在 72+ε（实测 **73.5，冻结 3.5 秒**）。而 72px 正是 `scrollEndThreshold`——`followOnAppend` 的 isAtEnd、锚定修正的 wasAtEnd 全部判"不在底部"。
4. **三症状各自显形**：
   - 卡死：没有新的 append 就没有任何东西把视口拉回（followOnAppend 也被同一个阈值拦住）→ 跟随死亡
   - 越界：冻结期间新内容继续在视口下方生长，最后一张卡的底缘越过 72px 留白
   - 抖动：修正迟到/短缺的帧被真实画出来，随后 re-glue，形成可见的上下振荡

### 上游佐证（TanStack Virtual GitHub）

- **#1252（open）**："Scroll correction sometimes gets stuck on estimating row sizes"——估算↔实测不匹配时修正卡死，影响 3.13.9–3.14.9+，未修复
- **#1221（open）**：scrollTo* 系列武装的 reconcile 循环无 API 可取消（注：实测 3.17.8 带 index 的循环每帧重算目标、跟踪真实端，并非 stale 重申——#1221 描述的是 offset 目标场景）
- **#1227 / #1218 / #1233**：动态尺寸 jank / 流式修正拖拽 / iOS stale delta，已分别在 3.17.6/3.17.7 修复——我们已在 3.17.8，不受影响

结论：库在"估算与实测一致"时表现正确，但**无法处理新行实测远超估算的流式场景**（#1252 仍 open）。需要在应用层补一个同帧的"落点补齐"。

## 修复

### 1. 会话切换：补上缺失的重挂载 key

```tsx
// App.tsx
<MessageList
  key={activeSessionPath ?? 'draft'}
  nodes={transcript.nodes}
  sessionPath={activeSessionPath ?? ''}
/>
```

这让 `3bb4b38` 的设计真正成立：切会话 → MessageList 重挂载 → `initialOffset()` 懒函数读**新会话**的存值（像素位置原样恢复；-1/无存值 clamp 落底）→ attach 写入 + anchor pass 落位，全程无渲染后像素写入。行高缓存（`measuredRowHeights.ts`，模块级、按 item id）让重挂载后的首次布局就用实测高度，像素位置即挂即准。

### 2. 流式：wrapper RO 同帧补齐（follow heal）

`useMessageListScrollController.ts` 的 `handleResize`（挂在 rows wrapper 上）新增正常模式分支：

```ts
if (!isMinimal) {
  const container = containerRef.current;
  if (!container || !autoScrollRef.current) return;
  const shortfall = container.scrollHeight - container.scrollTop - container.clientHeight;
  if (shortfall > 0.5 && shortfall <= FOLLOW_HEAL_BAND_PX) {  // 160px
    container.scrollTop = container.scrollHeight - container.clientHeight;
  }
  return;
}
```

为什么这样是安全的：

- **同帧且最后一笔**：RO 回调按注册顺序执行，controller 的 observer 晚于 virtualizer 的行 observer（挂载更晚）注册，所以这次写入是 paint 前对 scrollTop 的最后操作——画出来的就是贴底状态。这是 pigi-jitter-debug 技能验证过的 painted-state 方法论（v0.4.0 的最小模式 pin 同理）。
- **只医落点短缺，不碰读历史**：160px 带宽只覆盖"估算滞后导致的短缺落地"（实测短缺 17-136px）；用户上滚阅读时 `autoScrollRef` 已被 wheel 处理置 false，heal 完全不介入。
- **目标永远是真实端**：写 `scrollHeight − clientHeight`（真实 DOM），不经过估算模型，所以 72px 底留白永远完整呈现（wrapper 底缘 = 末行底 + 72 margin）。
- **不与 virtualizer 打架**：双方写同一个目标（真实端），收敛一致；估算追平后 virtualizer 的修正变为 no-op。

## 验证

隐藏窗口 + capture 冲刷（最严苛：渲染帧被切片，估算滞后被放大）：

| 指标 | 修复前 | 修复后 |
|---|---|---|
| 长诗回合贴底失败帧 | 33/149 | 7/214（4 帧为发消息正常跳底）|
| 流式最大落后 | 537px | ≤17px 瞬态 |
| 卡死帧（d>72 冻结）| 73.5 冻结 3.5s | 0（307 样本）|
| 工具卡回合 maxD | 5621px | 37px |
| 模型缺口 gap 峰值 | 856px | 54px 瞬态 |
| 会话恢复（in-app 往返）| 泄漏上一会话位置（+4825px）| 精确（6000→6000；12000→11838 首访，二轮收敛）|

`npm run check` 零 error/warning。

## 已知残差

- **reload 后首开中间位置**：页面重载清空模块级行高缓存，从未测量过的行只能靠估算，恢复落点会有小漂移（观测 ~160px/26k 列表）；in-app 切换不受影响（缓存存活）。二轮往返即收敛。
- **#1252（上游 open）**：若未来库修复估算卡死问题，follow heal 可考虑退役，但当前它是必要的。
