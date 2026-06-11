/**
 * PST Importer — 设置界面
 */

import { App, PluginSettingTab, Setting } from "obsidian";
import PstImporterPlugin from "./main";

export class PstImporterSettingTab extends PluginSettingTab {
  plugin: PstImporterPlugin;

  constructor(app: App, plugin: PstImporterPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setHeading().setName("PST Import 设置");

    new Setting(containerEl)
      .setName("输出基目录")
      .setDesc("导入的邮件将存放在 vault 中的此目录下")
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
      .setName("保留 PST 文件夹层级")
      .setDesc("开启后，收件箱中的子文件夹会创建为子目录")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.mirrorFolderStructure)
          .onChange(async (value) => {
            this.plugin.settings.mirrorFolderStructure = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("覆盖已有文件")
      .setDesc("导入同名邮件时是否覆盖已有的 Markdown 文件")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.overwriteExisting)
          .onChange(async (value) => {
            this.plugin.settings.overwriteExisting = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("生成 YAML 头部元数据")
      .setDesc("每封邮件顶部添加发件人、收件人、时间等元数据")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.includeYamlFrontmatter)
          .onChange(async (value) => {
            this.plugin.settings.includeYamlFrontmatter = value;
            await this.plugin.saveSettings();
          })
      );

  }
}