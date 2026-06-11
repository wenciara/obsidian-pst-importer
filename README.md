# PST Import

Import Outlook PST email archives into Obsidian as Markdown files with metadata, attachments, and wikilinks.

## Features

- 📧 Export all emails from PST files as Markdown
- 📁 Preserve PST folder structure (Inbox, project folders, etc.)
- 🖼️ Embedded images auto-convert to Obsidian `![[wikilink]]` format
- 📎 Save attachments to `attachments/` subdirectory
- 📋 YAML frontmatter with complete metadata (sender, recipients, date, etc.)
- 🚀 Pure JavaScript single engine (`pst-extractor`), no Outlook or external executables required
- 📂 Pre-import folder selection (support multi-select/select-all)

## What This Plugin Does

- Imports emails from a PST archive into your vault as Markdown notes
- Keeps original mail folder hierarchy if you enable it in settings
- Saves attachments to a dedicated attachments subfolder
- Converts embedded email images into Obsidian-compatible wikilinks
- Lets you choose which folders to import before processing

## Installation

### From Obsidian Community Plugins

1. Open Obsidian → Settings → Community Plugins → Browse
2. Search for "PST Import"
3. Click Install
4. Enable in installed plugins list

> If not yet available in the store, you can use BRAT or manual installation.

### Install with BRAT

1. Install [BRAT](https://obsidian.md/plugins?id=obsidian42-brat) plugin
2. Add repository: `wenciara/obsidian-pst-importer`
3. Enable PST Import

### Manual Installation

1. Go to [Releases](https://github.com/wenciara/obsidian-pst-importer/releases)
2. Download the latest `main.js` and `manifest.json` (and `styles.css` if available)
3. Place files in vault's `.obsidian/plugins/pst-import/` directory
4. Enable plugin in Obsidian settings

## Usage

1. Click the email icon 📧 in the left ribbon, or run "Import PST file..." command
2. Select a `.pst` file
3. Select which email folders to import (multi-select available)
4. Enter folder name for import destination (defaults to PST filename)
5. Wait for import to complete (large files may take a few minutes)
6. Imported emails appear in your target directory

### Folder Selection Rules

- Only folders that contain emails are shown in the selection list.
- Completely empty mailboxes/folders are automatically skipped.
- Common system folders (for example Contacts, Conversation History, Sync Issues, Quick Step Settings) are hidden by default.

## Tips

- For very large PST files, import one mailbox folder at a time.
- If you only need specific projects, uncheck unrelated folders before import.
- Keep "Overwrite Existing Files" off unless you want to replace older notes.

## Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Output Base Directory | Folder in vault to store imports | `PST Import` |
| Preserve Folder Structure | Create subdirectories for PST folders | Enabled |
| Overwrite Existing Files | Overwrite duplicate email filenames | Disabled |
| Include YAML Frontmatter | Generate metadata headers | Enabled |

## Output Structure

```
vault/
└── PST Import/
    └── ArchiveName/
        ├── Inbox/
        │   ├── 2020-07-02_sender_subject.md
        │   └── attachments/
        │       ├── 2020-07-02_sender_document.pdf
        │       └── 2020-07-02_sender_image.jpg
        ├── Any Topic/
        │   └── ...
        └── ...
```

## System Requirements

- **Obsidian Desktop** (`isDesktopOnly`)
- **Obsidian** v1.5.0+

## License

MIT