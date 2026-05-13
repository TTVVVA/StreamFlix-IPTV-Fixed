import React, { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Trash2, ChevronLeft, ChevronRight, Plus, Search, Folder } from 'lucide-react';
import { Video } from '@/types';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';

interface PlaylistProps {
  playlist: Video[];
  currentHostVideoId: string | null;
  isHost: boolean;
  onVideoSelect: (video: Video) => void;
  onDeleteVideo: (videoId: string) => void;
  onAddVideo: (video: Video) => void;
}

export const Playlist: React.FC<PlaylistProps> = ({
  playlist,
  currentHostVideoId,
  isHost,
  onVideoSelect,
  onDeleteVideo,
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);

  const groups = useMemo(() => {
    const g = new Set<string>();
    playlist.forEach(v => {
      if (v.group) g.add(v.group);
    });
    return Array.from(g).sort();
  }, [playlist]);

  const filteredPlaylist = useMemo(() => {
    return playlist.filter(v => {
      const matchesSearch = v.title.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesGroup = !selectedGroup || v.group === selectedGroup;
      return matchesSearch && matchesGroup;
    });
  }, [playlist, searchTerm, selectedGroup]);

  return (
    <div className={cn("absolute right-0 top-0 bottom-0 bg-zinc-950 border-l border-zinc-800 transition-all duration-300 z-20", collapsed ? "w-12" : "w-80")}>
      <Button variant="ghost" size="icon" onClick={() => setCollapsed(!collapsed)} className="absolute top-4 left-2 text-zinc-400 z-30">
        {collapsed ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
      </Button>
      {!collapsed && (
        <div className="flex flex-col h-full w-full pt-4">
          <div className="px-4 mb-4 flex items-center justify-between pl-12">
            <h2 className="text-sm font-bold text-zinc-200 uppercase">Canais</h2>
          </div>
          <div className="px-4 mb-2 space-y-2">
            <Input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Procurar..." className="bg-zinc-900 border-zinc-800 text-zinc-200 h-9" />
          </div>
          <ScrollArea className="flex-1 px-2">
            <div className="space-y-1 pb-4">
              {filteredPlaylist.map((video) => (
                <button key={video.id} onClick={() => onVideoSelect(video)} className={cn("w-full text-left p-2.5 rounded-md flex items-center gap-3", currentHostVideoId === video.id ? "bg-zinc-800/50" : "hover:bg-zinc-900")}>
                  <div className={cn("w-1.5 h-1.5 rounded-full", currentHostVideoId === video.id ? "bg-green-500" : "bg-zinc-700")} />
                  <div className="flex-1 min-w-0">
                    <div className={cn("text-xs font-medium truncate", currentHostVideoId === video.id ? "text-white" : "text-zinc-400")}>{video.title}</div>
                    <div className="text-[10px] text-zinc-600 truncate">{video.group || 'Geral'}</div>
                  </div>
                  {isHost && (
                    <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); onDeleteVideo(video.id); }} className="h-7 w-7 text-zinc-500 hover:text-red-400"><Trash2 size={14} /></Button>
                  )}
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
};
