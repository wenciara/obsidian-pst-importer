/**
 * PST Importer — 进度模态框
 */

import { App, Modal, Setting } from "obsidian";
import { ProgressEvent } from "./types";

export class ProgressModal extends Modal {
  private statusEl!: HTMLDivElement;
  private progressEl!: HTMLProgressElement;
  private folderEl!: HTMLDivElement;
  private detailEl!: HTMLDivElement;
  private cancelBtn!: HTMLButtonElement;
  private _cancelled = false;
  private _resolveCancel!: () => void;
  private _cancelPromise: Promise<void>;

  constructor(app: App) {
    super(app);
    this._cancelPromise = new Promise((resolve) => {
      this._resolveCancel = resolve;
    });
  }

  get cancelled(): boolean {
    return this._cancelled;
  }

  /** 等待取消或完成 */
  onCancel(): Promise<void> {
    return this._cancelPromise;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "正在导入 PST..." });

    // 当前文件夹
    this.folderEl = contentEl.createDiv({ cls: "pst-importer-folder" });
    this.folderEl.setText("准备中...");

    // 进度条（使用原生 progress，避免直接样式赋值）
    this.progressEl = contentEl.createEl("progress", {
      cls: "pst-importer-progress",
      attr: {
        max: "100",
        value: "0",
      },
    });

    // 状态文字
    this.statusEl = contentEl.createDiv({ cls: "pst-importer-status" });
    this.statusEl.setText("正在提取邮件...");

    // 详细信息
    this.detailEl = contentEl.createDiv({ cls: "pst-importer-detail" });

    // 取消按钮
    new Setting(contentEl).addButton((btn) => {
      this.cancelBtn = btn.buttonEl;
      btn.setButtonText("取消");
      btn.onClick(() => {
        this._cancelled = true;
        this._resolveCancel();
        this.cancelBtn.setText("正在取消...");
        this.cancelBtn.disabled = true;
      });
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }

  /** 更新进度 */
  updateProgress(event: ProgressEvent) {
    if (this._cancelled) return;

    switch (event.type) {
      case "folder":
        this.folderEl.setText(`📁 ${event.folderPath || event.message}`);
        break;
      case "email":
        if (event.current !== undefined && event.total !== undefined) {
          const pct = Math.round((event.current / event.total) * 100);
          this.progressEl.value = pct;
        }
        if (event.emailSubject) {
          this.detailEl.setText(
            `📧 ${event.emailSubject.slice(0, 80)}`
          );
        }
        break;
      case "error":
        this.detailEl.setText(`❌ ${event.message}`);
        break;
    }

    if (event.message) {
      this.statusEl.setText(event.message);
    }
  }

  /** 设置状态文字 */
  setStatus(text: string) {
    if (!this._cancelled) {
      this.statusEl.setText(text);
    }
  }

  /** 标记完成 */
  markComplete() {
    this.progressEl.value = 100;
    this.progressEl.classList.remove("pst-importer-progress-error");
    this.progressEl.classList.add("pst-importer-progress-complete");
    this.cancelBtn.setText("关闭");
    this.cancelBtn.disabled = false;
    this.cancelBtn.onclick = () => this.close();
  }

  /** 标记出错 */
  markError() {
    this.progressEl.classList.remove("pst-importer-progress-complete");
    this.progressEl.classList.add("pst-importer-progress-error");
    this.cancelBtn.setText("关闭");
    this.cancelBtn.disabled = false;
    this.cancelBtn.onclick = () => this.close();
  }
}