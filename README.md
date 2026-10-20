# 纸间 · Wordgard Markdown 就地编辑器

工作台使用 **React + TypeScript + Vite**。React 管理文档库、工具栏、模式、对话框、通知与统计；Wordgard / CodeMirror 通过 ref 和布局 effect 接入，各自维护编辑 DOM、选区与撤销历史。现有 `zhijian-wordgard-v1` 本地草稿继续可读。

默认正文现在采用 **所见即所得 + 聚焦展开 Markdown 标记** 的编辑方式：点击粗体显示可编辑的 `**` 或 `__`，点击链接显示原始地址/引用语法，离开后恢复排版。标题、行内代码、删除线、高亮、上下标、公式、图片及表格单元格使用相同的源文本/显示态分离原则。独立源码视图仍可使用，但普通语法编辑不需要切换视图。

正文以原始 Markdown 为权威，Wordgard 文本节点保留真实符号；格式 marks 是从源文本计算的显示投影。焦点变化只改变显示形状，不插入临时字符、不改写文档、不新增撤销项。依据的原程序模块、受控重放证据与实现细节见 [IMPLEMENTATION.md](IMPLEMENTATION.md)。

## 运行

```powershell
cd D:\workspace\typora\wordgard-demo
npm ci
npm run dev
# http://127.0.0.1:5173/
npm test
npm run typecheck
npm run test:focus
npm run build
```

根目录也提供 `npm run editor:dev`、`editor:test`、`editor:build`。`npm run editor:reference` 隔离重放原程序 30 模块的 11 个装饰分支并更新证据与测试参考。浏览器测试默认使用已安装的 Chrome，可通过 `CHROME_PATH` 指定 Chromium。

## 正文编辑

| 功能 | 当前行为 |
| --- | --- |
| 焦点展开 | 光标/选区端点所在格式展开真实语法；其他格式保持排版；嵌套格式保留原始分隔符 |
| 原文保留 | 正文保存直接读取原始 Markdown；聚焦、折叠、可视/源码无修改切换不经过 HTML→Markdown 规范化 |
| 行内格式 | 加粗、斜体、删除线、高亮、代码、下划线、上下标；支持 `__` / `**`、`_` / `*`、`~sub~`、`^sup^` |
| 链接/图片 | 就地编辑链接文字、地址、标题和引用形式；图片聚焦后编辑原始语法，另提供 URL/替代文字/本地上传入口 |
| 标题/引用/列表 | 标题标记、Setext 下划线、引用和列表前缀在焦点处展开；Enter 延续列表、编号和任务，空项 Enter 退出 |
| 表格 | 真实 Wordgard 行、列、单元格；在单元格内就地编辑 Markdown，保留表格排版；原生工具支持行列操作 |
| 任务 | checkbox 由源文本生成；勾选修改原始 `[ ]` / `[x]`，可撤销；原始任务符号仍可编辑 |
| 代码 | 保留围栏、语言和代码空白；聚焦显示围栏；JavaScript、TypeScript、Python、JSON、CSS、HTML、Shell、YAML、LaTeX 词法高亮 |
| 公式/图表/HTML | 非焦点状态渲染 KaTeX、Mermaid 或消毒 HTML；点击结果，在同一正文块中编辑原始内容 |
| 其他语法 | 脚注、多段定义、YAML/TOML Front Matter、动态 TOC、HTML 实体、转义、引用式链接 |
| 选区 | Markdown UTF-16 偏移与 Wordgard 块/单元格坐标双向映射，支持跨块、跨格式替换与源码视图映射 |
| 历史 | Wordgard 事务；文字输入合并，结构/工具操作隔离；切换文档保留各自会话历史 |
| IME/拖选 | 组合输入和鼠标拖选期间冻结装饰替换，结束后协调模型与显示 |
| 剪贴板 | 同应用复制保留原始 Markdown，另提供语义 HTML；粘贴、剪切、图片粘贴和拖入进入源文本事务 |
| 查找替换 | 对可见文字检索，可跨行内格式；完整匹配覆盖语法对时一并替换对应标记，避免遗留孤立分隔符 |

## 工作台

CodeMirror 源码视图提供行号、语法高亮、括号匹配、缩进及独立撤销。源码提交进入正文历史，两种视图之间映射选区。

文档库、标题、大纲、搜索、版本快照、明暗主题、字号、阅读、专注、打字机模式和统计继续可用。支持 Markdown/HTML/JSON 导入导出和打印/PDF；本机 Markdown 打开、保存和另存为通过 File System Access API，保存前检查磁盘基线。

快捷键：Ctrl/⌘ B、I、K、Z、F；Ctrl/⌘ Shift M 切换源码。Ctrl/⌘ S 保存草稿，已关联本机文件时写入文件；Ctrl/⌘ Shift S 另存为。

## 验证与边界

- `test/browser/live.spec.js` 验证焦点、标记编辑、选区、历史、表格、列表、剪贴板、实体、语法高亮和组合输入状态；31 组源文本样本在聚焦/显示切换后保持原样，包含 CRLF。
- 原程序装饰器的 11 个选定分支在无宿主/网络/文件 API 的 VM 中重放；保存来源哈希及依赖桩限制。测试参考不等于运行了完整原程序。
- 旧 `engine.ts` 保留为富文本桥接回归适配器，**工作台实际入口使用 `live-engine.ts`**。旧桥接的幂等语料不是正文原文保留的替代测试。
- 本轮对齐的是公开发布 JS 可证实的焦点式 Markdown 编辑机制。仍未逐分支证明全部 Typora 私有语法、平台兼容代码、真实 IME、超大文档性能及像素级行为等价；没有替换原 Electron 宿主或恢复主进程字节码。
- 浏览器草稿只保存在当前来源 localStorage，清理网站数据会删除它们。撤销历史属于当前会话；本机文件句柄关闭页面后需重新选择。文件保存的基线检查不等于文件锁或文件夹监视。
- HTML 导入会转换格式，任意 HTML/私有扩展并不保证完整语义往返；普通 GFM 无法表示全部富文本合并表格。独立源码编辑可以保留不认识的语法，但不意味着该语法已有渲染支持。

详细验证范围见 [QA.md](QA.md)。Wordgard 及其他依赖的许可证归各作者。

## 实现文件

- `src/App.tsx`：工作台状态、编辑器生命周期、模式切换及事件。
- `src/components.tsx`：React 侧栏、工具栏、图标、弹窗与通知。
- `src/library.ts`、`src/types.ts`：文档加载、版本快照与共享数据类型。

- `src/live-engine.ts`：正文 Wordgard 模型、源坐标、事务、焦点与输入状态、剪贴板、历史。
- `src/live-markdown.ts`：保留源码的词法装饰分析和代码高亮。
- `src/live-table.ts`：真实表格与原始表格文本、坐标的双向转换。
- `src/source-offsets.ts`：换行规范化时的原始偏移映射。
- `src/markdown.ts`：解析/导出桥接、预览增强、引用定义解析。
- `src/source.ts`、`src/files.ts`、`src/main.tsx`：源码视图、本机文件和 React 启动入口。
- `patches/wordgard+0.6.0.patch`：隐藏语法/失焦/脱离 DOM 时的光标测量保护；`npm ci` 的 postinstall 自动应用，不能省略安装脚本。

`npm run build` 先执行 TypeScript 检查再打包。`test/browser/react.spec.js` 覆盖 React 文档切换、标题/搜索/删除撤销、旧草稿/主题/CRLF 往返、弹窗与版本恢复；`caret.spec.js` 比较实际光标与文字的屏幕坐标。
