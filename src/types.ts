/**
 * PST Importer — 共有类型定义
 */

/** 一封邮件的标准化数据（两种引擎统一输出格式） */
export interface EmailData {
  subject: string;
  senderName: string;
  senderEmail: string;
  toList: string[];
  ccList: string[];
  bccList: string[];
  sentOn: Date | null;
  receivedOn: Date | null;
  bodyHtml: string;
  bodyText: string;
  categories: string;
  importance: number;
  attachments: AttachmentData[];
  folderPath: string;
  /** PST 文件夹中该邮件的 1-based 序号，用于排序 */
  index: number;
  /** 所在文件夹的邮件总数 */
  totalInFolder: number;
}

/** 附件数据 */
export interface AttachmentData {
  filename: string;
  contentId: string;      // 用于 CID 匹配的 Content-ID（inline 图片）
  mimeType: string;
  data: ArrayBuffer;
}

/** 进度事件 */
export interface ProgressEvent {
  type: "folder" | "email" | "attachment" | "complete" | "error";
  /** 当前进度（已处理数） */
  current?: number;
  /** 总数 */
  total?: number;
  /** 描述信息 */
  message: string;
  folderPath?: string;
  /** 当前邮件主题 */
  emailSubject?: string;
}

/** 导入选项 */
export interface ImportOptions {
  pstPath: string;
  outputVaultDir: string;      // vault 中的输出目录，如 "PST Import/MyArchive"
  tempDir: string;              // 系统临时目录（主引擎用）
  overwrite: boolean;
  mirrorSubfolders: boolean;    // 是否保留 PST 文件夹层级
}

/** 单个 PST 同步配置 */
export interface SyncProfile {
  /** 用户自定义的名称 */
  label: string;
  /** PST 文件绝对路径 */
  pstPath: string;
  /** vault 中的输出目录 */
  outputFolder: string;
  /** 要同步的文件夹路径列表（为空则全部同步） */
  selectedFolders: string[];
}

/** 已导入邮件的指纹记录（存储在 plugin data 中） */
export interface SyncState {
  /** profile label → 已导入邮件指纹集合 */
  profiles: Record<string, SyncProfileState>;
}

export interface SyncProfileState {
  /** 上次同步时间 (ISO string) */
  lastSync: string;
  /** 已导入邮件的指纹集合 */
  imported: string[];
}

/** 插件设置 */
export interface PstImporterSettings {
  outputBaseFolder: string;
  mirrorFolderStructure: boolean;
  overwriteExisting: boolean;
  includeYamlFrontmatter: boolean;
  /** 增量同步配置列表 */
  syncProfiles: SyncProfile[];
}

export const DEFAULT_SETTINGS: PstImporterSettings = {
  outputBaseFolder: "",
  mirrorFolderStructure: true,
  overwriteExisting: false,
  includeYamlFrontmatter: true,
  syncProfiles: [],
};

/** 引擎接口 — 所有 PST 解析引擎必须实现 */
export interface ExtractionEngine {
  readonly name: string;
  /** 检测本机环境是否支持此引擎 */
  canRun(): Promise<boolean>;
  /** 执行提取，通过 yield 逐封产出邮件数据 */
  extract(
    pstPath: string,
    onProgress: (p: ProgressEvent) => void,
    selectedFolders?: string[]  // 可选：只导入指定的文件夹路径列表
  ): AsyncGenerator<EmailData>;
}

/**
 * 生成邮件指纹：用于判断是否已导入过
 * 基于 sentOn + subject + senderEmail 的组合
 */
export function emailFingerprint(email: EmailData): string {
  const ts = email.sentOn ? email.sentOn.getTime().toString(36) : "0";
  const subj = (email.subject || "").trim().slice(0, 80);
  const sender = (email.senderEmail || "").trim().toLowerCase();
  return `${ts}|${subj}|${sender}|${email.index}`;
}