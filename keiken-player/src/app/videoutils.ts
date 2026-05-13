import { RefObject } from 'react';
import { Video } from '@/types';
import { toast } from 'sonner';

export const handleSyncWithHost = (
  currentVideo: Video | null,
  currentHostVideoId: string | null,
  hostPlayingState: boolean,
  hostTime: number,
  playlist: Video[],
  playerRef: RefObject<any>,
  isPlaying: boolean,
  setCurrentVideo: (video: Video | null) => void,
  setCurrentTime: (time: number) => void,
  setPlaying: (playing: boolean) => void
) => {
  const hostVideoId = currentHostVideoId;
  const hostVideo = playlist.find((v) => v.id === hostVideoId);

  if (!hostVideo) {
    console.log("Host video not in playlist, cannot sync.");
    return;
  }

  const syncVideoAndSeek = () => {
    if (playerRef.current) {
      playerRef.current.seekTo(hostTime, 'seconds');
      setCurrentTime(hostTime);
      
      // Also sync playing state with host
      if (isPlaying !== hostPlayingState) {
        setPlaying(hostPlayingState);
      }
      
      toast.success("Synced with host", {
        description: "Playback synchronized with the host.",
      });
    }
  };

  if (!currentVideo || currentVideo.id !== hostVideoId) {
    setCurrentVideo(hostVideo);
    // Allow time for the player to load the new video before seeking
    setTimeout(syncVideoAndSeek, 500);
  } else {
    syncVideoAndSeek();
  }
};

export const handleForceSyncAll = (
  isHost: boolean,
  setForceSyncFlag: (cb: (prev: number) => number) => void
) => {
  if (isHost) {
    setForceSyncFlag(prev => prev + 1);
    toast.message("Force sync initiated", {
      description: "All viewers will sync to your current video and position.",
    });
  }
};

export const handlePause = (
  isHost: boolean,
  isPlaying: boolean,
  handlePlayPause: () => void,
  setHostPlayingState: (playing: boolean) => void
) => {
  if (isHost) {
    setHostPlayingState(!isPlaying);
  }
  handlePlayPause();
};

export const handleAddVideo = (
  video: Video,
  playlist: Video[],
  setPlaylist: (playlist: Video[]) => void,
  setCurrentHostVideoId: (id: string | null) => void
) => {
  setPlaylist([...playlist, video]);
  
  // If this is the first video, also set it as current
  if (playlist.length === 0) {
    setCurrentHostVideoId(video.id);
  }
  
  toast.message("Video added", {
    description: `"${video.title}" has been added to the playlist.`,
  });
};
