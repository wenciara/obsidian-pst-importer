/**
 * PST Import — 增量同步状态管理
 *
 * 存储已导入邮件的指纹，用于增量同步时跳过已导入的邮件。
 * 状态通过 Obsidian plugin data 持久化。
 */

import type { SyncProfile, SyncState, SyncProfileState } from "./types";

const SYNC_STATE_KEY = "syncState";

export class SyncStateManager {
  private state: SyncState;
  private loadFn: () => Promise<Record<string, unknown> | null>;
  private saveFn: (data: Record<string, unknown>) => Promise<void>;

  private resolveProfileKey(profile: SyncProfile | string): string {
    return typeof profile === "string" ? profile : profile.id || profile.label;
  }

  private ensureProfileKey(profile: SyncProfile | string): string {
    const key = this.resolveProfileKey(profile);
    if (typeof profile !== "string" && key !== profile.label && this.state.profiles[profile.label] && !this.state.profiles[key]) {
      this.state.profiles[key] = this.state.profiles[profile.label];
      delete this.state.profiles[profile.label];
    }
    return key;
  }

  private ensureProfileState(profile: SyncProfile | string): SyncProfileState {
    const key = this.ensureProfileKey(profile);
    if (!this.state.profiles[key]) {
      this.state.profiles[key] = {
        lastSync: new Date().toISOString(),
        imported: [],
      };
    }
    return this.state.profiles[key];
  }

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
  getImportedSet(profile: SyncProfile | string): Set<string> {
    const key = this.ensureProfileKey(profile);
    const profileState = this.state.profiles[key];
    if (!profileState) return new Set();
    return new Set(profileState.imported);
  }

  /** 检查某封邮件是否已导入 */
  isImported(profile: SyncProfile | string, fingerprint: string): boolean {
    const key = this.ensureProfileKey(profile);
    const profileState = this.state.profiles[key];
    if (!profileState) return false;
    return profileState.imported.includes(fingerprint);
  }

  /** 标记一封邮件为已导入 */
  markImported(profile: SyncProfile | string, fingerprint: string): void {
    const profileState = this.ensureProfileState(profile);
    if (!profileState.imported.includes(fingerprint)) {
      profileState.imported.push(fingerprint);
    }
  }

  /** 批量标记已导入（用于把现有 PST 设为同步基线） */
  markImportedBatch(profile: SyncProfile | string, fingerprints: Iterable<string>): number {
    const profileState = this.ensureProfileState(profile);
    const importedSet = new Set(profileState.imported);
    let added = 0;

    for (const fingerprint of fingerprints) {
      if (importedSet.has(fingerprint)) continue;
      importedSet.add(fingerprint);
      profileState.imported.push(fingerprint);
      added++;
    }

    return added;
  }

  /** 更新 profile 的最后同步时间 */
  updateLastSync(profile: SyncProfile | string): void {
    const profileState = this.ensureProfileState(profile);
    profileState.lastSync = new Date().toISOString();
  }

  /** 获取 profile 状态 */
  getProfileState(profile: SyncProfile | string): SyncProfileState | undefined {
    const key = this.ensureProfileKey(profile);
    return this.state.profiles[key];
  }

  /** 删除 profile 的同步状态（用于重置） */
  deleteProfile(profile: SyncProfile | string): void {
    const key = this.resolveProfileKey(profile);
    delete this.state.profiles[key];

    if (typeof profile !== "string" && key !== profile.label) {
      delete this.state.profiles[profile.label];
    }
  }
}
