/**
 * PST Importer — 后备引擎
 *
 * 使用 pst-extractor 纯 JavaScript 库解析 PST 文件。
 * 当 Outlook 未安装时作为降级方案。
 *
 * 注意：pst-extractor 不支持 > 2GB 的 PST 文件。
 */

import { AttachmentData, EmailData, ExtractionEngine, ProgressEvent } from "../types";

// pst-extractor 的类型声明
// 实际类型见 node_modules/pst-extractor/dist/
interface PSTFile {
  getRootFolder(): PSTFolder;
  close(): void;
}

interface PSTFolder {
  displayName: string;
  hasSubfolders: boolean;
  contentCount: number;
  emailCount: number;
  getSubFolders(): PSTFolder[];
  getNextChild(): PSTMessage | null;
  subFolderCount: number;
}

interface PSTAttachment {
  filename: string;
  longFilename: string;
  contentId: string;
  mimeTag: string;
  filesize: number;
  /** 文件数据流（需要读取） */
  fileInputStream: PSTNodeInputStream | null;
  attachMethod: number;
}

interface PSTNodeInputStream {
  read(output: Buffer): number;
}

interface PSTMessage {
  subject: string;
  senderName: string;
  senderEmailAddress: string;
  displayTo: string;
  displayCC: string;
  displayBCC: string;
  clientSubmitTime: Date | null;
  messageDeliveryTime: Date | null;
  body: string;
  bodyHTML: string;
  categories: string;
  importance: number;
  /** pst-extractor 用 numberOfAttachments getter + getAttachment(index) 访问附件 */
  numberOfAttachments: number;
  getAttachment(index: number): PSTAttachment;
  messageSize: number;
}

export class FallbackEngine implements ExtractionEngine {
  readonly name = "pst-extractor (JS)";

  /** 用户选择的文件夹路径列表，为空表示全部导入 */
  private selectedFolders?: Set<string>;

  /** 系统/非邮件文件夹名称（小写匹配），这些文件夹不会展示给用户选择 */
  private static readonly EXCLUDED_FOLDERS: Set<string> = new Set([
    // 中文 Outlook
    "联系人",
    "快速步骤设置",
    "对话历史记录",
    "同步问题",
    "日历",
    "任务",
    "笔记",
    "日记",
    "已删除邮件",
    "垃圾邮件",
    "该rss源当前不可用。",
    "rss feeds",
    "rss 订阅",
    // English Outlook
    "contacts",
    "quick step settings",
    "conversation history",
    "sync issues",
    "calendar",
    "tasks",
    "notes",
    "journal",
    "deleted items",
    "junk email",
    "junk e-mail",
    "conflicts",
    "local failures",
    "server failures",
    "suggested contacts",
    "recipient cache",
  ]);

  async canRun(): Promise<boolean> {
    // pst-extractor 已被 esbuild bundle 进 main.js
    // 直接可用，不需要额外检测
    return true;
  }

  /**
   * 扫描 PST 文件的邮件夹结构，返回实际有内容的邮件文件夹路径列表
   * （跳过 Root、"Outlook 数据文件的最上层" 等容器文件夹）
   */
  static scanPstFolders(pstPath: string): string[] {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports -- pst-extractor is loaded lazily to match Obsidian desktop runtime.
    const PSTExtractor = require("pst-extractor") as typeof import("pst-extractor");
    const pstFile = new PSTExtractor.PSTFile(pstPath) as PSTFile;
    try {
      const rootFolder = pstFile.getRootFolder();
      if (!rootFolder) return [];

      // 获取真实文件夹列表（跳过容器层），直接返回顶层路径
      const folders: string[] = [];
      const topLevel = FallbackEngine.getRealFolders(rootFolder, "");

      for (const { path: topPath, folder } of topLevel) {
        // 跳过系统文件夹
        if (FallbackEngine.isExcludedFolder(topPath)) continue;
        // 只添加有邮件内容的文件夹
        if (folder.contentCount > 0) {
          folders.push(topPath);
        }
        // 递归收集子文件夹，以 topPath 为父路径
        FallbackEngine.collectSubFolders(folder, topPath, folders);
      }

      return folders;
    } finally {
      pstFile.close();
    }
  }

