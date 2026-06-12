# PST Import

> ✨ **中文**
>
> **📁 一次性归档：** 将 Outlook 的**历史 PST 文件**一次性导入 Obsidian，转为**可搜索、可链接**的 Markdown **知识库内容**。
>
> **🔄 持续同步：** 通过维护一个**轻量的 staging PST**，将新邮件持续同步到 Obsidian，接入 **AI 插件**（如 **Claudian** 等）进行处理——适用于**不使用 Microsoft Copilot** 的场景。

> 🚀 **English**
>
> **📁 One-time archive:** Import a **historical Outlook PST file** into Obsidian and convert it into **searchable, linkable** Markdown content in your **knowledge base**.
>
> **🔄 Ongoing sync:** Maintain a **lightweight staging PST** to continuously sync new email into Obsidian, then process it with **AI plugins** such as **Claudian** — an alternative for workflows where **Microsoft Copilot is not in use**.

## 🛠️ Installation / 安装

### 📦 From Obsidian Community Plugins / 从 Obsidian 社区插件安装

**中文：**

1. 打开 Obsidian → 设置 → 第三方插件 → 浏览
2. 搜索 **"PST Import"**
3. 点击安装，然后启用

**English:**

1. Open Obsidian → Settings → Community Plugins → Browse
2. Search for **"PST Import"**
3. Click Install → Enable

### ⚡ Install with BRAT / 通过 BRAT 安装

**中文：**

