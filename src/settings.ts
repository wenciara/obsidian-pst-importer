/**
 * PST Importer — Settings UI
 */

import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import PstImporterPlugin from "./main";
import type { SyncProfile } from "./types";
import { FallbackEngine } from "./engines/fallback-engine";

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

export class PstImporterSettingTab extends PluginSettingTab {
  plugin: PstImporterPlugin;

  constructor(app: App, plugin: PstImporterPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // === General Settings ===
    new Setting(containerEl).setHeading().setName("General Settings");

    new Setting(containerEl)
      .setName("Output base folder")
      .setDesc("Imported emails will be placed in this vault folder")
      .addText((text) =>
        text
          .setPlaceholder("PST Import")
          .setValue(this.plugin.settings.outputBaseFolder)
          .onChange(async (value) => {
            this.plugin.settings.outputBaseFolder = value || "PST Import";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Mirror PST folder structure")
      .setDesc("When enabled, subfolders in the PST will be created as subdirectories")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.mirrorFolderStructure)
          .onChange(async (value) => {
            this.plugin.settings.mirrorFolderStructure = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Overwrite existing files")
      .setDesc("Whether to overwrite existing Markdown files when importing emails with the same name")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.overwriteExisting)
          .onChange(async (value) => {
            this.plugin.settings.overwriteExisting = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Include YAML frontmatter")
      .setDesc("Add sender, recipients, date and other metadata at the top of each email")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.includeYamlFrontmatter)
          .onChange(async (value) => {
            this.plugin.settings.includeYamlFrontmatter = value;
            await this.plugin.saveSettings();
          })
      );

    // === Sync Profiles ===
    new Setting(containerEl).setHeading().setName("Incremental Sync Profiles");

    const profiles = this.plugin.settings.syncProfiles;

    if (profiles.length === 0) {
      containerEl.createEl("p", {
        text: "No sync profiles configured. Add a profile to enable incremental sync.",
        cls: "setting-item-description",
      });
    }

    for (let i = 0; i < profiles.length; i++) {
      const profile = profiles[i];
      const profileState = this.plugin.syncStateManager.getProfileState(profile.label);
      const desc = profileState
        ? `${profile.pstPath}\nLast sync: ${new Date(profileState.lastSync).toLocaleString()} | ${profileState.imported.length} emails synced`
        : `${profile.pstPath}\nNot yet synced`;

      new Setting(containerEl)
        .setName(profile.label)
        .setDesc(desc)
        .addButton((btn) => {
          btn.setButtonText("Edit");
          btn.onClick(() => {
            void this.editProfile(i);
          });
        })
        .addButton((btn) => {
          btn.setButtonText("Delete");
          btn.setWarning();
          btn.onClick(async () => {
            profiles.splice(i, 1);
            this.plugin.syncStateManager.deleteProfile(profile.label);
            await this.plugin.syncStateManager.save();
            await this.plugin.saveSettings();
            this.display();
          });
        });
    }

    new Setting(containerEl).addButton((btn) => {
      btn.setButtonText("Add Sync Profile");
      btn.setCta();
      btn.onClick(() => {
        void this.addProfile();
      });
    });
  }

  private async addProfile(): Promise<void> {
    // Pick PST file
    const pstPath = await this.choosePstFile();
    if (!pstPath) return;

    // Default label from filename
    const defaultLabel = pstPath.replace(/^.*[\\/]/, "").replace(/\.pst$/i, "");

    // Scan folders
    let folders: string[] = [];
    try {
      folders = FallbackEngine.scanPstFolders(pstPath);
    } catch (e) {
      new Notice(`Failed to scan PST: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    const profile: SyncProfile = {
      label: defaultLabel,
      pstPath,
      outputFolder: defaultLabel,
      selectedFolders: folders,
    };

    this.plugin.settings.syncProfiles.push(profile);
    await this.plugin.saveSettings();
    this.display();
    new Notice(`Sync profile "${defaultLabel}" added. Use "Sync configured PST" command to sync.`);
  }

  private async editProfile(index: number): Promise<void> {
    const profile = this.plugin.settings.syncProfiles[index];
    if (!profile) return;

    // Re-scan folders from PST
    let folders: string[] = [];
    try {
      folders = FallbackEngine.scanPstFolders(profile.pstPath);
    } catch (e) {
      new Notice(`Failed to scan PST: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    // Update available folders (keep existing selection if still valid)
    const validFolders = new Set(folders);
    profile.selectedFolders = profile.selectedFolders.filter((f) => validFolders.has(f));
    if (profile.selectedFolders.length === 0) {
      profile.selectedFolders = folders;
    }

    await this.plugin.saveSettings();
    this.display();
    new Notice(`Profile "${profile.label}" refreshed: ${folders.length} folders available.`);
  }

  private async choosePstFile(): Promise<string | null> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports -- Obsidian runs in Electron
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
    } catch {
      // Electron dialog unavailable
    }
    new Notice("File dialog unavailable. Please enter the PST path manually.");
    return null;
  }
}