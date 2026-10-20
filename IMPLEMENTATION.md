# 焦点式 Markdown 编辑：逆向依据与重实现

## React / TypeScript 工作台

`main.tsx` 通过 React root 挂载 `App.tsx`，原 `main.js` 的 DOM 事件脚本已移除。`components.tsx` 声明侧栏、工具栏、通知和弹窗；文档、选中项、模式、主题、查找等由 React state 驱动。`library.ts` 和 `types.ts` 管理草稿加载、版本快照及共享结构，沿用原 localStorage key。

Wordgard 与 CodeMirror 是 React 的非受控编辑器边界：ref 容器中仅由引擎更新正文 DOM，React 不逐字符重建节点。布局 effect 在容器可见后挂载和测量，文档会话缓存保留选区/撤销；卸载时销毁实例和事件监听。源码偏移 API 在 CodeMirror 的 LF 内部坐标与原 Markdown 的 CRLF 坐标之间转换。

所有 `src` 业务脚本已迁移为 `.ts` / `.tsx`，Vite 启用 React 插件，生产构建先执行 TypeScript 检查。`patches/wordgard+0.6.0.patch` 修复引擎在失焦、脱离 DOM 和隐藏标记无有效矩形时的光标测量；它通过 postinstall 重复应用。

## 原程序的确证行为

原程序不是把 Markdown 永久转换成富文本后丢弃分隔符。已有恢复代码显示：

1. `11-document-model.js` / `13-html-renderer.js:15–20`：段落等叶块保留 Markdown 文本，聚焦时调用 brushContent 产生编辑 DOM。
2. `30-render-decoration.js:225` 起：粗体、斜体、代码、删除线、高亮等同时生成语义内容和真实语法文本。例如粗体包含 `.md-meta.md-before`、`<strong>`、`.md-meta.md-after`；分隔符取原 token.pattern，支持原始 `**` / `__`。
3. `2a-focus-navigation.js:100–221`：expandOnDelay / expand 受 IME、锁定保护，按选区两端查找可展开行内容器，管理 `.md-expand` / `.md-focus` 并修复 Range；不是把聚焦块替换成 textarea。
4. `31-cursor-selection.js:126–143`：选区使用块内 bookmark 保存/恢复，源文本和展示长度不同处配合 cursorDiff。
5. `49-editor-controller.js:180–210,443–613`：store/refocus 提交旧块、结束撤销快照；输入和 composition 通过 Brush 协调 DOM/模型，IME 期间抑制主动重建。

模块位置均相对于 `../reverse-engineered/editor/modules/`。详细静态说明见 `../reverse-engineered/editor/core/INPUT-SELECTION.zh-CN.md` 和 `MODEL-PARSER.zh-CN.md`。

本轮 REA 静态父证据：`ev_574ce1e4053de4f17e1814e78a429994013f2b98d33d591ef0cad824fa199dd7`。只选择 2a、30、31 三个文件，68 个库存文件未分析，语义关系为部分覆盖；不能把静态图当作运行时等价证明。

原装饰器另有 **11 个受控重放分支**，结果在 `../evidence/focus-decoration-probes.json`；可运行 `node ../tools/probe-focus-decoration.cjs` 重现。包含来源 SHA-256、实际输出和依赖桩限制。只执行模块 30 工厂及所选装饰函数，没有启动应用、执行原 expand/Range 操作或开放宿主 API。

## 当前正文实现

`main.tsx` 已切换到 `createLiveEngine`。源文本是权威，Wordgard 叶文本保留真实 Markdown 符号。`live-markdown.ts` 分析语法区间，生成可见样式和语法元信息；marks 表达可重建的显示投影，**不替代源文本**。

Syntax mark 记录语法所属区间；焦点、选区和只读状态通过 Wordgard 配置效果改变 mark 的显示形状。隐藏的标记仍是同一模型中的真实可编辑字符。光标进入格式后显示分隔符，离开后隐藏，嵌套内容保留原始标记；没有临时字符插入或聚焦历史项。

输入、删除、工具栏和粘贴修改源文本，再以差异事务协调 Wordgard 块结构。Enter 处理列表、编号、任务和引用续行；代码块不套用列表续行。字符输入合并历史，结构操作隔离；无修改视图切换不清空历史。

源坐标使用 UTF-16；普通块与表格单元格维护模型位置/源位置映射，换行归一分析另有原始偏移表，所以显示态不会把 CRLF 改写成 LF。源码视图切换传递真实源选区。

表格使用真实 Wordgard Table/Row/Cell，而不是聚焦时替换为整表源码。单元格保留自己的 Markdown；表格布局元数据保留管道、对齐行、空白与换行。单元格聚焦只展开所在格式，行列工具仍使用 Wordgard 表格事务。

公式、图表、图片、目录和 HTML 的渲染结果是派生 widget，不进入 Markdown 保存。点击渲染结果定位其原始源码；同应用剪贴板保留原始 Markdown，并额外提供不含编辑元信息的语义 HTML。

组合输入和鼠标拖选期间不替换语法形状及预览，结束后再协调显示。编辑器实例离开 DOM 后可能留有待刷写状态，恢复时显式同步，再恢复其模型选区和会话历史。

## 没有冒充原实现的部分

这是 Wordgard 上的独立重实现，不是复用原 NodeMap、Rangy 或字节码宿主。原程序的 DOM-first、200ms Brush 轮询在这里改为源事务与 Wordgard 的同步/刷新机制；原平台的所有特殊 inputType 与 IME 分支尚未逐一运行复现。

Markdown 词法使用 Marked 与明确扩展，不声称已覆盖原程序全部选项、私有语法、智能标点和 emoji 等行为。超大文档和全部跨平台输入法仍需专项验证；普通 GFM 对富文本合并表格也存在表达限制。

因此本轮可证明的是原文保留、就地语法编辑及测试覆盖的焦点/选区/历史等功能，不能以若干样例声称完整原程序逐分支或逐像素等价。