1. 安装 [BRAT](https://obsidian.md/plugins?id=obsidian42-brat)
2. 添加仓库：`wenciara/obsidian-pst-importer`
3. 启用 PST Import

**English:**

1. Install [BRAT](https://obsidian.md/plugins?id=obsidian42-brat)
2. Add repository: `wenciara/obsidian-pst-importer`
3. Enable PST Import

### 🧩 Manual Installation / 手动安装

**中文：**

1. 从 [Releases](https://github.com/wenciara/obsidian-pst-importer/releases) 下载 `main.js`、`manifest.json` 和 `styles.css`
2. 将文件放入 `.obsidian/plugins/pst-import/`
3. 在 Obsidian 设置中启用插件

**English:**

1. Download `main.js`, `manifest.json`, and `styles.css` from [Releases](https://github.com/wenciara/obsidian-pst-importer/releases)
2. Place files in `.obsidian/plugins/pst-import/`
3. Enable in Obsidian settings

## ✅ Features / 功能

| | 中文 | English |
|---|---|---|
| 📧 | 将 PST 邮件转为 Markdown 笔记 | Convert PST emails into Markdown notes |
| 🔄 | 增量同步，自动跳过已导入邮件 | Incremental sync with duplicate protection |
| 📁 | 保留 PST 文件夹层级结构 | Preserve PST folder structure |
| 🖼️ | 内嵌图片自动转为 `![[wikilink]]` | Embedded images become Obsidian wikilinks |
| 📎 | 附件保存至本地 vault 目录 | Attachments saved alongside notes |
| 📋 | 生成含发件人、日期等字段的 YAML 元数据 | YAML frontmatter with full email metadata |
| 🚀 | 纯 JS 引擎，无需安装额外工具 | Pure JavaScript engine, no external tools |
| 📂 | 可选择性导入指定邮件文件夹 | Choose which PST folders to import or sync |

---

## 📖 Usage / 使用方法

### 📁 如果你想将归档 PST 一次性导入知识库 / Archive a PST into your wiki

**中文：**

1. 点击左侧 **PST 图标**，或在命令面板中运行 **"Import PST file..."**
2. 选择 `.pst` 文件
3. 输入导入后在 vault 中的目标文件夹名
4. 在文件夹选择框中取消勾选不需要的文件夹
5. 开始导入，等待进度窗口完成

**English:**

1. Click the **PST** ribbon icon or run **"Import PST file..."** from the command palette
2. Select the `.pst` file
3. Enter a destination folder name in your vault
4. Uncheck any PST folders you do not need
5. Start the import and wait for the progress window to finish

> 推荐目录示例 / Recommended folder names: `Email/Archive 2024` · `Projects/Client A/Mail` · `People/Team History`

---

### 🔄 如果你想每日轻量同步 Outlook 新邮件 / Keep a lightweight daily sync from Outlook

**中文：**

1. 在 Outlook 中创建一个轻量 staging PST，并设置规则将新邮件复制进去
2. 在 Obsidian 中打开 **Settings → PST Import → Add Sync Profile**
3. 选择 staging `.pst` 文件，设置输出目录
4. 如果该 PST 已经手动导入过，开启「已导入基线」选项，避免重复
5. 在设置页点击 **Sync now**，或按需运行命令 **"Sync configured PST (incremental)"**

**English:**

1. In Outlook, create a staging PST and use rules to copy new mail into it
2. In Obsidian, open **Settings → PST Import → Add Sync Profile**
3. Select the staging `.pst` and set the output folder
4. If already imported manually, enable the baseline option to skip existing messages
5. Click **Sync now** in settings, or run **"Sync configured PST (incremental)"** as needed

> 推荐目录示例 / Recommended folder names: `Email/Current` · `Work/Inbox Mirror` · `Ops/Daily Mail`

---

### 📂 文件夹筛选规则 / Folder selection rules

**中文：** 只显示含有邮件的文件夹；系统文件夹（联系人、日历、任务等）默认排除；子文件夹以路径形式展示，如 `Inbox/ProjectA`。

**English:** Only folders containing emails are shown. System folders (Contacts, Calendar, Tasks, etc.) are excluded by default. Subfolders appear as paths, e.g. `Inbox/ProjectA`.

---

## 📦 Large PST Files / 大型 PST 文件

**中文：** 采用流式读取，**没有硬性文件大小限制**。Outlook 2003 以后生成的 Unicode PST 均可导入。

**English:** Uses a streaming reader with **no hard file-size limit**. Unicode PST files from Outlook 2003 and later are fully supported.

| 文件大小 / Size | 预期耗时 / Expected time |
|---|---|
| < 1 GB | 5 分钟内 / Under 5 minutes |
| 1–5 GB | 15–45 分钟 / 15–45 minutes |
| 5–20 GB | 数小时，建议隔夜 / Hours, best overnight |
| > 20 GB | 可行，但大附件多时有内存压力 / Feasible, watch memory with large attachments |

> 💡 **大文件建议 / Tip for large archives:** 在 Outlook 中将文件夹**单独导出为小 PST**，再分批导入，按项目、年份或发件人拆分效果最佳。
>
> In Outlook, right-click a folder → Export → Outlook Data File (.pst) to export individual folders as smaller files, then import each one separately.

---

## ⚙️ Settings / 设置项

| 设置 / Setting | 说明 / Description | 默认 / Default |
|---|---|---|
| Output Base Folder | 新导入的默认父路径 / Default parent path for new imports | *(空 / empty)* |
| Mirror Folder Structure | 保留 PST 文件夹层级 / Preserve PST subfolder structure | ✅ 开启 |
| Overwrite Existing Files | 重新导入时覆盖已有笔记 / Replace existing notes on re-import | ❌ 关闭 |
| Include YAML Frontmatter | 在笔记顶部添加元数据 / Add metadata header to each note | ✅ 开启 |
| **Sync Profiles** | 配置增量同步的 PST 路径 / Configure PST paths for incremental sync | *(无 / none)* |

---

## 🗂️ Output Structure / 输出结构

```
vault/
└── Email Archive/          ← 导入时自定义的文件夹名 / folder name you choose
    ├── Inbox/
    │   ├── 2024-03-15_001_Alice_Project kickoff.md
    │   └── attachments/
    │       ├── proposal.pdf
    │       └── logo.png
    ├── Inbox/ProjectA/
    │   └── 2024-04-02_003_Bob_Re - timeline.md
    └── Sent Items/
        └── ...
```

文件名格式 / Filename pattern: `date_index_sender_subject.md`

---

## 💻 System Requirements / 系统要求

- **Obsidian Desktop**（Windows / macOS / Linux）
- **Obsidian** v1.5.0+

## License

MIT