/**
 * PST Import — 主插件入口
 */

import { App, Notice, Plugin, PluginManifest, addIcon, Modal, Setting } from "obsidian";
import { PstImporterSettingTab } from "./settings";
import type {
  ExtractionEngine,
  PstImporterSettings,
  SyncProfile,
} from "./types";
import { DEFAULT_SETTINGS, emailFingerprint } from "./types";
import { VaultWriter } from "./vault-writer";
import { ProgressModal } from "./progress-modal";
import { FallbackEngine } from "./engines/fallback-engine";
import { SyncStateManager } from "./sync-state";
import * as path from "path";
import * as fs from "fs";
interface ElectronLike {
  remote?: {
    dialog?: {
      showOpenDialog(options: {
        title: string;
        filters: Array<{ name: string; extensions: string[] }>;
        properties: string[];
      }): Promise<{ canceled: boolean; filePaths: string[] }>;
    };
  };
}

export default class PstImporterPlugin extends Plugin {
  settings: PstImporterSettings;
  syncStateManager: SyncStateManager;

  constructor(app: App, manifest: PluginManifest) {
    super(app, manifest);
  }

  async onload(): Promise<void> {
    await this.loadSettings();

    // 初始化同步状态管理器
    this.syncStateManager = new SyncStateManager(
      () => this.loadData() as Promise<Record<string, unknown> | null>,
      (data) => this.saveData(data)
    );
    await this.syncStateManager.load();

    // 注册 "Import PST file..." 命令（手动导入任意 PST）
    this.addCommand({
      id: "import-pst-file",
      name: "Import PST file...",
      callback: () => {
        void this.startImport();
      },
    });

    // 注册 "Sync PST" 命令（增量同步已配置的 PST）
    this.addCommand({
      id: "sync-pst",
      name: "Sync configured PST (incremental)",
      callback: () => {
        void this.startSync();
      },
    });

    // 注册自定义 PST 文字图标
    addIcon(
      "pst-import",
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="none">
        <defs>
          <linearGradient id="pstGradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#2F80ED"/>
            <stop offset="100%" stop-color="#1F5FB8"/>
          </linearGradient>
        </defs>
        <rect x="2.5" y="2.5" width="19" height="19" rx="4" fill="url(#pstGradient)"/>
        <rect x="2.5" y="2.5" width="19" height="19" rx="4" fill="none" stroke="#174A8D" stroke-width="1"/>
        <text x="12" y="15.5" text-anchor="middle" font-size="7.5" font-weight="700" fill="#FFFFFF">PST</text>
      </svg>`
    );

    // 功能区图标 — PST 文字图标
    this.addRibbonIcon("pst-import", "Import PST file...", () => {
      void this.startImport();
    });

    // 设置 Tab
    this.addSettingTab(new PstImporterSettingTab(this.app, this));

    console.log("PST Import loaded");
  }

  onunload(): void {
    console.log("PST Import unloaded");
  }

  async loadSettings(): Promise<void> {
    const loaded = (await this.loadData()) as Partial<PstImporterSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded ?? {});
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /**
   * 启动 PST 导入流程
   */
  async startImport(): Promise<void> {
    try {
      console.log("PST Import: startImport called");

      // 选择 PST 文件
      const pstPath = await this.choosePstFile();
      console.log("PST Import: chosen file:", pstPath);
      if (!pstPath) return;

      // 检查文件大小，决定用哪个引擎
      let fileSize = 0;
      try {
        fileSize = fs.statSync(pstPath).size;
        console.log("PST Import: file size:", fileSize);
      } catch {
        // Unable to stat file, continue anyway
      }

      // 选择引擎
      const engine = await this.selectEngine(fileSize);
      if (!engine) {
        new Notice("PST Import: No available parsing engine found.");
        return;
      }

      new Notice(`PST Import: Using ${engine.name} engine`);
      console.log(`PST Import: using engine ${engine.name}`);

      // 弹输入框让用户输入导入后的文件夹名
      const defaultName = path.basename(pstPath, ".pst").replace(/[<>:"/\\|?*]/g, "_");
      const folderName = await this.askFolderName(defaultName);
      if (!folderName) return; // 用户取消

      // 扫描 PST 中的邮件夹列表，让用户选择导入哪些
      let selectedFolders: string[] | undefined;
      try {
        if (engine instanceof FallbackEngine) {
          const folders = FallbackEngine.scanPstFolders(pstPath);
          if (folders.length > 0) {
            selectedFolders = await this.askFolderSelection(folders);
            if (!selectedFolders || selectedFolders.length === 0) return; // 用户取消
          }
        }
      } catch (e) {
        console.log("PST Import: folder scan failed (non-critical):", e);
      }

      // 显示进度模态框
      const modal = new ProgressModal(this.app);

      // 直接用用户输入的文件夹名（不加 "PST Import/" 前缀）
      const baseDir = folderName;
      await this.ensureOutputBaseFolder(baseDir);
      console.log("PST Import: baseDir:", baseDir);

      // 开始提取
      modal.open();
      modal.setStatus("Extracting emails...");

      try {
        const vaultWriter = new VaultWriter(
          this.app.vault,
          this.settings,
          baseDir
        );

        let emailCount = 0;
        let errorCount = 0;
        console.log("PST Import: starting extraction...");

        try {
          for await (const email of engine.extract(pstPath, (p) => {
            modal.updateProgress(p);
          }, selectedFolders)) {
            try {
              console.log("PST Import: got email:", email.subject?.substring(0, 50));
              await vaultWriter.writeEmail(email);
              emailCount++;
            } catch (writeErr) {
              // 单封邮件写入失败不中断整体流程
              errorCount++;
              const errMsg = writeErr instanceof Error ? writeErr.message : String(writeErr);
              console.error("PST Import: write error for email:", email.subject?.substring(0, 50), writeErr);
              modal.setStatus(`⚠️ Write failed for email #${emailCount + errorCount}: ${errMsg}`);
            }

            if ((emailCount + errorCount) % 10 === 0 && emailCount > 0) {
              modal.setStatus(`Processed ${emailCount} emails${errorCount > 0 ? ` (${errorCount} failed)` : ""}`);
            }
          }
        } catch (extractErr) {
          // extract() 抛异常（无法打开 PST 等）
          const errMsg = extractErr instanceof Error ? extractErr.message : String(extractErr);
          console.error("PST Import: extraction stream error:", extractErr);
          modal.setStatus(`❌ Extraction failed: ${errMsg}`);
          modal.markError();
          new Notice(`PST extraction failed: ${errMsg}`);
          return;
        }

        modal.setStatus(`✅ Import complete! ${emailCount} emails${errorCount > 0 ? `, ${errorCount} failed` : ""}`);
        modal.markComplete();

        new Notice(`PST import complete: ${emailCount} emails${errorCount > 0 ? `, ${errorCount} failed` : ""}`);
        console.log(`PST Import: done, ${emailCount} emails, ${errorCount} errors`);
      } catch (err) {
        console.error("PST Import: extraction/write error:", err);
        const errMsg = err instanceof Error ? err.message : String(err);
        modal.setStatus(`❌ Import error: ${errMsg}`);
        modal.markError();
        new Notice(`PST import failed: ${errMsg}`);
      }
    } catch (err) {
      console.error("PST Import: top-level error:", err);
      const errMsg = err instanceof Error ? err.message : String(err);
      new Notice(`PST Import error: ${errMsg}`);
      console.error("PST Import error:", err);
    }
  }

  /**
   * 增量同步：只导入已配置 PST 中的新邮件
   */
  async startSync(): Promise<void> {
    const profiles = this.settings.syncProfiles;
    if (profiles.length === 0) {
      new Notice("No sync profile configured. Go to Settings → PST Import to add one.");
      return;
    }

    // 如果只有一个 profile，直接同步；否则让用户选择
    let profile: SyncProfile;
    if (profiles.length === 1) {
      profile = profiles[0];
    } else {
      const chosen = await this.askProfileSelection(profiles);
      if (!chosen) return;
      profile = chosen;
    }

    // 验证 PST 文件存在
    if (!fs.existsSync(profile.pstPath)) {
      new Notice(`PST file not found: ${profile.pstPath}`);
      return;
    }

    const engine = await this.selectEngine(0);
    if (!engine) {
      new Notice("PST Import: No available parsing engine.");
      return;
    }

    // 加载同步状态
    await this.syncStateManager.load();
    const importedSet = this.syncStateManager.getImportedSet(profile.label);

    const modal = new ProgressModal(this.app);
    modal.open();
    modal.setStatus("Scanning for new emails...");

    try {
      await this.ensureOutputBaseFolder(profile.outputFolder);

      const vaultWriter = new VaultWriter(
        this.app.vault,
        this.settings,
        profile.outputFolder
      );

      let newCount = 0;
      let skipCount = 0;
      let errorCount = 0;

      const selectedFolders = profile.selectedFolders.length > 0
        ? profile.selectedFolders
        : undefined;

      for await (const email of engine.extract(profile.pstPath, (p) => {
        modal.updateProgress(p);
      }, selectedFolders)) {
        const fp = emailFingerprint(email);

        if (importedSet.has(fp)) {
          skipCount++;
          if (skipCount % 50 === 0) {
            modal.setStatus(`Skipped ${skipCount} existing, imported ${newCount} new...`);
          }
          continue;
        }

        try {
          await vaultWriter.writeEmail(email);
          newCount++;
          this.syncStateManager.markImported(profile.label, fp);
        } catch (writeErr) {
          errorCount++;
          const errMsg = writeErr instanceof Error ? writeErr.message : String(writeErr);
          console.error("PST Import: sync write error:", email.subject?.substring(0, 50), errMsg);
        }

        if (newCount % 10 === 0 && newCount > 0) {
          modal.setStatus(`Imported ${newCount} new emails (${skipCount} skipped)...`);
        }
      }

      // 保存同步状态
      this.syncStateManager.updateLastSync(profile.label);
      await this.syncStateManager.save();

      const msg = `Sync complete: ${newCount} new emails imported, ${skipCount} skipped${errorCount > 0 ? `, ${errorCount} errors` : ""}`;
      modal.setStatus(`✅ ${msg}`);
      modal.markComplete();
      new Notice(msg);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      modal.setStatus(`❌ Sync failed: ${errMsg}`);
      modal.markError();
      new Notice(`PST Sync failed: ${errMsg}`);
    }
  }

  /**
   * 让用户选择一个 sync profile
   */
  private askProfileSelection(profiles: SyncProfile[]): Promise<SyncProfile | null> {
    return new Promise((resolve) => {
      const modal = new ProfileSelectModal(this.app, profiles, resolve);
      modal.open();
    });
  }

  /**
   * 选择可用的解析引擎
   */
  private async selectEngine(fileSize: number): Promise<ExtractionEngine | null> {
    const jsEngine = new FallbackEngine();
    if (await jsEngine.canRun()) {
      return jsEngine;
    }
    return null;
  }

  /**
   * 通过 Electron remote.dialog 或 HTML input file 选择 PST 文件
   */
  private async choosePstFile(): Promise<string | null> {
    // 尝试 Electron dialog（最可靠）
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports -- Obsidian runs in Electron; require is the only reliable way to access electron APIs at runtime.
      const electron = require("electron") as ElectronLike;
      const remote = electron.remote;
      if (remote?.dialog) {
        const result = await remote.dialog.showOpenDialog({
          title: "Select PST File",
          filters: [{ name: "PST Files", extensions: ["pst", "PST"] }],
          properties: ["openFile"],
        });
        if (!result.canceled && result.filePaths.length > 0) {
          return result.filePaths[0];
        }
        return null;
      }
    } catch (e) {
      console.log("Electron dialog unavailable, falling back to input[type=file]", e);
    }

    // 降级：HTML file input
    return new Promise((resolve) => {
      const input = activeDocument.createElement("input");
      input.type = "file";
      input.accept = ".pst,.PST";
      input.hidden = true;

      input.addEventListener("change", () => {
        console.log("file input change event", input.files);
        if (input.files && input.files.length > 0) {
          const file = input.files[0];
          // Electron 环境下 File 对象有 path 属性（全路径）
          // webUtils.getPathForFile 是 Electron 30+ 的标准方式
          let filePath: string | undefined;
          try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports -- access Electron webUtils for file path
            const { webUtils } = require("electron") as { webUtils?: { getPathForFile(file: File): string } };
            if (webUtils) {
              filePath = webUtils.getPathForFile(file);
            }
          } catch { /* webUtils not available */ }
          // Fallback: Electron legacy file.path property
          if (!filePath) {
            filePath = (file as unknown as { path?: string }).path;
          }
          // Last resort: just filename (will fail later but user will see the error)
          if (!filePath) {
            filePath = file.name;
          }
          console.log("Selected file path:", filePath);
          resolve(filePath);
        } else {
          resolve(null);
        }
        // 清理
        if (input.parentNode) input.parentNode.removeChild(input);
      });

      input.addEventListener("cancel", () => {
        console.log("file input cancelled");
        resolve(null);
        if (input.parentNode) input.parentNode.removeChild(input);
      });

      activeDocument.body.appendChild(input);
      input.click();
    });
  }

  /**
   * 弹输入框让用户输入导入后的文件夹名
   */
  private askFolderName(defaultName: string): Promise<string | null> {
    return new Promise((resolve) => {
      const modal = new FolderNameModal(this.app, defaultName, (result) => {
        resolve(result);
      });
      modal.open();
    });
  }

  /**
   * 弹多选列表让用户选择要导入的邮件夹
   */
  private askFolderSelection(folders: string[]): Promise<string[] | null> {
    return new Promise((resolve) => {
      const modal = new FolderSelectModal(this.app, folders, (result) => {
        resolve(result);
      });
      modal.open();
    });
  }

  /**
   * 确保 vault 中的输出基目录存在
   */
  private async ensureOutputBaseFolder(basePath?: string): Promise<string> {
    const folder = basePath || this.settings.outputBaseFolder;
    const existing = this.app.vault.getAbstractFileByPath(folder);
    if (!existing) {
      await this.app.vault.createFolder(folder);
    }
    return folder;
  }
}

