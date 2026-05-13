import { Video } from '@/types';
import React, { useRef, useEffect, useState } from 'react';
import ReactPlayer from 'react-player'
import Hls from 'hls.js';

interface VideoPlayerProps {
  currentVideo: Video | null;
  isPlaying: boolean;
  volume: number;
  isMuted: boolean;
  onPlay: () => void;
  onPause: () => void;
  onProgress: (progress: any) => void;
  onDuration: (duration: number) => void;
  playerRef: React.MutableRefObject<ReactPlayer | null>;
  onQualityLevelsChange?: (levels: { value: number; label: string }[]) => void;
  onCurrentQualityChange?: (quality: number) => void;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  currentVideo,
  isPlaying,
  volume,
  isMuted,
  onPlay,
  onPause,
  onProgress,
  onDuration,
  playerRef,
  onQualityLevelsChange,
  onCurrentQualityChange,
}) => {
  const onAttachQualityHooks = () => {
    console.log('Player ready, Init HLS Quality Control');
    const internalPlayer = playerRef.current?.getInternalPlayer('hls') as Hls;
    if (!internalPlayer) {
      console.error('HLS player not found, Are you sure the video is HLS?');
      return;
    }
    
    // First turn off any existing listeners
    internalPlayer.off(Hls.Events.MANIFEST_PARSED);
    internalPlayer.off(Hls.Events.LEVEL_SWITCHED);

    const levels = internalPlayer.levels || [];
    if (levels.length > 0 && onQualityLevelsChange) {
      console.log('Quality levels found:', levels);
      const formattedLevels = levels.map((level, index) => ({
        value: index,
        label: `${level.height}p${level.name ? ` (${level.name})` : ''}`,
      }));
      
      // Add auto option
      formattedLevels.unshift({ value: -1, label: 'Auto' });
      
      onQualityLevelsChange(formattedLevels);
    }

    internalPlayer.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
      console.log('Quality changed:', data.level);
      if (onCurrentQualityChange) {
        onCurrentQualityChange(data.level);
      }
    });
  };

  return (
    <div className="flex items-center justify-center w-full h-full">
      <div className="relative" style={{ aspectRatio: '16/9' }}>
        <ReactPlayer
          ref={playerRef}
          url={currentVideo?.url}
          width="100%"
          height="100%"
          playing={isPlaying}
          volume={isMuted ? 0 : volume / 100}
          muted={isMuted}
          onPlay={onPlay}
          onPause={onPause}
          onProgress={onProgress}
          onDuration={onDuration}
          onReady={onAttachQualityHooks}
          config={{
            file: {
              forceHLS: true,
              hlsOptions: {
                enableWorker: true,
                autoStartLoad: true,
                lowLatencyMode: true,
                backBufferLength: 30,
                maxBufferLength: 15,
                maxMaxBufferLength: 30,
                liveSyncDurationCount: 3,
                liveMaxLatencyDurationCount: 6,
                manifestLoadingTimeOut: 20000,
                fragLoadingTimeOut: 30000,
                levelLoadingTimeOut: 20000,
                enableSoftwareAES: true,
                xhrSetup: (xhr: XMLHttpRequest) => {
                  xhr.withCredentials = false;
                }
              },
              attributes: {
                style: { width: '100%', height: '100%', objectFit: 'contain' },
              },
            },
          }}
        />
      </div>
    </div>
  );
};
