const PLAYER_KEY = 'blind-sync-player';
const GRID_SIZE = 25;
const GAME_SECONDS = 120;
const MAX_CHARS = 50;

function createEmptyGrid() {
  return Array.from({ length: GRID_SIZE }, () => false);
}

function patternToGrid(pattern) {
  const grid = createEmptyGrid();
  pattern.forEach((index) => {
    grid[index] = true;
  });
  return grid;
}

function createId(prefix = '') {
  return `${prefix}${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function getPlayer() {
  const existing = sessionStorage.getItem(PLAYER_KEY);
  if (existing) {
    return JSON.parse(existing);
  }

  const player = {
    id: createId('P-'),
    name: `Joueur ${Math.floor(Math.random() * 90) + 10}`
  };
  sessionStorage.setItem(PLAYER_KEY, JSON.stringify(player));
  return player;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });

  if (!response.ok) {
    throw new Error(`Erreur HTTP ${response.status}`);
  }

  return response.json();
}

document.addEventListener('DOMContentLoaded', () => {
  const { createApp } = Vue;

  createApp({
    data() {
      return {
        player: getPlayer(),
        state: { rooms: {} },
        view: 'home',
        joinCode: '',
        currentRoomId: null,
        draftInstruction: '',
        lastInstructionText: '',
        pendingInstructionChars: 0,
        timerId: null,
        pollId: null,
        now: Date.now(),
        error: '',
        contact: {
          name: '',
          message: '',
          sent: false
        },
        previewShape: patternToGrid([2, 7, 12, 17, 22, 11, 13]),
        previewBuild: patternToGrid([2, 7, 12, 17])
      };
    },

    computed: {
      roomList() {
        return Object.values(this.state.rooms).sort((a, b) => b.updatedAt - a.updatedAt);
      },

      currentRoom() {
        return this.currentRoomId ? this.state.rooms[this.currentRoomId] : null;
      },

      currentPlayerInRoom() {
        return this.currentRoom?.players.find((player) => player.id === this.player.id);
      },

      isDesigner() {
        return this.currentPlayerInRoom?.role === 'Designer';
      },

      roleLabel() {
        return this.isDesigner ? 'Designer' : 'Builder';
      },

      canEditGrid() {
        return this.currentRoom?.status === 'playing' && !this.isDesigner;
      },

      charsLeft() {
        if (!this.currentRoom) {
          return MAX_CHARS;
        }
        return Math.max(0, MAX_CHARS - this.currentRoom.usedChars);
      },

      remainingSeconds() {
        if (!this.currentRoom || this.currentRoom.status !== 'playing') {
          return GAME_SECONDS;
        }
        const elapsed = Math.floor((this.now - this.currentRoom.startedAt) / 1000);
        return Math.max(0, GAME_SECONDS - elapsed);
      },

      formattedTime() {
        const minutes = String(Math.floor(this.remainingSeconds / 60)).padStart(2, '0');
        const seconds = String(this.remainingSeconds % 60).padStart(2, '0');
        return `${minutes}:${seconds}`;
      }
    },

    watch: {
      charsLeft(value) {
        document.documentElement.style.setProperty(
          '--chars-color',
          value <= 25 ? 'var(--danger)' : 'var(--primary-dark)'
        );
      }
    },

    async mounted() {
      await this.refreshState();
      this.timerId = window.setInterval(() => {
        this.now = Date.now();
      }, 1000);
      this.pollId = window.setInterval(() => {
        this.refreshState();
      }, 700);
    },

    beforeUnmount() {
      window.clearInterval(this.timerId);
      window.clearInterval(this.pollId);
    },

    methods: {
      async refreshState() {
        try {
          const data = await api('/api/state');
          this.state = data;
          this.error = '';
        } catch (error) {
          this.error = `Synchronisation impossible: ${error.message}`;
        }
      },

      applyServerState(data) {
        if (data.rooms) {
          this.state = { rooms: data.rooms };
        }
        if (data.room) {
          this.currentRoomId = data.room.id;
        }
        this.error = '';
      },

      async createRoom() {
        try {
          const data = await api('/api/rooms', {
            method: 'POST',
            body: JSON.stringify({ player: this.player })
          });
          this.applyServerState(data);
          this.view = 'game';
        } catch (error) {
          this.error = `Creation impossible: ${error.message}`;
        }
      },

      async joinRoom(rawCode) {
        const roomId = rawCode.trim().toUpperCase();
        if (!roomId) {
          return;
        }

        try {
          const data = await api(`/api/rooms/${roomId}/join`, {
            method: 'POST',
            body: JSON.stringify({ player: this.player })
          });
          this.applyServerState(data);
          this.joinCode = '';
          this.view = 'game';
        } catch (error) {
          this.error = 'Room introuvable.';
          this.joinCode = '';
        }
      },

      async leaveRoom() {
        const room = this.currentRoom;
        if (!room) {
          this.view = 'rooms';
          return;
        }

        try {
          const data = await api(`/api/rooms/${room.id}/leave`, {
            method: 'POST',
            body: JSON.stringify({ playerId: this.player.id })
          });
          this.applyServerState(data);
        } finally {
          this.currentRoomId = null;
          this.view = 'rooms';
        }
      },

      async startGame() {
        const room = this.currentRoom;
        if (!room || !this.isDesigner) {
          return;
        }

        const data = await api(`/api/rooms/${room.id}/start`, { method: 'POST' });
        this.draftInstruction = '';
        this.lastInstructionText = '';
        this.pendingInstructionChars = 0;
        this.applyServerState(data);
      },

      countInstructionInput(event) {
        const room = this.currentRoom;
        if (!room || !this.isDesigner || room.status !== 'playing') {
          return;
        }

        if (event.inputType?.startsWith('delete')) {
          return;
        }

        let addedChars = event.data?.length || 0;
        if (event.inputType === 'insertLineBreak') {
          addedChars = 1;
        }
        if (event.inputType === 'insertFromPaste') {
          addedChars = event.clipboardData?.getData('text')?.length || addedChars;
        }

        if (!addedChars) {
          return;
        }

        if (addedChars > this.charsLeft) {
          event.preventDefault();
          return;
        }

        this.pendingInstructionChars += addedChars;
      },

      async sendInstruction() {
        const room = this.currentRoom;
        if (!room || !this.isDesigner || room.status !== 'playing') {
          return;
        }

        const text = this.draftInstruction.slice(0, MAX_CHARS);
        const fallbackAddedChars = Math.max(0, text.length - this.lastInstructionText.length);
        const addedChars = this.pendingInstructionChars || fallbackAddedChars;
        this.pendingInstructionChars = 0;
        this.lastInstructionText = text;

        const data = await api(`/api/rooms/${room.id}/instruction`, {
          method: 'POST',
          body: JSON.stringify({ text, addedChars, playerName: this.player.name })
        });
        this.applyServerState(data);
      },

      async toggleCell(index) {
        const room = this.currentRoom;
        if (!room || !this.canEditGrid) {
          return;
        }

        const value = !room.grid[index];
        const data = await api(`/api/rooms/${room.id}/cell`, {
          method: 'POST',
          body: JSON.stringify({ index, value, playerName: this.player.name })
        });
        this.applyServerState(data);
      },

      async finishGame(won, message) {
        const room = this.currentRoom;
        if (!room || room.status === 'ended') {
          return;
        }

        const data = await api(`/api/rooms/${room.id}/end`, {
          method: 'POST',
          body: JSON.stringify({ won, message })
        });
        this.applyServerState(data);
      },

      sendContact() {
        this.contact.sent = true;
      },

      statusLabel(status) {
        return {
          waiting: 'en attente',
          playing: 'en cours',
          ended: 'terminee'
        }[status] || status;
      }
    }
  }).mount('#app');
});
