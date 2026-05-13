export interface ActivitySession {
  guildId: string;
  voiceChannelId: string;
  channelsUrl: string;
  source: string;
  activeChannelUrl: string;
  activeChannelName: string;
  activeUpdatedAt: string;
  updatedAt: string;
  activeMutationId: string;
  activeUpdatedBy: string;
}

export interface ActivityChannel {
  name: string;
  url: string;
  groupTitle: string;
  tvgId: string;
  tvgLogo: string;
}