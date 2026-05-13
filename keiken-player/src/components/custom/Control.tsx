import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Play, Pause, Volume2, VolumeX, RefreshCw, Users, Settings } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { QualityLevel } from '@/types';

interface ControlsProps {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  isHost: boolean;
  isOutOfSync: boolean;  // Updated from isSynced to isOutOfSync
  onPlayPause: () => void;
  onVolumeToggle: () => void;
  onSeek: (value: number[]) => void;
  onVolumeChange: (value: number[]) => void;
  onSyncWithHost: () => void;
  onForceSyncAll: () => void;
  qualityLevels?: QualityLevel[];
  currentQuality?: number;
  onQualityChange?: (level: number) => void;
  showControls: boolean;
}

export const Controls: React.FC<ControlsProps> = ({
  isPlaying,
  currentTime,
  duration,
  volume,
  isMuted,
  isHost,
  isOutOfSync,
  onPlayPause,
  onVolumeToggle,
  onSeek,
  onVolumeChange,
  onSyncWithHost,
  onForceSyncAll,
  qualityLevels = [],
  currentQuality = -1,
  onQualityChange,
  showControls,
}) => {
  return (
    <div
      className={`absolute bottom-0 left-0 w-full bg-zinc-900/80 text-white p-3 z-50
        transition-opacity duration-300
        ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}
      `}
      onClick={(e) => e.stopPropagation()}
    >
      <Slider
        min={0}
        max={duration || 100}
        step={0.1}
        value={[currentTime]}
        onValueChange={onSeek}
        className="w-full"
      />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onPlayPause} className="text-white hover:bg-white/20">
            {isPlaying ? <Pause size={20} /> : <Play size={20} />}
          </Button>
          <span className="text-sm">{`${Math.floor(currentTime / 60)}:${Math.floor(currentTime % 60)
            .toString()
            .padStart(2, '0')} / ${Math.floor(duration / 60)}:${Math.floor(duration % 60)
            .toString()
            .padStart(2, '0')}`}</span>
        </div>

        <div className="flex items-center gap-2">
          {!isHost && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={onSyncWithHost} 
                    className={`text-white hover:bg-white/20 ${isOutOfSync ? 'text-orange-400' : ''}`}
                  >
                    <RefreshCw size={20} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Sync with host</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          
          {isHost && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={onForceSyncAll} 
                    className="text-white hover:bg-white/20"
                  >
                    <Users size={20} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Force sync all users</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          
          {/* Quality Settings Menu */}
          {qualityLevels.length > 0 && (
            <DropdownMenu>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <DropdownMenuTrigger>
                      <Button variant="ghost" size="icon" className="text-white hover:bg-white/20">
                        <Settings size={20} />
                      </Button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Quality Settings</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <DropdownMenuContent align="center" className="bg-zinc-900 border border-zinc-700">
                <div className="px-3 py-2 text-sm text-zinc-400">Quality</div>
                {qualityLevels.slice().reverse().map((level) => (
                  <DropdownMenuItem
                    key={level.value}
                    className={`${
                      currentQuality === level.value ? 'bg-zinc-800 text-blue-400' : 'text-white'
                    } hover:bg-zinc-800`}
                    onClick={() => {
                      if (onQualityChange) onQualityChange(level.value);
                    }}
                  >
                    {level.label} {currentQuality === level.value && '✓'}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          
          <Button variant="ghost" size="icon" onClick={onVolumeToggle} className="text-white hover:bg-white/20">
            {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
          </Button>
          <Slider min={0} max={100} value={[isMuted ? 0 : volume]} onValueChange={onVolumeChange} className="w-20" />
        </div>
      </div>
    </div>
  );
};
