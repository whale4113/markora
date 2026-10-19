# 纸间 · Wordgard Markdown Demo

在浏览器中重建 Typora 式写作流程。编辑核心使用真实 **Wordgard 0.6.0**，不复制 Typora 发布代码。文档状态、格式命令、表格、任务节点、选区、撤销都经过 Wordgard 的模型与 transaction。

```powershell
cd D:\workspace\typora\wordgard-demo
npm ci
npm run dev
```

打开 http://127.0.0.1:5173/ 。生产构建：`npm run build`，输出 `dist/`；`npm run preview` 可预览该构建。

## 已实现

| 功能 | 实现 |
| --- | --- |
| 可视化编辑 | 标题、加粗、斜体、删除线、行内代码、列表、引用、分隔线 |
| 历史 | Wordgard 原生 undo/redo；格式化不重置历史 |
| 源码 | Markdown 双向切换，源码输入使用 textarea；提交时重建编辑状态 |
| 表格 | 插入、编辑、单元格选择；更多插入→完整格式工具，访问原生行列/合并菜单 |
| 任务 | 自定义 Wordgard checkbox 节点，点击勾选可撤销，支持 GFM 导出 |
| 图片与链接 | URL 插入，图片也可由原生菜单/粘贴/拖放上传至浏览器 data URL |
| 代码 | 代码块与语言标签 |
| 数学与流程图 | 保留 LaTeX/Mermaid 源码，阅读模式使用 KaTeX/Mermaid 渲染 |
| 脚注 | Markdown 标记与定义文本保留，阅读模式锚点跳转 |
| 文件工作流 | 多文档库、搜索、标题、目录导航、导入 Markdown/HTML/JSON |
| 本地优先 | localStorage 自动保存、最近20个文档快照、删除即时撤销 |
| 查找替换 | 按 textblock 搜索，可跨行内格式；单次及全部替换，参与历史 |
| 导出 | Markdown、HTML、JSON；PDF 使用浏览器打印 |
| 写作模式 | 明暗主题、字号、阅读、专注、打字机光标居中与底部留白 |
| 状态 | 汉字+词统计、字符数、估算阅读时间、选区位置 |

快捷键：Ctrl/⌘ B、I、K、Z、F、S；Ctrl/⌘ Shift M 切换源码；Esc 退出专注模式。Wordgard 自带 Markdown 输入规则和格式快捷键。

## 与完整 Typora 的区别

这是浏览器 demo，不是官方完整工程，也没有宣称全部功能或文件格式逐字节兼容。未实现系统文件夹监视、桌面多窗口同步、系统词典/原生拼写检查、Pandoc、任意本机 shell 命令、图床服务、Typora 私有元数据与原生导出后端。

- 可视/源码切换会规范化空行、列表缩进等 Markdown 排版，不能保证原文逐字节不变；切换文档/提交源码会新建可视编辑器历史。
- 脚注是语义文本适配，不是 Wordgard 原生脚注节点；多行定义可能折成单段。行内公式采用保守美元符号规则，复杂金额、转义和公式混写需检查源码。
- 公式和流程图在阅读模式渲染，在编辑模式保留可编辑源码块。
- 本地保存仅限同一个浏览器及网站来源；清理网站数据会删除文档。图片 data URL 会占用浏览器存储，保存失败有明确提示，应及时导出备份。
- HTML 导出包含渲染结果，公式样式通过外部 KaTeX CSS 引用；本地页面构建内的 KaTeX 样式和字体已打包。
- 没有云端文档同步、协作或服务器账号系统。站点私有发布访问控制不等于云文档存储。

## 结构

- `src/engine.js`：Wordgard schema/transactions、真实任务节点、命令、搜索及编辑器生命周期。
- `src/markdown.js`：Marked + DOMPurify + Turndown/GFM；预览公式/图表增强。
- `src/main.js`：文档工作流、保存、历史、源码模式、UI 和导入导出。
- `src/style.css`、`index.html`：中文写作工作台与响应式布局。
- `.openai/hosting.json`：静态站点部署配置。

## 验证

已实际在浏览器验证：新建/标题编辑、源码提交、真实文本键入、选中文字加粗、任务初始勾选/切换/撤销、3×2 表格插入与撤销、查找/单次替换、KaTeX 公式与 Mermaid SVG 渲染、Markdown 文件下载、主题切换。生产构建通过；验收时发现并修复了隐藏编辑器布局读取、任务解析默认值、代码语言保留及脚注分隔线累积问题。

尚未穷尽验证：所有表格菜单分支、跨平台中文输入法、全部图片拖放场景、复杂 Markdown/HTML 往返、打印机或浏览器 PDF 输出。具体自动化未覆盖的部分不应视为已测试。

官方参考：https://wordgard.net/ ，包内 `node_modules/wordgard/dist/*.d.ts` 与 schema 源码。所有依赖许可证归原作者，Wordgard 使用 MIT 许可证。
