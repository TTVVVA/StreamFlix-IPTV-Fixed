class StreamFlixPlayer {
    constructor() {
        this.channels = [];
        this.filteredChannels = [];
        this.currentChannelIndex = -1;
        this.isPlaying = false;
        this.isMuted = false;
        this.playlists = {
            india: 'https://iptv-org.github.io/iptv/countries/in.m3u',
            global: 'https://iptv-org.github.io/iptv/index.m3u'
        };
        
        this.initializeElements();
        this.bindEvents();
        this.loadPlaylist('india');
        this.setupAudioContext();
    }

    initializeElements() {
        // Video elements
        this.videoPlayer = document.getElementById('video-player');
        this.channelInfo = document.getElementById('channel-info');
        this.currentChannelName = document.getElementById('current-channel-name');
        this.currentChannelGroup = document.getElementById('current-channel-group');
        this.channelResolution = document.getElementById('channel-resolution');
        this.channelCategory = document.getElementById('channel-category');
        this.loadingOverlay = document.getElementById('loading');
        this.progressBar = document.getElementById('progress-fill');

        // Control elements
        this.playPauseBtn = document.getElementById('play-pause');
        this.prevChannelBtn = document.getElementById('prev-channel');
        this.nextChannelBtn = document.getElementById('next-channel');
        this.volumeSlider = document.getElementById('volume-slider');
        this.muteToggleBtn = document.getElementById('mute-toggle');
        this.toggleSidebarBtn = document.getElementById('toggle-sidebar');
        this.closeSidebarBtn = document.getElementById('close-sidebar');

        // Sidebar elements
        this.sidebar = document.getElementById('sidebar');
        this.playlistSelect = document.getElementById('playlist-select');
        this.searchInput = document.getElementById('search-input');
        this.categoryFilter = document.getElementById('category-filter');
        this.channelList = document.getElementById('channel-list');
        this.sidebarChannelLogo = document.getElementById('sidebar-channel-logo');
        this.sidebarChannelName = document.getElementById('sidebar-channel-name');
        this.sidebarChannelInfo = document.getElementById('sidebar-channel-info');

        // Set initial volume (NOT muted by default)
        this.videoPlayer.volume = 0.8; // Start at 80% volume
        this.volumeSlider.value = 80;
        this.lastVolume = 0.8;
        this.isMuted = false;
        
        // Ensure video element can play audio
        this.videoPlayer.muted = false;
        this.videoPlayer.autoplay = false;
        this.videoPlayer.playsInline = true;
        this.videoPlayer.controls = false;
    }

    setupAudioContext() {
        // Try to resume audio context on user interaction
        const resumeAudioContext = () => {
            if (this.audioContext) {
                this.audioContext.resume();
            }
        };

        // Add event listeners to resume audio on user interaction
        document.addEventListener('click', resumeAudioContext, { once: true });
        document.addEventListener('touchstart', resumeAudioContext, { once: true });
        document.addEventListener('keydown', resumeAudioContext, { once: true });
    }

    bindEvents() {
        // Video player events
        this.videoPlayer.addEventListener('play', () => this.onPlay());
        this.videoPlayer.addEventListener('pause', () => this.onPause());
        this.videoPlayer.addEventListener('error', (e) => this.onError(e));
        this.videoPlayer.addEventListener('loadstart', () => this.onLoadStart());
        this.videoPlayer.addEventListener('canplay', () => this.onCanPlay());
        this.videoPlayer.addEventListener('timeupdate', () => this.updateProgress());
        this.videoPlayer.addEventListener('loadedmetadata', () => this.onMetadataLoaded());

        // Control button events
        this.playPauseBtn.addEventListener('click', () => this.handlePlayPauseClick());
        this.prevChannelBtn.addEventListener('click', () => this.previousChannel());
        this.nextChannelBtn.addEventListener('click', () => this.nextChannel());
        this.volumeSlider.addEventListener('input', (e) => this.setVolume(e.target.value));
        this.muteToggleBtn.addEventListener('click', () => this.toggleMute());

        // Sidebar events
        this.toggleSidebarBtn.addEventListener('click', () => this.toggleSidebar());
        this.closeSidebarBtn.addEventListener('click', () => this.toggleSidebar());
        this.playlistSelect.addEventListener('change', (e) => this.loadPlaylist(e.target.value));
        this.searchInput.addEventListener('input', (e) => this.filterChannels(e.target.value));
        this.categoryFilter.addEventListener('change', (e) => this.filterByCategory(e.target.value));

        // Window events
        window.addEventListener('keydown', (e) => this.handleKeyboard(e));
    }

    async loadPlaylist(type) {
        try {
            console.log(`Loading ${type} playlist...`);
            this.showLoading(true);
            
            const url = this.playlists[type];
            const relayBase = 'https://streamflix-v2-worker.cristianoronaldocr7.workers.dev';
            const fetchUrl = `${relayBase}/api/relay?url=${encodeURIComponent(url)}`;
            const response = await fetch(fetchUrl);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const playlistText = await response.text();
            this.parsePlaylist(playlistText);
            this.renderChannelGrid();
            this.populateCategories();
            this.showLoading(false);
        } catch (error) {
            console.error('Error loading playlist:', error);
            this.showError('Failed to load playlist. Please try again.');
        }
    }

    parsePlaylist(playlistText) {
        const lines = playlistText.split('\n');
        this.channels = [];
        let currentChannel = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            if (line.startsWith('#EXTINF')) {
                const metadata = this.parseChannelMetadata(line);
                currentChannel = {
                    ...metadata,
                    url: '',
                    id: this.channels.length
                };
            } else if (line.startsWith('http') && currentChannel) {
                currentChannel.url = line;
                if (this.isValidStreamUrl(line)) {
                    this.channels.push(currentChannel);
                }
                currentChannel = null;
            }
        }
        
        this.filteredChannels = [...this.channels];
        console.log(`Loaded ${this.channels.length} channels`);
    }

    isValidStreamUrl(url) {
        const validExtensions = ['.m3u8', '.mp4', '.ts', '.webm'];
        return validExtensions.some(ext => url.includes(ext)) || url.includes('live') || url.includes('stream');
    }

    parseChannelMetadata(line) {
        const metadataMatch = line.match(/#EXTINF:?[^ ]*\s*(.*?)\s*,(.*)/);
        if (!metadataMatch) return { name: 'Unknown Channel', group: 'General' };

        const attributes = metadataMatch[1];
        const name = metadataMatch[2].trim();

        const tvgId = this.getAttribute(attributes, 'tvg-id');
        const tvgLogo = this.getAttribute(attributes, 'tvg-logo');
        const groupTitle = this.getAttribute(attributes, 'group-title') || 'General';
        const resolution = this.extractResolution(name);

        return {
            name: name.replace(/\s*\(\d+p\)$/, ''),
            group: groupTitle,
            logo: tvgLogo || '',
            id: tvgId || '',
            resolution: resolution,
            originalName: name
        };
    }

    getAttribute(text, attrName) {
        const match = text.match(new RegExp(`${attrName}="(.*?)"`));
        return match ? match[1] : '';
    }

    extractResolution(name) {
        const match = name.match(/\((\d+)p\)$/);
        return match ? match[1] + 'p' : 'SD';
    }

    renderChannelGrid(channels = this.filteredChannels) {
        this.channelList.innerHTML = '';

        if (channels.length === 0) {
            this.channelList.innerHTML = `
                <div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: #808080;">
                    <i class="fas fa-search" style="font-size: 3rem; margin-bottom: 1rem;"></i>
                    <h3>No channels found</h3>
                    <p>Try adjusting your search or filter criteria</p>
                </div>
            `;
            return;
        }

        channels.forEach((channel, index) => {
            const channelElement = this.createChannelCard(channel, index);
            this.channelList.appendChild(channelElement);
        });
    }

    createChannelCard(channel, displayIndex) {
        const card = document.createElement('div');
        card.className = 'channel-card';
        card.dataset.channelId = channel.id;
        card.dataset.realIndex = this.channels.findIndex(c => c.id === channel.id);

        card.innerHTML = `
            <div class="channel-thumbnail">
                ${channel.logo ? 
                    `<img src="${channel.logo}" alt="${channel.name}" class="channel-logo-img" onerror="this.parentElement.innerHTML='<i class=\\'fas fa-tv channel-placeholder\\'></i>'">` : 
                    `<i class="fas fa-tv channel-placeholder"></i>`
                }
            </div>
            <div class="channel-info">
                <div class="channel-name">${channel.name}</div>
                <div class="channel-meta-info">
                    <span class="channel-group">${channel.group}</span>
                    <span class="channel-resolution-tag">${channel.resolution}</span>
                </div>
            </div>
        `;

        card.addEventListener('click', () => {
            const realIndex = parseInt(card.dataset.realIndex);
            this.selectChannel(realIndex);
        });

        return card;
    }

    populateCategories() {
        const categories = [...new Set(this.channels.map(channel => channel.group))];
        this.categoryFilter.innerHTML = '<option value="all">All Categories</option>';
        
        categories.sort().forEach(category => {
            const option = document.createElement('option');
            option.value = category;
            option.textContent = category;
            this.categoryFilter.appendChild(option);
        });
    }

    selectChannel(realIndex) {
        if (realIndex < 0 || realIndex >= this.channels.length) {
            console.warn('Invalid channel index:', realIndex);
            return;
        }

        const channel = this.channels[realIndex];
        console.log('Selecting channel:', channel.name, 'URL:', channel.url);

        // Update UI state
        this.updateActiveChannel(realIndex);
        this.updateChannelInfo(channel);
        this.updateSidebarInfo(channel);
        
        // Load and play the channel
        this.currentChannelIndex = realIndex;
        this.loadChannel(channel.url);
    }

    updateActiveChannel(realIndex) {
        document.querySelectorAll('.channel-card').forEach(card => {
            card.classList.remove('active');
        });
        
        const activeCard = document.querySelector(`.channel-card[data-real-index="${realIndex}"]`);
        if (activeCard) {
            activeCard.classList.add('active');
            activeCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    updateChannelInfo(channel) {
        this.currentChannelName.textContent = channel.name;
        this.currentChannelGroup.textContent = channel.group;
        this.channelResolution.textContent = channel.resolution;
        this.channelCategory.textContent = 'LIVE';
    }

    updateSidebarInfo(channel) {
        this.sidebarChannelName.textContent = channel.name;
        this.sidebarChannelInfo.textContent = `${channel.group} • ${channel.resolution}`;
        
        if (channel.logo) {
            this.sidebarChannelLogo.src = channel.logo;
            this.sidebarChannelLogo.style.display = 'block';
            this.sidebarChannelLogo.onerror = () => {
                this.sidebarChannelLogo.style.display = 'none';
            };
        } else {
            this.sidebarChannelLogo.style.display = 'none';
        }
    }

    loadChannel(url) {
        console.log('Loading channel URL:', url);
        this.showLoading(true);
        
        // Stop current playback and clean up
        this.videoPlayer.pause();
        this.videoPlayer.removeAttribute('src');
        this.videoPlayer.load();
        
        // Set new source with proper attributes
        this.videoPlayer.src = url;
        this.videoPlayer.muted = false; // Ensure audio is not muted
        this.videoPlayer.autoplay = true; // Enable autoplay
        
        // Wait for metadata to load
        this.videoPlayer.addEventListener('loadedmetadata', () => {
            console.log('Metadata loaded, attempting play');
            this.attemptPlay();
        }, { once: true });
        
        // Handle loading errors
        this.videoPlayer.addEventListener('error', (e) => {
            console.error('Video loading error:', e);
            this.handleVideoError();
        }, { once: true });
        
        // Start loading process
        this.videoPlayer.load();
    }

    attemptPlay() {
        // Ensure audio is enabled
        this.videoPlayer.muted = false;
        this.videoPlayer.volume = this.lastVolume;
        
        // Try to play the video
        const playPromise = this.videoPlayer.play();
        
        if (playPromise !== undefined) {
            playPromise
                .then(() => {
                    console.log('Video playing successfully with audio');
                    this.showLoading(false);
                    this.updatePlayButtonState(true);
                })
                .catch(error => {
                    console.log('Playback requires user interaction:', error);
                    this.showPlayPrompt();
                    this.showLoading(false);
                    this.updatePlayButtonState(false);
                });
        }
    }

    handlePlayPauseClick() {
        if (this.videoPlayer.paused) {
            // When manually playing, ensure audio is enabled
            this.videoPlayer.muted = false;
            this.videoPlayer.volume = this.lastVolume;
            
            const playPromise = this.videoPlayer.play();
            if (playPromise) {
                playPromise.catch(error => {
                    console.log('Play failed:', error);
                });
            }
        } else {
            this.videoPlayer.pause();
        }
    }

    updatePlayButtonState(isPlaying) {
        const playIcon = this.playPauseBtn.querySelector('i');
        if (isPlaying) {
            playIcon.className = 'fas fa-pause';
            this.playPauseBtn.title = 'Pause';
        } else {
            playIcon.className = 'fas fa-play';
            this.playPauseBtn.title = 'Play';
        }
    }

    handleVideoError() {
        console.error('Video failed to load');
        this.showLoading(false);
        this.showError('Failed to load channel. Trying next channel...');
        this.updatePlayButtonState(false);
        
        setTimeout(() => {
            if (this.channels.length > 1) {
                this.nextChannel();
            }
        }, 3000);
    }

    showPlayPrompt() {
        const playBtn = this.playPauseBtn.querySelector('i');
        playBtn.className = 'fas fa-play-circle';
        this.playPauseBtn.title = 'Click to start playback';
    }

    previousChannel() {
        if (this.channels.length === 0) return;
        const newIndex = this.currentChannelIndex <= 0 ? this.channels.length - 1 : this.currentChannelIndex - 1;
        this.selectChannel(newIndex);
    }

    nextChannel() {
        if (this.channels.length === 0) return;
        const newIndex = this.currentChannelIndex >= this.channels.length - 1 ? 0 : this.currentChannelIndex + 1;
        this.selectChannel(newIndex);
    }

    setVolume(value) {
        const volume = value / 100;
        this.videoPlayer.volume = volume;
        this.lastVolume = volume;
        
        if (volume > 0) {
            this.isMuted = false;
            this.muteToggleBtn.innerHTML = '<i class="fas fa-volume-up"></i>';
        } else {
            this.isMuted = true;
            this.muteToggleBtn.innerHTML = '<i class="fas fa-volume-mute"></i>';
        }
    }

    toggleMute() {
        if (this.isMuted) {
            this.videoPlayer.volume = this.lastVolume;
            this.volumeSlider.value = this.lastVolume * 100;
            this.muteToggleBtn.innerHTML = '<i class="fas fa-volume-up"></i>';
            this.isMuted = false;
        } else {
            this.videoPlayer.volume = 0;
            this.volumeSlider.value = 0;
            this.muteToggleBtn.innerHTML = '<i class="fas fa-volume-mute"></i>';
            this.isMuted = true;
        }
    }

    updateProgress() {
        if (this.videoPlayer.duration) {
            const percent = (this.videoPlayer.currentTime / this.videoPlayer.duration) * 100;
            this.progressBar.style.width = percent + '%';
        }
    }

    toggleSidebar() {
        this.sidebar.classList.toggle('open');
    }

    filterChannels(searchTerm) {
        const term = searchTerm.toLowerCase();
        this.filteredChannels = this.channels.filter(channel =>
            channel.name.toLowerCase().includes(term) ||
            channel.group.toLowerCase().includes(term)
        );
        this.renderChannelGrid(this.filteredChannels);
    }

    filterByCategory(category) {
        this.filteredChannels = category === 'all' 
            ? this.channels 
            : this.channels.filter(channel => channel.group === category);
        this.renderChannelGrid(this.filteredChannels);
    }

    handleKeyboard(event) {
        if ([' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'm'].includes(event.key)) {
            event.preventDefault();
        }

        switch(event.key) {
            case ' ':
                this.handlePlayPauseClick();
                break;
            case 'ArrowLeft':
                this.previousChannel();
                break;
            case 'ArrowRight':
                this.nextChannel();
                break;
            case 'ArrowUp':
                this.adjustVolume(5);
                break;
            case 'ArrowDown':
                this.adjustVolume(-5);
                break;
            case 'm':
            case 'M':
                this.toggleMute();
                break;
            case 'f':
            case 'F':
                this.toggleFullscreen();
                break;
        }
    }

    adjustVolume(change) {
        const currentVolume = parseInt(this.volumeSlider.value);
        const newVolume = Math.max(0, Math.min(100, currentVolume + change));
        this.volumeSlider.value = newVolume;
        this.setVolume(newVolume);
    }

    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => {
                console.log('Fullscreen error:', err);
            });
        } else {
            document.exitFullscreen();
        }
    }

    // Event handlers
    onPlay() {
        this.isPlaying = true;
        this.updatePlayButtonState(true);
        this.showLoading(false);
        console.log('Channel playing successfully with audio');
    }

    onPause() {
        this.isPlaying = false;
        this.updatePlayButtonState(false);
    }

    onError(event) {
        console.error('Video error:', event);
        this.showLoading(false);
        this.showError('Failed to load channel. This stream may be offline or geo-restricted.');
        this.updatePlayButtonState(false);
        
        setTimeout(() => {
            if (this.channels.length > 1) {
                console.log('Attempting next channel...');
                this.nextChannel();
            }
        }, 2000);
    }

    onLoadStart() {
        this.showLoading(true);
    }

    onCanPlay() {
        this.showLoading(false);
    }

    onMetadataLoaded() {
        console.log('Video metadata loaded');
        // Ensure audio is properly configured
        this.videoPlayer.muted = false;
        this.videoPlayer.volume = this.lastVolume;
    }

    showLoading(show) {
        if (show) {
            this.loadingOverlay.classList.add('active');
        } else {
            this.loadingOverlay.classList.remove('active');
        }
    }

    showError(message) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-notification';
        errorDiv.innerHTML = `
            <div style="
                position: fixed;
                top: 100px;
                right: 20px;
                background: #e50914;
                color: white;
                padding: 1rem 1.5rem;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
                z-index: 2000;
                max-width: 300px;
            ">
                <strong><i class="fas fa-exclamation-circle"></i> Error</strong>
                <p style="margin: 0.5rem 0 0;">${message}</p>
            </div>
        `;
        
        document.body.appendChild(errorDiv);
        
        setTimeout(() => {
            if (errorDiv.parentNode) {
                errorDiv.parentNode.removeChild(errorDiv);
            }
        }, 5000);
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('🎬 StreamFlix Player Initializing...');
    window.streamflixPlayer = new StreamFlixPlayer();
    console.log('✅ StreamFlix Player Ready!');
});