  /** 检查文件夹名是否在排除列表中 */
  private static isExcludedFolder(folderPath: string): boolean {
    // 取路径的最后一段作为文件夹名
    const name = folderPath.split("/").pop() || folderPath;
    return FallbackEngine.EXCLUDED_FOLDERS.has(name.toLowerCase());
  }

  /**
   * 递归收集子文件夹路径（不重复顶层文件夹名）
   */
  private static collectSubFolders(
    folder: PSTFolder,
    parentPath: string,
    result: string[]
  ): void {
    if (!folder.hasSubfolders) return;
    const subs = folder.getSubFolders();
    for (const sub of subs) {
      const name = sub.displayName || "Unknown";
      const currentPath = `${parentPath}/${name}`;
      // 跳过系统文件夹
      if (FallbackEngine.isExcludedFolder(currentPath)) continue;
      // 只添加有邮件内容的文件夹
      if (sub.contentCount > 0) {
        result.push(currentPath);
      }
      // 继续递归子文件夹（即使父级为空，子级可能有内容）
      FallbackEngine.collectSubFolders(sub, currentPath, result);
    }
  }

  /**
   * 获取根目录下的真实邮件文件夹（跳过 Root 和 Outlook 数据文件的最上层）
   */
  private static getRealFolders(
    root: PSTFolder,
    parentPath: string
  ): Array<{ path: string; folder: PSTFolder }> {
    if (!root.hasSubfolders) return [];

    const topLevel: Array<{ path: string; folder: PSTFolder }> = [];
    const subs = root.getSubFolders();

    for (const sub of subs) {
      const name = sub.displayName || "Unknown";
      // 跳过容器文件夹（没有邮件、只有子文件夹的层）
      if (sub.contentCount === 0 && sub.hasSubfolders) {
        // 展开下一层
        const deeper = sub.getSubFolders();
        for (const d of deeper) {
          const dName = d.displayName || "Unknown";
          topLevel.push({ path: dName, folder: d });
        }
      } else {
        topLevel.push({ path: name, folder: sub });
      }
    }
    return topLevel;
  }

  /**
   * 递归收集有邮件的叶子文件夹路径
   */
  private static collectLeafFolders(
    parentPath: string,
    folder: PSTFolder,
    result: string[]
  ): void {
    const folderName = folder.displayName || "Unknown";
    const currentPath = parentPath
      ? `${parentPath}/${folderName}`
      : folderName;

    // 只有有邮件内容的文件夹才加入列表
    if (folder.contentCount > 0) {
      result.push(currentPath);
    }

    if (folder.hasSubfolders) {
      const subs = folder.getSubFolders();
      for (const sub of subs) {
        FallbackEngine.collectLeafFolders(currentPath, sub, result);
      }
    }
  }

