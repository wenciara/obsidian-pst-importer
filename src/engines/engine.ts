/**
 * PST Importer — 引擎接口
 *
 * 所有 PST 解析引擎必须实现 ExtractionEngine 接口。
 * 当前支持：
 *   - PrimaryEngine: 通过 Python .exe 调用 Outlook MAPI
 *   - FallbackEngine: 通过 pst-extractor 纯 JS 解析
 */

export type { ExtractionEngine } from "../types";