/**
 * PST Import — 主插件入口
 */

import { App, Notice, Plugin, PluginManifest, addIcon, Modal, Setting } from "obsidian";
import { PstImporterSettingTab } from "./settings";
import type {
  ExtractionEngine,
  PstImporterSettings,
} from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { VaultWriter } from "./vault-writer";
import { ProgressModal } from "./progress-modal";
import { FallbackEngine } from "./engines/fallback-engine";
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

  constructor(app: App, manifest: PluginManifest) {
    super(app, manifest);
  }

  async onload(): Promise<void> {
    await this.loadSettings();

    // 注册 "Import PST file..." 命令
    this.addCommand({
      id: "import-pst-file",
      name: "Import PST file...",
      callback: () => {
        void this.startImport();
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
        new Notice(
          "PST Import: 未找到可用解析引擎。\n" +
          "请确认：1. Outlook 已安装  2. 插件目录下有 pst-importer.exe 或 Python 环境可用"
        );
        return;
      }

      new Notice(`PST Import: 使用 ${engine.name} 引擎`);
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
      modal.setStatus("正在提取邮件...");

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
              modal.setStatus(`⚠️ 第 ${emailCount + errorCount} 封写入失败: ${errMsg}`);
            }

            if ((emailCount + errorCount) % 10 === 0 && emailCount > 0) {
              modal.setStatus(`已处理 ${emailCount} 封邮件${errorCount > 0 ? ` (${errorCount} 封失败)` : ""}`);
            }
          }
        } catch (extractErr) {
          // extract() 抛异常（无法打开 PST 等）
          const errMsg = extractErr instanceof Error ? extractErr.message : String(extractErr);
          console.error("PST Import: extraction stream error:", extractErr);
          modal.setStatus(`❌ 提取失败：${errMsg}`);
          modal.markError();
          new Notice(`PST 提取失败：${errMsg}`);
          return;
        }

        modal.setStatus(`✅ 导入完成！共 ${emailCount} 封邮件${errorCount > 0 ? `，${errorCount} 封失败` : ""}`);
        modal.markComplete();

        new Notice(`PST 导入完成：${emailCount} 封邮件${errorCount > 0 ? `，${errorCount} 封失败` : ""}`);
        console.log(`PST Import: done, ${emailCount} emails, ${errorCount} errors`);
      } catch (err) {
        console.error("PST Import: extraction/write error:", err);
        const errMsg = err instanceof Error ? err.message : String(err);
        modal.setStatus(`❌ 导入出错：${errMsg}`);
        modal.markError();
        new Notice(`PST 导入失败：${errMsg}`);
      }
    } catch (err) {
      console.error("PST Import: top-level error:", err);
      const errMsg = err instanceof Error ? err.message : String(err);
      new Notice(`PST Import 错误：${errMsg}`);
      console.error("PST Import error:", err);
    }
  }

  /**
   * 选择可用的解析引擎
   * 使用 pst-extractor（纯 JS，支持任意大小 Unicode PST）
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
          title: "选择 PST 文件",
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

    contentEl.createEl("h2", { text: "导入 PST 文件" });
    contentEl.createEl("p", { text: "请输入导入后在 vault 中的文件夹名称：" });

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
      btn.setButtonText("开始导入");
      btn.setCta();
      btn.onClick(() => {
        const name = inputValue.trim() || this.defaultName;
        this.callback(name);
        this.close();
      });
    });

    new Setting(contentEl).addButton((btn) => {
      btn.setButtonText("取消");
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
 * 邮件夹多选弹窗
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
      this.confirmBtn.textContent = `开始导入 (${count} 个文件夹)`;
    }
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "选择要导入的邮件夹" });
    contentEl.createEl("p", { text: `共 ${this.folders.length} 个邮件夹，取消勾选可跳过不需要的文件夹：` });

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

    const selectAllBtn = btnRow.createEl("button", { text: "全选" });
    selectAllBtn.addEventListener("click", () => {
      const checkboxes = listEl.querySelectorAll("input[type=checkbox]");
      checkboxes.forEach((cb) => {
        (cb as HTMLInputElement).checked = true;
      });
      this.selected = new Set(this.folders);
      this.updateButtonText();
    });

    const deselectAllBtn = btnRow.createEl("button", { text: "取消全选" });
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
      btn.setButtonText(`开始导入 (${this.folders.length} 个文件夹)`);
      btn.setCta();
      btn.onClick(() => {
        const result = Array.from(this.selected);
        this.callback(result.length > 0 ? result : null);
        this.close();
      });
    });

    new Setting(contentEl).addButton((btn) => {
      btn.setButtonText("取消");
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