  async *extract(
    pstPath: string,
    onProgress: (p: ProgressEvent) => void,
    selectedFolders?: string[]
  ): AsyncGenerator<EmailData> {
    console.log("PST Import: FallbackEngine.extract called with:", pstPath);
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports -- pst-extractor is loaded lazily to avoid early module resolution issues in bundled plugin runtime.
    const PSTExtractor = require("pst-extractor") as typeof import("pst-extractor");
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports -- use Node fs in desktop runtime without bundling polyfills.
    const fs_extra = require("fs") as typeof import("fs");

    // 检查文件大小
    const stat = fs_extra.statSync(pstPath);
    console.log("PST Import: file size:", stat.size);
    if (stat.size > 2 * 1024 * 1024 * 1024) {
      console.log("PST Import: file >2GB, attempting pst-extractor anyway (Unicode PST may work)...");
      onProgress({
        type: "folder",
        message: "文件超过 2GB，尝试直接读取...",
      });
    }

    onProgress({
      type: "folder",
      message: "正在读取 PST 文件...",
    });

    console.log("PST Import: opening PST file...");
    const pstFile = new PSTExtractor.PSTFile(pstPath) as PSTFile;
    console.log("PST Import: PST file opened successfully");

    // 保存用户选择的文件夹列表（小写化以便不区分大小写匹配）
    this.selectedFolders = selectedFolders
      ? new Set(selectedFolders.map((p) => p.toLowerCase()))
      : undefined;

    try {
      console.log("PST Import: getting root folder...");
      const rootFolder = pstFile.getRootFolder() as PSTFolder | null;
      console.log("PST Import: root folder:", rootFolder?.displayName);
      if (!rootFolder) {
        throw new Error("Could not read PST root folder");
      }

      // 使用与 scanPstFolders 完全相同的逻辑来构建文件夹列表
      const allFolders: Array<{ path: string; folder: PSTFolder }> =
        FallbackEngine.getRealFolders(rootFolder, "");

      console.log("PST Import: all folders from getRealFolders:");
      for (const f of allFolders) {
        console.log(`  path="${f.path}" hasSubfolders=${f.folder.hasSubfolders} contentCount=${f.folder.contentCount}`);
      }

      // 如果有 selectedFolders，找出所有需要处理的顶层文件夹
      // 策略：用户选了"收件箱" → 处理"收件箱"及其所有子文件夹
      //      用户选了"收件箱/项目子文件夹" → 只处理那个子文件夹
      const foldersToProcess: Array<{ path: string; folder: PSTFolder }> = [];
      if (this.selectedFolders) {
        // 收集所有文件夹路径（含子文件夹），以便匹配用户选择
        const allPaths: Map<string, PSTFolder> = new Map();
        const collectAllPaths = (folders: Array<{ path: string; folder: PSTFolder }>) => {
          for (const f of folders) {
            allPaths.set(f.path.toLowerCase(), f.folder);
            // 收集子文件夹路径
            if (f.folder.hasSubfolders) {
              const subs = f.folder.getSubFolders();
              const subEntries: Array<{ path: string; folder: PSTFolder }> = [];
              for (const sub of subs) {
                const subPath = `${f.path}/${sub.displayName || "Unknown"}`;
                subEntries.push({ path: subPath, folder: sub });
              }
              collectAllPaths(subEntries);
            }
          }
        };
        collectAllPaths(allFolders);

        console.log("PST Import: allPaths from collectAllPaths:");
        for (const [p] of allPaths) {
          console.log(`  "${p}"`);
        }
        console.log("PST Import: selectedFolders:", Array.from(this.selectedFolders));

        // 对每个用户选择的路径，找到对应文件夹
        const rawSelected: Array<{ path: string; folder: PSTFolder }> = [];
        for (const selPath of this.selectedFolders) {
          const folder = allPaths.get(selPath);
          if (folder) {
            rawSelected.push({ path: selPath, folder });
          }
        }

        // 去掉"祖先已在集合中"的子路径，避免 processFolderRecursive 重复处理
        // 例：同时选了"收件箱"和"收件箱/项目子文件夹" → 只保留"收件箱"，递归会覆盖子文件夹
        const selectedPathSet = new Set(rawSelected.map((f) => f.path));
        for (const entry of rawSelected) {
          // 检查是否存在某个祖先路径也在集合中
          const hasSelectedAncestor = entry.path
            .split("/")
            .slice(0, -1) // 逐级父路径
            .reduce<string[]>((ancestors, part, i, parts) => {
              ancestors.push(parts.slice(0, i + 1).join("/"));
              return ancestors;
            }, [])
            .some((ancestor) => selectedPathSet.has(ancestor));

          if (!hasSelectedAncestor) {
            foldersToProcess.push(entry);
            console.log(`PST Import: matched selected "${entry.path}" (top-level entry)`);
          } else {
            console.log(`PST Import: skipped "${entry.path}" (ancestor already selected)`);
          }
        }
      } else {
        // 未选择 → 全部处理
        foldersToProcess.push(...allFolders);
      }

      console.log(`PST Import: foldersToProcess count = ${foldersToProcess.length}`);
      for (const fp of foldersToProcess) {
        console.log(`PST Import: processing "${fp.path}"`);

        // 处理该文件夹及其所有子文件夹
        const processed = this.processFolderRecursive(fp.folder, fp.path, onProgress);
        for await (const email of processed) {
          yield email;
        }
      }
    } finally {
      pstFile.close();
    }
  }

