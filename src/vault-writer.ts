/**
 * PST Importer — Vault 写入器
 *
 * 负责将 EmailData 写入 Obsidian vault：
 * - 创建文件夹
 * - 生成 YAML frontmatter + Markdown 正文
 * - 保存附件
 * - 内嵌图片 CID 映射
 */

import { TFile, Vault, TFolder } from "obsidian";
import { AttachmentData, EmailData, PstImporterSettings } from "./types";
import * as path from "path";
import TurndownService from "turndown";

// 图片扩展名检测
const IMAGE_EXT_RE = /\.(png|jpg|jpeg|gif|bmp|webp|svg|tiff?)$/i;

export class VaultWriter {
  private vault: Vault;
  private settings: PstImporterSettings;
  /** vault 中的输出基目录路径（如 "PST Import/backup_2026-06-08"） */
  private baseDir: string;
  /** turndown 实例：HTML → Markdown */
  private turndownService: TurndownService;

  constructor(
    vault: Vault,
    settings: PstImporterSettings,
    baseDir: string,
  ) {
    this.vault = vault;
    this.settings = settings;
    this.baseDir = baseDir;

    // 初始化 turndown
    this.turndownService = new TurndownService({
      headingStyle: "atx",
      hr: "---",
      bulletListMarker: "-",
      codeBlockStyle: "fenced",
      emDelimiter: "*",
      strongDelimiter: "**",
    });

    // 不使用自定义规则处理 CID 图片（改用 turndown 后的 remapCidReferences 后处理）

    // 规则：保留 <a> 链接为 Markdown 格式
    this.turndownService.addRule("keepLinks", {
      filter: "a",
      replacement: (content: string, node: HTMLElement) => {
        const href = node.getAttribute("href");
        if (!href) return content;
        // 避免 mailto: 链接过长
        if (href.startsWith("mailto:")) {
          return content;
        }
        return `[${content}](${href})`;
      },
    });
  }

  /**
   * 写入一封邮件到 vault
   */
  async writeEmail(email: EmailData): Promise<string> {
    // 1. 确定输出路径
    const outDir = this.resolveOutputDir(email.folderPath);
    await this.ensureDir(outDir);

    // 2. 保存附件，建立 CID 映射
    const cidMap = await this.saveAttachments(email.attachments, outDir);

    // 3. 生成 Markdown 内容
    const content = this.buildMarkdown(email, cidMap);

    // 4. 写入 .md 文件
    const filename = this.buildFilename(email);
    const filePath = `${outDir}/${filename}`;
    const existing = this.vault.getAbstractFileByPath(filePath);

    if (existing instanceof TFolder) {
      // 路径冲突，跳过
      console.warn(`Skipping ${filePath}: path is a folder`);
      return filePath;
    }

    if (existing instanceof TFile) {
      if (!this.settings.overwriteExisting) {
        return filePath; // 跳过
      }
      await this.vault.modify(existing, content);
    } else {
      try {
        await this.vault.create(filePath, content);
      } catch (err) {
        // 竞争条件：文件可能在 getAbstractFileByPath 之后被创建
        // 降级尝试 modify
        const retryExisting = this.vault.getAbstractFileByPath(filePath);
        if (retryExisting instanceof TFile && this.settings.overwriteExisting) {
          await this.vault.modify(retryExisting, content);
        } else if (retryExisting instanceof TFile) {
          // 已存在但不允许覆盖，跳过
          return filePath;
        } else {
          // 最后一次尝试：可能是 Obsidian 元数据未刷新，直接创建
          try {
            await this.vault.create(filePath, content);
          } catch {
            // 确实失败了，跳过而不是抛出（避免一封邮件拖垮整个导入）
            console.error(`PST Import: failed to create ${filePath}:`, err);
            return filePath;
          }
        }
      }
    }

    return filePath;
  }

  /**
   * 解析输出目录：根据 PST 文件夹路径决定 vault 中的存放位置
   */
  private resolveOutputDir(folderPath: string): string {
    if (!this.settings.mirrorFolderStructure || !folderPath) {
      return `${this.baseDir}`;
    }
    // e.g. "收件箱/项目子文件夹" → "PST Import/backup_2026-06-08/收件箱/项目子文件夹"
    return `${this.baseDir}/${folderPath}`;
  }

