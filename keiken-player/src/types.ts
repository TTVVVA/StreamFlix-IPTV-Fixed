// types.ts
// Add these to your existing types file
export interface QualityLevel {
  value: number;
  label: string;
}

// Video interface represents a video object in the playlist
export interface Video {
  id: string;
  title: string;
  duration: string;
  url: string;
  group?: string;
  referral?: string;
  addedBy?: string;
}

export interface Channel {
  name: string;
  url: string;
  group: string;
  extinf?: string;
}

// DiscordSdkState represents the state returned by the useDiscordSdk hook
export interface DiscordSdkState {
  accessToken: string | null;
  authenticated: boolean;
  discordSdk: {
    channelId: string;
  };
  error: string | null;
  session: {
    user: {
      username: string;
    };
  } | null;
  status: string;
}

// SyncStateHook represents the return type of the useSyncState hook
export type SyncStateHook<T> = [T, (value: T) => void];

// PlayerRef represents the ref object for the ReactPlayer component
export interface PlayerRef {
  getCurrentTime: () => number;
  seekTo: (amount: number, type: 'seconds' | 'fraction') => void;
}

// ToastOptions represents the options for displaying a toast notification
export interface ToastOptions {
  description?: string;
}

// Function types for various event handlers
export type HandlePlayPause = () => void;
export type HandleVolumeToggle = () => void;
export type HandleSeek = (value: number[]) => void;
export type JumpToHostTime = () => void;
export type HandleForceSyncAll = () => void;
export type HandleDeleteVideo = (videoId: string) => void;
export type AddVideoToPlaylist = () => Promise<void>;
export type HandleVideoSelect = (video: Video) => void;
export type ToggleSyncPlayback = (value: boolean) => void;
export type FormatTime = (seconds: number) => string;