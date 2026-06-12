/**
 * PST Importer — Settings UI
 */

import { App, Modal, Notice, PluginSettingTab, Setting } from "obsidian";
import PstImporterPlugin from "./main";
import type { SyncProfile } from "./types";
import { FallbackEngine } from "./engines/fallback-engine";

function createSyncProfileId(): string {
  return `sync_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

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
      .setDesc("Default parent folder for one-time imports and new sync profiles. Existing profiles keep their own output folders.")
      .addText((text) =>
        text
          .setPlaceholder("PST Import")
          .setValue(this.plugin.settings.outputBaseFolder)
          .onChange(async (value) => {
            this.plugin.settings.outputBaseFolder = value.trim();
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
      const profileState = this.plugin.syncStateManager.getProfileState(profile);
      const desc = profileState
        ? `${profile.pstPath}\nOutput: ${profile.outputFolder}\nLast sync: ${new Date(profileState.lastSync).toLocaleString()} | ${profileState.imported.length} emails synced`
        : `${profile.pstPath}\nOutput: ${profile.outputFolder}\nNot yet synced`;

      new Setting(containerEl)
        .setName(profile.label)
        .setDesc(desc)
        .addButton((btn) => {
          btn.setButtonText("Sync now");
          btn.setCta();
          btn.onClick(() => {
            void this.plugin.startSync(profile);
          });
        })
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
            this.plugin.syncStateManager.deleteProfile(profile);
            await this.plugin.syncStateManager.save();
            await this.plugin.saveSettings();
            this.display();
          });
        });
    }

    new Setting(containerEl)
      .addButton((btn) => {
        btn.setButtonText("Sync configured PST");
        btn.onClick(() => {
          void this.plugin.startSync();
        });
      })
      .addButton((btn) => {
        btn.setButtonText("Add Sync Profile");
        btn.setCta();
        btn.onClick(() => {
          void this.addProfile();
        });
      });
  }

  private async addProfile(): Promise<void> {
    const pstPath = await this.choosePstFile();
    if (!pstPath) return;

    const defaultLabel = pstPath.replace(/^.*[\\/]/, "").replace(/\.pst$/i, "");
    const folders = await this.scanPstFolders(pstPath);
    if (!folders) return;

    const result = await this.openProfileModal({
      mode: "add",
      pstPath,
      initialLabel: defaultLabel,
      initialOutputFolder: this.plugin.getDefaultOutputFolder(defaultLabel),
      availableFolders: folders,
      initialSelectedFolders: folders,
    });
    if (!result) return;

    const profile: SyncProfile = {
      id: createSyncProfileId(),
      label: result.label,
      pstPath,
      outputFolder: result.outputFolder,
      selectedFolders: result.selectedFolders,
    };

    this.plugin.settings.syncProfiles.push(profile);
    await this.plugin.saveSettings();
    if (result.initializeBaseline) {
      await this.plugin.initializeSyncBaseline(profile);
    }
    this.display();
    new Notice(`Sync profile "${profile.label}" added.`);
  }

  private async editProfile(index: number): Promise<void> {
    const profile = this.plugin.settings.syncProfiles[index];
    if (!profile) return;

    const folders = await this.scanPstFolders(profile.pstPath);
    if (!folders) return;

    const validFolders = new Set(folders);
    const currentSelection = profile.selectedFolders.filter((folder) => validFolders.has(folder));
    const initialSelectedFolders = currentSelection.length > 0 || profile.selectedFolders.length === 0
      ? (currentSelection.length > 0 ? currentSelection : folders)
      : folders;

    const result = await this.openProfileModal({
      mode: "edit",
      pstPath: profile.pstPath,
      initialLabel: profile.label,
      initialOutputFolder: profile.outputFolder,
      availableFolders: folders,
      initialSelectedFolders,
    });
    if (!result) return;

    profile.label = result.label;
    profile.outputFolder = result.outputFolder;
    profile.selectedFolders = result.selectedFolders;

    await this.plugin.saveSettings();
    if (result.initializeBaseline) {
      await this.plugin.initializeSyncBaseline(profile);
    }
    this.display();
    new Notice(`Profile "${profile.label}" updated.`);
  }

  private async scanPstFolders(pstPath: string): Promise<string[] | null> {
    try {
      return FallbackEngine.scanPstFolders(pstPath);
    } catch (e) {
      new Notice(`Failed to scan PST: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  private openProfileModal(options: {
    mode: "add" | "edit";
    pstPath: string;
    initialLabel: string;
    initialOutputFolder: string;
    availableFolders: string[];
    initialSelectedFolders: string[];
  }): Promise<SyncProfileEditorResult | null> {
    return new Promise((resolve) => {
      const modal = new SyncProfileModal(this.app, options, (result) => {
        resolve(result);
      });
      modal.open();
    });
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

interface SyncProfileEditorResult {
  label: string;
  outputFolder: string;
  selectedFolders: string[];
  initializeBaseline: boolean;
}

class SyncProfileModal extends Modal {
  private readonly mode: "add" | "edit";
  private readonly pstPath: string;
  private readonly availableFolders: string[];
  private readonly callback: (result: SyncProfileEditorResult | null) => void;
  private labelValue: string;
  private outputFolderValue: string;
  private selectedFolders: string[];
  private initializeBaseline = false;
  private folderSummaryEl!: HTMLDivElement;

  constructor(
    app: App,
    options: {
      mode: "add" | "edit";
      pstPath: string;
      initialLabel: string;
      initialOutputFolder: string;
      availableFolders: string[];
      initialSelectedFolders: string[];
    },
    callback: (result: SyncProfileEditorResult | null) => void
  ) {
    super(app);
    this.mode = options.mode;
    this.pstPath = options.pstPath;
    this.availableFolders = options.availableFolders;
    this.callback = callback;
    this.labelValue = options.initialLabel;
    this.outputFolderValue = options.initialOutputFolder;
    this.selectedFolders = options.initialSelectedFolders;
  }

  private renderFolderSummary(): void {
    const selectedCount = this.selectedFolders.length;
    const totalCount = this.availableFolders.length;

    if (totalCount === 0) {
      this.folderSummaryEl.setText("No mail folders found in this PST.");
      return;
    }

    if (selectedCount === totalCount) {
      this.folderSummaryEl.setText(`Syncing all ${totalCount} folders.`);
      return;
    }

    this.folderSummaryEl.setText(`Syncing ${selectedCount} of ${totalCount} folders.`);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: this.mode === "add" ? "Add Sync Profile" : "Edit Sync Profile" });
    contentEl.createEl("p", { text: this.pstPath, cls: "setting-item-description" });

    new Setting(contentEl)
      .setName("Profile name")
      .setDesc("Shown in the sync list and command picker.")
      .addText((text) => {
        text.setValue(this.labelValue);
        text.onChange((value) => {
          this.labelValue = value;
        });
      });

    new Setting(contentEl)
      .setName("Output folder")
      .setDesc("Vault folder where synced emails will be written.")
      .addText((text) => {
        text.setValue(this.outputFolderValue);
        text.onChange((value) => {
          this.outputFolderValue = value;
        });
      });

    const folderSetting = new Setting(contentEl)
      .setName("Folders to sync")
      .setDesc("Choose which PST folders are included in incremental sync.");

    this.folderSummaryEl = folderSetting.descEl.createDiv({ cls: "setting-item-description" });
    this.renderFolderSummary();

    folderSetting.addButton((btn) => {
      btn.setButtonText("Choose folders");
      btn.onClick(() => {
        const modal = new SyncFolderSelectModal(
          this.app,
          this.availableFolders,
          this.selectedFolders,
          (result) => {
            if (!result) return;
            this.selectedFolders = result;
            this.renderFolderSummary();
          }
        );
        modal.open();
      });
    });

    new Setting(contentEl)
      .setName(this.mode === "add" ? "Treat current PST as already imported" : "Rebuild imported baseline")
      .setDesc(
        this.mode === "add"
          ? "Use this when you already imported the same PST manually and only want future syncs to bring in new mail. This scans the PST once without writing notes."
          : "Scan the current PST once and mark all current messages as already imported. Use this if you linked the profile to an archive that is already in your vault."
      )
      .addToggle((toggle) => {
        toggle.setValue(this.initializeBaseline);
        toggle.onChange((value) => {
          this.initializeBaseline = value;
        });
      });

    new Setting(contentEl)
      .addButton((btn) => {
        btn.setButtonText(this.mode === "add" ? "Add profile" : "Save changes");
        btn.setCta();
        btn.onClick(() => {
          const label = this.labelValue.trim();
          const outputFolder = this.outputFolderValue.trim();

          if (!label) {
            new Notice("Profile name cannot be empty.");
            return;
          }

          if (!outputFolder) {
            new Notice("Output folder cannot be empty.");
            return;
          }

          if (this.availableFolders.length > 0 && this.selectedFolders.length === 0) {
            new Notice("Select at least one folder to sync.");
            return;
          }

          this.callback({
            label,
            outputFolder,
            selectedFolders: this.selectedFolders,
            initializeBaseline: this.initializeBaseline,
          });
          this.close();
        });
      })
      .addButton((btn) => {
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

class SyncFolderSelectModal extends Modal {
  private readonly folders: string[];
  private readonly callback: (result: string[] | null) => void;
  private selected: Set<string>;
  private confirmBtn!: HTMLButtonElement;

  constructor(app: App, folders: string[], initialSelectedFolders: string[], callback: (result: string[] | null) => void) {
    super(app);
    this.folders = folders;
    this.callback = callback;
    this.selected = new Set(initialSelectedFolders);
  }

  private updateButtonText() {
    if (this.confirmBtn) {
      this.confirmBtn.textContent = `Use ${this.selected.size} folders`;
    }
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Choose folders to sync" });

    if (this.folders.length === 0) {
      contentEl.createEl("p", { text: "No mail folders were found in this PST." });
    } else {
      contentEl.createEl("p", { text: `${this.folders.length} folders found. Uncheck anything you do not want to sync.` });
    }

    const listEl = contentEl.createDiv({ cls: "pst-folder-select-list" });

    for (const folder of this.folders) {
      const item = listEl.createDiv({ cls: "pst-folder-item" });
      const checkbox = item.createEl("input", { type: "checkbox" });
      checkbox.checked = this.selected.has(folder);
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

    const buttonRow = contentEl.createDiv({ cls: "pst-folder-select-buttons" });
    const selectAllBtn = buttonRow.createEl("button", { text: "Select All" });
    selectAllBtn.addEventListener("click", () => {
      const checkboxes = listEl.querySelectorAll("input[type=checkbox]");
      checkboxes.forEach((checkbox) => {
        (checkbox as HTMLInputElement).checked = true;
      });
      this.selected = new Set(this.folders);
      this.updateButtonText();
    });

    const deselectAllBtn = buttonRow.createEl("button", { text: "Deselect All" });
    deselectAllBtn.addEventListener("click", () => {
      const checkboxes = listEl.querySelectorAll("input[type=checkbox]");
      checkboxes.forEach((checkbox) => {
        (checkbox as HTMLInputElement).checked = false;
      });
      this.selected.clear();
      this.updateButtonText();
    });

    contentEl.createEl("hr");

    new Setting(contentEl)
      .addButton((btn) => {
        this.confirmBtn = btn.buttonEl;
        btn.setButtonText(`Use ${this.selected.size} folders`);
        btn.setCta();
        btn.onClick(() => {
          this.callback(Array.from(this.selected));
          this.close();
        });
      })
      .addButton((btn) => {
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