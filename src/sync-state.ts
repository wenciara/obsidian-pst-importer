/**
 * PST Import — 增量同步状态管理
 *
 * 存储已导入邮件的指纹，用于增量同步时跳过已导入的邮件。
 * 状态通过 Obsidian plugin data 持久化。
 */

import type { SyncState, SyncProfileState } from "./types";

const SYNC_STATE_KEY = "syncState";

export class SyncStateManager {
  private state: SyncState;
  private loadFn: () => Promise<Record<string, unknown> | null>;
  private saveFn: (data: Record<string, unknown>) => Promise<void>;

  constructor(
    loadFn: () => Promise<Record<string, unknown> | null>,
    saveFn: (data: Record<string, unknown>) => Promise<void>
  ) {
    this.loadFn = loadFn;
    this.saveFn = saveFn;
    this.state = { profiles: {} };
  }

  async load(): Promise<void> {
    const data = await this.loadFn();
    if (data && data[SYNC_STATE_KEY]) {
      this.state = data[SYNC_STATE_KEY] as SyncState;
    } else {
      this.state = { profiles: {} };
    }
  }

  async save(): Promise<void> {
    const data = (await this.loadFn()) || {};
    data[SYNC_STATE_KEY] = this.state;
    await this.saveFn(data);
  }

  /** 获取某个 profile 的已导入指纹集合 */
  getImportedSet(profileLabel: string): Set<string> {
    const profileState = this.state.profiles[profileLabel];
    if (!profileState) return new Set();
    return new Set(profileState.imported);
  }

  /** 检查某封邮件是否已导入 */
  isImported(profileLabel: string, fingerprint: string): boolean {
    const profileState = this.state.profiles[profileLabel];
    if (!profileState) return false;
    return profileState.imported.includes(fingerprint);
  }

  /** 标记一封邮件为已导入 */
  markImported(profileLabel: string, fingerprint: string): void {
    if (!this.state.profiles[profileLabel]) {
      this.state.profiles[profileLabel] = {
        lastSync: new Date().toISOString(),
        imported: [],
      };
    }
    this.state.profiles[profileLabel].imported.push(fingerprint);
  }

  /** 更新 profile 的最后同步时间 */
  updateLastSync(profileLabel: string): void {
    if (!this.state.profiles[profileLabel]) {
      this.state.profiles[profileLabel] = {
        lastSync: new Date().toISOString(),
        imported: [],
      };
    }
    this.state.profiles[profileLabel].lastSync = new Date().toISOString();
  }

  /** 获取 profile 状态 */
  getProfileState(profileLabel: string): SyncProfileState | undefined {
    return this.state.profiles[profileLabel];
  }

  /** 删除 profile 的同步状态（用于重置） */
  deleteProfile(profileLabel: string): void {
    delete this.state.profiles[profileLabel];
  }
}
