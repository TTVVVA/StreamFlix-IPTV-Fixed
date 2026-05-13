import React, { useEffect, useState, useMemo } from 'react';
import { useDiscordSdk } from '../hooks/useDiscordSdk';
import { useSyncState } from '@robojs/sync';
import { useVideoPlayer } from '../hooks/useVideoPlayer';
import { VideoPlayer } from '@/components/custom/VideoPlayer';
import { Controls } from '@/components/custom/Control';
import { Playlist } from '@/components/custom/Playlist';
import { Video } from '@/types';
import { toast } from 'sonner';
import { nanoid } from 'nanoid';
import { handleSyncWithHost, handleForceSyncAll, handlePause, handleAddVideo } from './videoutils';
import { usePrevious } from '@/lib/utils';

export const Activity = () => {
  const { accessToken, authenticated, discordSdk, error, session, status } = useDiscordSdk();
  const currentUserId = session?.user.username;
  const channelId = discordSdk.channelId;

  const [hostId, setHostId] = useSyncState<string | null>(null, ['host', channelId]);
  const [currentHostVideoId, setCurrentHostVideoId] = useSyncState<string | null>(null, ['video', 'current', channelId]);
  const [hostTime, setHostTime] = useSyncState(0, ['video', 'time', channelId]);
  const [forceSyncFlag, setForceSyncFlag] = useSyncState(0, ['video', 'force-sync', channelId]);
  const [hostPlayingState, setHostPlayingState] = useSyncState<boolean>(false, ['video', 'playing', channelId]);
  const [playlist, setPlaylist] = useSyncState<Video[]>([], ['playlist', channelId]);
  const [showControls, setShowControls] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);

  // Carregar canais IPTV da sessão
  useEffect(() => {
    const loadIptv = async () => {
      if (!authenticated || !discordSdk.guildId || !channelId) return;
      
      try {
        setIsInitializing(true);
        // 1. Obter ou criar sessão
        const sessionResp = await fetch(`/api/activity/session?guildId=${discordSdk.guildId}&voiceChannelId=${channelId}`);
        const sessionData = await sessionResp.json();
        
        if (sessionData.ok && sessionData.session.channelsUrl) {
          // 2. Carregar canais da M3U
          const channelsResp = await fetch(`/api/activity/channels?url=${encodeURIComponent(sessionData.session.channelsUrl)}`);
          const channelsData = await channelsResp.json();
          
          if (channelsData.ok && channelsData.channels.length > 0) {
            const workerProxyUrl = 'https://botdiscord-activity-session.benficasempretv20260311.workers.dev/?url=';
            
            const mappedVideos: Video[] = channelsData.channels.map((ch: any) => ({
              id: nanoid(),
              title: ch.name,
              url: `${workerProxyUrl}${encodeURIComponent(ch.url)}`,
              group: ch.group || 'Geral',
              logo: ch.logo || '',
              duration: 'LIVE'
            }));
            
            // Apenas definir playlist se estiver vazia (para não sobrescrever sync)
            if (playlist.length === 0) {
              setPlaylist(mappedVideos);
              if (isHost && !currentHostVideoId) {
                setCurrentHostVideoId(mappedVideos[0].id);
              }
            }
          }
        }
      } catch (err) {
        console.error('Erro ao carregar IPTV:', err);
        toast.error('Erro ao carregar lista de canais');
      } finally {
        setIsInitializing(false);
      }
    };
    
    loadIptv();
  }, [authenticated, discordSdk.guildId, channelId]);
  
  // Have some previous values as well (it really helps)
  const prevHostTime = usePrevious(hostTime);
  const prevHostPlayingState = usePrevious(hostPlayingState);
  const prevCurrentHostVideoId = usePrevious(currentHostVideoId);

  const isHost = currentUserId === hostId;

  const {
    currentVideo,
    isPlaying,
    currentTime,
    duration,
    volume,
    isMuted,
    playerRef,
    qualityLevels,
    currentQuality,
    setPlaying,
    setCurrentTime,
    setDuration,
    setVolume,
    handlePlayPause,
    handleVolumeToggle,
    handleSeek,
    setQualityLevels,
    setCurrentQuality,
    handleQualityChange,
    setCurrentVideo,
  } = useVideoPlayer();

  const isOutOfSync = useMemo(() => {
    return !isHost && Math.abs(currentTime - hostTime) > 3;
  }, [isHost, currentTime, hostTime]);

  useEffect(() => {
    if (!currentUserId) return;
    if (!hostId && currentUserId) {
      setHostId(currentUserId);
    }
  }, [currentUserId, hostId]);

  const syncWithHost = () => {
    handleSyncWithHost(
      currentVideo,
      currentHostVideoId,
      hostPlayingState,
      hostTime,
      playlist,
      playerRef,
      isPlaying,
      setCurrentVideo,
      setCurrentTime,
      setPlaying
    );
  };

  useEffect(() => {
    if (!isHost && forceSyncFlag > 0) {
      syncWithHost();
      toast.success("Synced with host. Your playback has been synchronized with the host.");
    }
  }, [forceSyncFlag]);

  // First time playing!
  useEffect(() => {
    if (playlist.length > 0 && !currentVideo) {
      setCurrentVideo(
        playlist.find(v => v.id === currentHostVideoId) || playlist[0]
      );
    }
  }, [playlist, currentVideo, currentHostVideoId, setCurrentVideo]);

  // Identical / Auto Sync (Only when client is already in sync)
  useEffect(() => {
    if (isHost) return;
    if (!currentVideo) return;

    // if not same video, then pass
    if (prevCurrentHostVideoId !== currentVideo?.id) {
      return;
    }
    // If host only jumped by less than 3 seconds then do not sync
    if (Math.abs(hostTime - (prevHostTime ?? 0)) < 3 && hostPlayingState === prevHostPlayingState) {
      return;
    }
    // if time diff greater than 3 seconds, then pass (between host jump and client sync)
    if (Math.abs(currentTime - (prevHostTime ?? 0)) > 3) {
      return;
    }
    // if not at same playing state, then pass
    if (isPlaying !== prevHostPlayingState) {
      return;
    }

    // If I am still here, it means client is closely following host, therefore once again sync
    syncWithHost();
    // console.log('Auto Synced');

    // currentVideo, currentTime, isPlaying, 
  }, [isHost, currentHostVideoId, hostTime, hostPlayingState, syncWithHost]);

  const forceSyncAll = () => {
    handleForceSyncAll(isHost, setForceSyncFlag);
  };

  const pauseHandler = () => {
    handlePause(isHost, isPlaying, handlePlayPause, setHostPlayingState);
  };

  const addVideoHandler = (video: Video) => {
    handleAddVideo(video, playlist, setPlaylist, setCurrentHostVideoId);
  };

  function onVideoSelectHandler(video: Video): void {
    // If host, then set the video for everyone
    if (isHost) {
      setCurrentHostVideoId(video.id);
      setHostTime(0);
      setHostPlayingState(false);
      setForceSyncFlag(prev => prev + 1);
    }
    setCurrentVideo(video);
  }

  return (
    <div
      className="relative w-screen h-screen bg-black overflow-hidden"
      onMouseMove={() => setShowControls(true)}
      onMouseLeave={() => setShowControls(false)}
      onClick={() => setShowControls(!showControls)}
    >
      <div className="absolute top-4 left-4 z-10 bg-black/60 px-3 py-1 rounded-md text-white text-sm">
        {hostId ? `Host: ${hostId}` : 'No host assigned'}
        {isHost && ' (You)'}
      </div>
      
      {isOutOfSync && !isHost && (
        <div className="absolute top-4 right-4 z-10 bg-orange-900/80 px-3 py-1 rounded-md text-white text-sm flex items-center">
          <span className="mr-1">Out of sync</span>
          <button 
            className="bg-blue-600 hover:bg-blue-700 text-xs px-2 py-0.5 rounded" 
            onClick={syncWithHost}
          >
            Sync now
          </button>
        </div>
      )}
      
      <div className="absolute inset-0">
        <VideoPlayer
          currentVideo={currentVideo}
          isPlaying={isPlaying}
          volume={volume}
          isMuted={isMuted}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onProgress={(progress) => {
            setCurrentTime(progress.playedSeconds);
            if (isHost) {
              setHostTime(progress.playedSeconds);
            }
          }}
          onDuration={setDuration}
          playerRef={playerRef}
          onQualityLevelsChange={setQualityLevels}
          onCurrentQualityChange={setCurrentQuality}
        />
      </div>
      
      <Controls
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={duration}
        volume={volume}
        isMuted={isMuted}
        isHost={isHost}
        isOutOfSync={isOutOfSync}
        onPlayPause={pauseHandler}
        onVolumeToggle={handleVolumeToggle}
        onSeek={handleSeek}
        onVolumeChange={(val) => setVolume(val[0])}
        onSyncWithHost={syncWithHost}
        onForceSyncAll={forceSyncAll}
        qualityLevels={qualityLevels}
        currentQuality={currentQuality}
        onQualityChange={handleQualityChange}
        showControls={showControls}
      />
      
      <Playlist
        playlist={playlist}
        currentHostVideoId={currentHostVideoId}
        isHost={isHost}
        onVideoSelect={(video) => onVideoSelectHandler(video)}
        onDeleteVideo={(videoId) => {
          const isCurrentVideo = currentHostVideoId === videoId;
          const newPlaylist = playlist.filter(v => v.id !== videoId);
          setPlaylist(newPlaylist);
          
          if (isCurrentVideo) {
            setCurrentHostVideoId(newPlaylist.length > 0 ? newPlaylist[0].id : null);
          }
        }}
        onAddVideo={addVideoHandler}
      />
    </div>
  );
};
