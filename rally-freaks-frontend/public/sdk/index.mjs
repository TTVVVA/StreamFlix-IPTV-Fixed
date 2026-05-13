// Rally Freaks Discord SDK entrypoint, no build tool.
// It dynamically loads the official SDK so app.js can still boot and show diagnostics if the CDN/import fails.
// Production CDN-free option: replace SDK_IMPORT_URL with your vendored @discord/embedded-app-sdk module.
const SDK_IMPORT_URL = "https://esm.sh/@discord/embedded-app-sdk?bundle";

export class DiscordSDK {
  constructor(clientId, options) {
    this.clientId = clientId;
    this.options = options;
    this._sdk = null;
    this._sdkPromise = import(SDK_IMPORT_URL).then((mod) => {
      if (!mod.DiscordSDK) throw new Error("DiscordSDK export not found");
      this._sdk = new mod.DiscordSDK(clientId, options);
      return this._sdk;
    });
  }

  get guildId() {
    return this._sdk?.guildId || this._sdk?.guild_id || "";
  }

  get channelId() {
    return this._sdk?.channelId || this._sdk?.channel_id || "";
  }

  async ready() {
    const sdk = await this._sdkPromise;
    const result = await sdk.ready();
    return result;
  }

  async commands() {
    const sdk = await this._sdkPromise;
    return sdk.commands;
  }
}