/**
 * 文件夹命名弹窗
 */
class FolderNameModal extends Modal {
  private defaultName: string;
  private callback: (result: string | null) => void;

  constructor(app: App, defaultName: string, callback: (result: string | null) => void) {
    super(app);
    this.defaultName = defaultName;
    this.callback = callback;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Import PST File" });
    contentEl.createEl("p", { text: "Enter the folder name in your vault for imported emails:" });

    let inputValue = this.defaultName;

    const inputWrap = contentEl.createDiv();
    const inputEl = inputWrap.createEl("input", {
      type: "text",
      cls: "pst-folder-name-input",
      value: inputValue,
    });
    inputEl.addEventListener("input", () => {
      inputValue = inputEl.value;
    });
    inputEl.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") {
        const name = inputValue.trim() || this.defaultName;
        this.callback(name);
        this.close();
      }
    });
    // 自动聚焦
    window.setTimeout(() => inputEl.focus(), 100);

    new Setting(contentEl).addButton((btn) => {
      btn.setButtonText("Start Import");
      btn.setCta();
      btn.onClick(() => {
        const name = inputValue.trim() || this.defaultName;
        this.callback(name);
        this.close();
      });
    });

    new Setting(contentEl).addButton((btn) => {
      btn.setButtonText("Cancel");
      btn.onClick(() => {
        this.callback(null);
        this.close();
      });
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

/**
 * Folder multi-select modal
 */
class FolderSelectModal extends Modal {
  private folders: string[];
  private callback: (result: string[] | null) => void;
  private selected: Set<string>;
  private confirmBtn!: HTMLButtonElement;

  constructor(app: App, folders: string[], callback: (result: string[] | null) => void) {
    super(app);
    this.folders = folders;
    this.callback = callback;
    this.selected = new Set(folders); // 默认全选
  }

  private updateButtonText() {
    if (this.confirmBtn) {
      const count = this.selected.size;
      this.confirmBtn.textContent = `Import (${count} folders)`;
    }
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Select folders to import" });
    contentEl.createEl("p", { text: `${this.folders.length} folders found. Uncheck folders you want to skip:` });

    const listEl = contentEl.createDiv({ cls: "pst-folder-select-list" });

    for (const folder of this.folders) {
      const item = listEl.createDiv({ cls: "pst-folder-item" });

      const checkbox = item.createEl("input", { type: "checkbox" });
      checkbox.checked = true;
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          this.selected.add(folder);
        } else {
          this.selected.delete(folder);
        }
        this.updateButtonText();
      });

      item.createEl("span", { text: folder });
    }

    // 全选/取消全选按钮
    const btnRow = contentEl.createDiv({ cls: "pst-folder-select-buttons" });

    const selectAllBtn = btnRow.createEl("button", { text: "Select All" });
    selectAllBtn.addEventListener("click", () => {
      const checkboxes = listEl.querySelectorAll("input[type=checkbox]");
      checkboxes.forEach((cb) => {
        (cb as HTMLInputElement).checked = true;
      });
      this.selected = new Set(this.folders);
      this.updateButtonText();
    });

    const deselectAllBtn = btnRow.createEl("button", { text: "Deselect All" });
    deselectAllBtn.addEventListener("click", () => {
      const checkboxes = listEl.querySelectorAll("input[type=checkbox]");
      checkboxes.forEach((cb) => {
        (cb as HTMLInputElement).checked = false;
      });
      this.selected.clear();
      this.updateButtonText();
    });

    // 确认/取消按钮
    contentEl.createEl("hr");

    new Setting(contentEl).addButton((btn) => {
      this.confirmBtn = btn.buttonEl;
      btn.setButtonText(`Import (${this.folders.length} folders)`);
      btn.setCta();
      btn.onClick(() => {
        const result = Array.from(this.selected);
        this.callback(result.length > 0 ? result : null);
        this.close();
      });
    });

    new Setting(contentEl).addButton((btn) => {
      btn.setButtonText("Cancel");
      btn.onClick(() => {
        this.callback(null);
        this.close();
      });
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

/**
 * Sync profile 选择弹窗
 */
class ProfileSelectModal extends Modal {
  private profiles: SyncProfile[];
  private callback: (result: SyncProfile | null) => void;

  constructor(app: App, profiles: SyncProfile[], callback: (result: SyncProfile | null) => void) {
    super(app);
    this.profiles = profiles;
    this.callback = callback;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Select sync profile" });

    for (const profile of this.profiles) {
      new Setting(contentEl)
        .setName(profile.label)
        .setDesc(profile.pstPath)
        .addButton((btn) => {
          btn.setButtonText("Sync");
          btn.setCta();
          btn.onClick(() => {
            this.callback(profile);
            this.close();
          });
        });
    }

    new Setting(contentEl).addButton((btn) => {
      btn.setButtonText("Cancel");
      btn.onClick(() => {
        this.callback(null);
        this.close();
      });
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}