  /**
   * 确保 vault 中的目录存在（递归创建）
   */
  private async ensureDir(dirPath: string): Promise<void> {
    const parts = dirPath.split("/").filter(Boolean);
    let acc = "";
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      const existing = this.vault.getAbstractFileByPath(acc);
      if (!existing) {
        try {
          await this.vault.createFolder(acc);
        } catch {
          // 文件夹可能在并发中已被创建（Obsidian 元数据延迟），忽略
        }
      }
    }
  }

  /**
   * 保存附件到 vault 并建立 CID 映射表
   */
  private async saveAttachments(
    attachments: AttachmentData[],
    outDir: string
  ): Promise<Map<string, string>> {
    const cidMap = new Map<string, string>();
    const attDir = `${outDir}/attachments`;
    await this.ensureDir(attDir);

    for (const att of attachments) {
      // 用 email 前缀来区分同名附件
      const filename = att.filename;
      // 去除非法字符
      const safeName = filename.replace(/[<>:"/\\|?*]/g, "_");
      const filePath = `${attDir}/${safeName}`;

      // 去重
      const finalPath = this.dedupPath(filePath);

      // 写入二进制文件（跳过空数据）
      const existing = this.vault.getAbstractFileByPath(finalPath);
      if (att.data && att.data.byteLength > 0) {
        if (!(existing instanceof TFile)) {
          try {
            await this.vault.createBinary(finalPath, att.data);
          } catch (attErr) {
            console.warn(`PST Import: attachment write failed: ${finalPath}`, attErr);
            // 附件写入失败不阻塞整封邮件
          }
        }
        // 如果已存在 TFile，跳过写入（保留已有文件）
      }
      // 空附件：不写文件，但 CID 映射仍然建立

      // CID 映射：存储所有可能的 key 变体，确保正文能匹配上
      const savedName = path.basename(finalPath);
      if (att.contentId) {
        const raw = att.contentId;

        // 原始 contentId
        cidMap.set(raw.toLowerCase(), savedName);
        // 去掉尖括号
        const noBrackets = raw.replace(/[<>]/g, "").toLowerCase();
        cidMap.set(noBrackets, savedName);
        // 去掉 @ 后缀（保留文件名部分）
        const noAt = raw.replace(/@.*$/, "").trim().toLowerCase();
        cidMap.set(noAt, savedName);
        // 去掉尖括号再去掉 @
        const noBracketsNoAt = raw.replace(/[<>]/g, "").replace(/@.*$/, "").trim().toLowerCase();
        cidMap.set(noBracketsNoAt, savedName);
      }

      // 也通过原始文件名映射（确保纯文件名匹配）
      cidMap.set(att.filename.toLowerCase(), savedName);
      // 文件名去掉扩展名也存一份
      const nameNoExt = att.filename.replace(/\.[^.]+$/, "").toLowerCase();
      cidMap.set(nameNoExt, savedName);
    }

    return cidMap;
  }

  /**
   * 文件名去重：如果已存在则加 _1, _2 后缀
   */
  private dedupPath(filePath: string): string {
    const existing = this.vault.getAbstractFileByPath(filePath);
    if (!(existing instanceof TFile)) return filePath;

    const ext = path.extname(filePath);
    const base = ext ? filePath.slice(0, -ext.length) : filePath;
    let counter = 1;
    let newPath = `${base}_${counter}${ext}`;
    while (this.vault.getAbstractFileByPath(newPath) instanceof TFile) {
      counter++;
      newPath = `${base}_${counter}${ext}`;
    }
    return newPath;
  }

  /**
   * 生成 Markdown 文件名
   *
   * 格式: `日期_序号_发件人_主题.md`
   * 唯一性由 日期+序号 保证（序号在文件夹内唯一），发件人和主题仅辅助可读性。
   * 总长度控制在 100 字符以内，避免加上路径后超过 Windows 260 限制。
   */
  private buildFilename(email: EmailData): string {
    const date = email.sentOn
      ? this.formatDate(email.sentOn)
      : "nodate";
    const index = String(email.index || 0).padStart(3, "0");
    const sender = this.sanitize(email.senderName || email.senderEmail || "unknown", 10);
    const subject = this.sanitize(email.subject || "No Subject", 50);

    // 基础部分（保证唯一）: "2026-06-10_001" = 14 chars
    // 可读部分: "_发件人_主题" 截断到剩余空间
    const MAX_FILENAME = 100; // 不含 .md
    const base = `${date}_${index}`;
    const readable = `_${sender}_${subject}`;
    const remaining = MAX_FILENAME - base.length;
    const trimmed = remaining > 0 ? readable.slice(0, remaining) : "";

    let filename = `${base}${trimmed}.md`;

    // 确保文件名不全是特殊字符
    const cleaned = this.sanitize(filename);
    if (cleaned === ".md" || cleaned === "_.md") {
      return `email_${index}.md`;
    }
    return cleaned;
  }

  /**
   * 构建完整的 Markdown 内容（含 YAML frontmatter 和附件列表）
   */
  private buildMarkdown(
    email: EmailData,
    cidMap: Map<string, string>
  ): string {
    const lines: string[] = [];

    // YAML frontmatter
    if (this.settings.includeYamlFrontmatter) {
      lines.push("---");
      lines.push(`subject: "${this.escapeYaml(email.subject)}"`);
      lines.push(`from: "${this.escapeYaml(email.senderName)}"`);
      lines.push(`fromEmail: "${this.escapeYaml(email.senderEmail)}"`);
      if (email.toList.length)
        lines.push(`to: [${email.toList.map((t) => `"${this.escapeYaml(t)}"`).join(", ")}]`);
      if (email.ccList.length)
        lines.push(`cc: [${email.ccList.map((c) => `"${this.escapeYaml(c)}"`).join(", ")}]`);
      if (email.bccList.length)
        lines.push(`bcc: [${email.bccList.map((b) => `"${this.escapeYaml(b)}"`).join(", ")}]`);
      if (email.sentOn)
        lines.push(`sent: "${email.sentOn.toISOString()}"`);
      if (email.receivedOn)
        lines.push(`received: "${email.receivedOn.toISOString()}"`);
      if (email.categories)
        lines.push(`categories: "${this.escapeYaml(email.categories)}"`);
      if (email.folderPath)
        lines.push(`folder: "${this.escapeYaml(email.folderPath)}"`);
      lines.push(`attachments_count: ${email.attachments.length}`);
      lines.push("---");
      lines.push("");
    }

    // 标题
    lines.push(`# ${email.subject}`);
    lines.push("");

    // 元数据段
    lines.push("---");
    lines.push("## Metadata");
    lines.push("");
    lines.push(
      `- **From:** ${email.senderName} (${email.senderEmail})`
    );
    if (email.toList.length)
      lines.push(`- **To:** ${email.toList.join("; ")}`);
    if (email.ccList.length)
      lines.push(`- **CC:** ${email.ccList.join("; ")}`);
    if (email.bccList.length)
      lines.push(`- **BCC:** ${email.bccList.join("; ")}`);
    if (email.sentOn)
      lines.push(
        `- **Sent:** ${this.formatDate(email.sentOn)}`
      );
    if (email.receivedOn)
      lines.push(
        `- **Received:** ${this.formatDate(email.receivedOn)}`
      );
    if (email.folderPath)
      lines.push(`- **Folder:** ${email.folderPath}`);
    if (email.categories)
      lines.push(`- **Categories:** ${email.categories}`);
    lines.push("");

    // 正文 — 使用 turndown 将 HTML 转为 Markdown
    lines.push("---");
    lines.push("## Body");
    lines.push("");

    let body = email.bodyHtml || email.bodyText || "";

    if (body) {
      if (email.bodyHtml && email.bodyHtml.includes("<")) {
        // 预处理：去除 Outlook 生成的 CSS 样式块和 HTML 注释
        // 同时提取 <table> 单独处理（turndown 会破坏表格结构）
        let cleanHtml: string;
        let extractedTables: string[] = [];
        try {
          cleanHtml = email.bodyHtml
            // 去掉 <style>...</style> 块
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
            // 去掉 HTML 注释 <!-- ... -->
            .replace(/<!--[\s\S]*?-->/g, "")
            // 去掉多余的空白行
            .replace(/\n{3,}/g, "\n\n");

          // 提取并移除 <table> 元素（保留原 HTML 以便后续追加）
          const tableRegex = /<table[\s\S]*?<\/table>/gi;
          extractedTables = cleanHtml.match(tableRegex) || [];
          cleanHtml = cleanHtml.replace(tableRegex, "");
        } catch {
          cleanHtml = email.bodyHtml;
        }

        // 使用 turndown 转为 Markdown（此时表格已移除，CID 图片能正常处理）
        try {
          body = this.turndownService.turndown(cleanHtml);

          // 后处理：将 turndown 后的 ![](cid:xxx) 映射为 ![[attachments/xxx]]
          body = this.remapCidReferences(body, cidMap);

          // 后处理：将表格 HTML 追加到末尾（Obsidian 阅读模式可原生渲染）
          if (extractedTables.length > 0) {
            body += "\n\n---\n### 表格\n\n";
            for (const tableHtml of extractedTables) {
              body += "\n" + tableHtml + "\n";
            }
          }
        } catch (e) {
          // turndown 转换失败，降级：保留原始 HTML 作为代码块
          console.warn("PST Import: turndown conversion failed, falling back to raw HTML:", e);
          body = "```html\n" + cleanHtml + "\n```";
        }
      } else {
        // 纯文本：直接使用
        body = email.bodyText || email.bodyHtml;
      }
    } else {
      body = "*（无正文内容）*";
    }

    lines.push(body);
    lines.push("");

    // 附件列表
    if (email.attachments.length > 0) {
      lines.push("---");
      lines.push("## Attachments");
      lines.push("");
      for (const att of email.attachments) {
        const safeName = att.filename.replace(/[<>:"/\\|?*]/g, "_");
        const attLink = `attachments/${safeName}`;
        if (IMAGE_EXT_RE.test(att.filename)) {
          lines.push(`![[${attLink}]]`);
        } else {
          lines.push(`[[${attLink}]]`);
        }
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * 将正文中的 CID 图片引用映射为 Obsidian wikilink
   * 处理格式：
   *   ![](cid:xxx@yyy) → ![[attachments/filename]]
   *   <img src="cid:xxx"> → ![[attachments/filename]]
   *   ![[cid:xxx@yyy]] → ![[attachments/filename]]
   */
  private remapCidReferences(
    body: string,
    cidMap: Map<string, string>
  ): string {
    if (cidMap.size === 0) return body;

    // 1. 处理标准 Markdown 图片: ![alt](cid:xxx) 和 ![](cid:xxx)
    body = body.replace(
      /!\[([^\]]*)\]\(cid:([^)]+)\)/gi,
      (_match, alt: string, cid: string) => {
        const key = cid.trim().toLowerCase();
        const saved = cidMap.get(key);
        if (saved) {
          const altText = alt ? `|${alt}` : "";
          return `![[attachments/${saved}${altText}]]`;
        }
        console.log(`PST Import: CID not found: "${key}"`);
        return _match;
      }
    );

    // 2. 处理 HTML <img src="cid:xxx">（turndown 转换残留）
    body = body.replace(
      /<img[^>]*src=["']cid:([^"']+)["'][^>]*\/?>/gi,
      (_match: string, cid: string) => {
        const key = cid.trim().toLowerCase();
        const saved = cidMap.get(key);
        if (saved) return `![[attachments/${saved}]]`;
        return _match;
      }
    );

    // 3. 处理 wikilink 格式的 CID: ![[cid:xxx]]
    body = body.replace(
      /!\[\[cid:([^\]]+)\]\]/gi,
      (_match: string, cid: string) => {
        const key = cid.trim().toLowerCase();
        const saved = cidMap.get(key);
        if (saved) return `![[attachments/${saved}]]`;
        return _match;
      }
    );

    return body;
  }

  private formatDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  private sanitize(name: string, maxLen?: number): string {
    let s = name.replace(/[<>:"/\\|?*]/g, "_").replace(/\s+/g, " ").trim();
    if (maxLen && s.length > maxLen) s = s.slice(0, maxLen).trim();
    return s || "untitled";
  }

  private escapeYaml(val: string): string {
    return val.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }
}