  /**
   * 递归处理文件夹及其所有子文件夹，产出邮件
   * 路径格式与 scanPstFolders 完全一致
   */
  private async *processFolderRecursive(
    folder: PSTFolder,
    currentPath: string,
    onProgress: (p: ProgressEvent) => void
  ): AsyncGenerator<EmailData> {
    onProgress({
      type: "folder",
      message: `正在处理文件夹: ${currentPath}`,
      folderPath: currentPath,
    });

    // pst-extractor 使用游标式 API：contentCount 是 getter 属性
    const totalItems = folder.contentCount;
    let processed = 0;

    if (totalItems > 0) {
      // 使用 getNextChild() 逐个读取邮件
      let msg = folder.getNextChild();
      while (msg !== null) {
        processed++;

        onProgress({
          type: "email",
          current: processed,
          total: totalItems,
          message: `正在提取: ${msg.subject || "No Subject"}`,
          emailSubject: msg.subject,
        });

        // 提取附件
        const attachments: AttachmentData[] = this.extractAttachments(msg);

        // 解析收件人列表
        const toList = this.splitRecipients(msg.displayTo);
        const ccList = this.splitRecipients(msg.displayCC);
        const bccList = this.splitRecipients(msg.displayBCC);

        // 解析 bodyHTML
        let bodyHtml = msg.bodyHTML || "";
        if (
          !bodyHtml.includes("<") &&
          msg.body &&
          msg.body.includes("<")
        ) {
          bodyHtml = msg.body;
        }

        yield {
          subject: msg.subject || "",
          senderName: msg.senderName || "",
          senderEmail: msg.senderEmailAddress || "",
          toList,
          ccList,
          bccList,
          sentOn: msg.clientSubmitTime || null,
          receivedOn: msg.messageDeliveryTime || null,
          bodyHtml,
          bodyText: msg.body || "",
          categories: msg.categories || "",
          importance: msg.importance || 0,
          attachments,
          folderPath: currentPath,
          index: processed,
          totalInFolder: totalItems,
        };

        msg = folder.getNextChild();
      }
    }

    // 处理子文件夹
    if (folder.hasSubfolders) {
      const subFolders = folder.getSubFolders();
      for (const sub of subFolders) {
        const name = sub.displayName || "Unknown";
        const subPath = `${currentPath}/${name}`;
        yield* this.processFolderRecursive(sub, subPath, onProgress);
      }
    }
  }

  private extractAttachments(msg: PSTMessage): AttachmentData[] {
    const count = msg.numberOfAttachments;
    if (count === 0) {
      return [];
    }

    console.log("PST Import: processing", count, "attachments for:", msg.subject?.substring(0, 40));
    const result: AttachmentData[] = [];

    for (let i = 0; i < count; i++) {
      try {
        const att = msg.getAttachment(i);
        const filename = att.longFilename || att.filename || `attachment_${i + 1}`;
        const contentId = att.contentId || "";

        console.log(`PST Import: attachment #${i}="${filename}" cid="${contentId}" size=${att.filesize}`);

        // 通过 fileInputStream 读取附件数据
        // PSTNodeInputStream.read(output) 接收 Buffer 并返回读取的字节数
        let data: ArrayBuffer;
        const stream = att.fileInputStream;
        if (stream) {
          try {
            const fileSize = att.filesize;
            if (fileSize > 0) {
              // 创建一个足够大的 Buffer
              const buffer = Buffer.alloc(fileSize);
              const bytesRead = stream.read(buffer);
              if (bytesRead && bytesRead > 0) {
                // 只取实际读取的部分（可能小于 fileSize）
                const actualBuffer = bytesRead === fileSize ? buffer : buffer.subarray(0, bytesRead);
                const bytes = Uint8Array.from(actualBuffer);
                data = bytes.buffer;
                console.log(`PST Import:   read ${bytesRead} bytes`);
              } else {
                data = new ArrayBuffer(0);
              }
            } else {
              data = new ArrayBuffer(0);
            }
          } catch (streamErr) {
            console.error("PST Import:   stream read error:", streamErr);
            data = new ArrayBuffer(0);
          }
        } else {
          data = new ArrayBuffer(0);
        }

        result.push({
          filename,
          contentId,
          mimeType: att.mimeTag || "application/octet-stream",
          data,
        });
      } catch (e) {
        console.error("PST Import: attachment #" + i + " error:", e);
        continue;
      }
    }

    return result;
  }

  /**
   * 拆分收件人字符串为数组
   * 常见分隔符: "; " 或 ", "
   */
  private splitRecipients(recipients: string): string[] {
    if (!recipients) return [];
    return recipients
      .split(/[;,]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
}