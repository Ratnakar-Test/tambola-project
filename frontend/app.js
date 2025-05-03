// ✅ app.js — Alpine.js Tambola Player Logic (DaisyUI + Socket.IO integrated)

const socket = io('https://tambola-backend.onrender.com', {
  transports: ['websocket', 'polling']
});

function playerDashboard() {
  return {
    // 🌐 Game state
    roomId: '',
    playerName: '',
    tickets: [],
    called: [],
    autoMark: false,
    joined: false,

    // 📦 UI States
    showMenu: false,
    showAddModal: false,
    showClaimModal: false,
    showAutoInfo: false,
    showRoomError: false,
    roomErrorMessage: '',
    showBoogie: false,

    // 🎯 Claim types
    selectedPrize: null,
    prizeTypes: ['Full House', 'Top Line', 'Middle Line', 'Bottom Line', 'Corners'],

    // 🚀 Lifecycle
    init() {
      const urlParams = new URLSearchParams(window.location.search);
      this.roomId = urlParams.get('room') || '';
      if (this.roomId) this.showMenu = true;

      socket.on('number-called', (n) => {
        // Immutable update so Alpine will re-render the full list
        this.called = [...this.called, n];
      });

      socket.on('ticket-assigned', (layouts, pending = []) => {
        // layouts: array of 3x9 arrays from backend
        this.tickets = layouts.map((layout, i) => ({ id: i + 1, layout, marks: [] }));
        this.initLayouts();       // enforce 5 numbers per row
        this.joined = true;
        this.showMenu = true;
      });

      socket.on('claim-result', ({ status, claimType, reason }) => {
        this.roomErrorMessage = status === 'accepted'
          ? `✅ Claim for ${claimType} accepted!`
          : `❌ Claim rejected: ${reason}`;
        this.showRoomError = true;
      });

      socket.on('room-error', (msg) => {
        this.roomErrorMessage = msg;
        this.showRoomError = true;
      });
    },

    // 🎮 Join game
    joinGame() {
      if (!this.roomId || !this.playerName) {
        this.roomErrorMessage = 'Please enter both Name and Room ID';
        this.showRoomError = true;
        return;
      }
      socket.emit('join-room', {
        roomId: this.roomId,
        playerName: this.playerName
      });
      // joined = true is set when 'ticket-assigned' arrives
    },

    // 🎟 Enforce exactly 5 numbers per row in a 3×9 layout
    initLayouts() {
      this.tickets.forEach(ticket => {
        // Flatten out all numbers (should be 15)
        const nums = ticket.layout.flat().filter(n => n);
        ticket.layout = [];
        for (let r = 0; r < 3; r++) {
          const row = Array(9).fill(null);
          // Take next 5 numbers
          const picks = nums.splice(0, 5);
          // Randomly place them in 9 cols
          const indices = Array.from({ length: 9 }, (_, i) => i);
          picks.forEach(num => {
            const idx = indices.splice(Math.floor(Math.random() * indices.length), 1)[0];
            row[idx] = num;
          });
          ticket.layout.push(row);
        }
      });
    },

    // ✅ Check mark state
    isMarked(tid, num) {
      if (this.autoMark) return this.called.includes(num);
      const t = this.tickets.find(t => t.id === tid);
      return t?.marks?.includes(num);
    },

    // ✏️ Toggle a manual mark
    toggleMark(tid, num) {
      if (this.autoMark) return;
      const t = this.tickets.find(t => t.id === tid);
      if (!t) return;
      const idx = t.marks.indexOf(num);
      if (idx > -1) t.marks.splice(idx, 1);
      else t.marks.push(num);
    },

    // 🎯 Handle clicks on cells (with Boogie logic)
    markNumber(tid, num) {
      if (this.autoMark) return;
      // Wrong if number hasn't been called
      if (!this.called.includes(num)) {
        this.showBoogie = true;
      } else {
        this.toggleMark(tid, num);
      }
    },

    // ➕ Request a new ticket
    requestTicket() {
      socket.emit('request-ticket', {
        roomId: this.roomId,
        playerName: this.playerName
      });
      this.showAddModal = false;
      this.roomErrorMessage = '📨 Ticket request sent to admin';
      this.showRoomError = true;
    },

    // 🏆 Submit a prize claim
    submitClaim() {
      if (!this.selectedPrize) {
        this.roomErrorMessage = 'Select a prize to claim';
        this.showRoomError = true;
        return;
      }
      const ticket = this.tickets[0]?.layout || [];
      socket.emit('claim-prize', {
        roomId: this.roomId,
        playerName: this.playerName,
        claimType: this.selectedPrize,
        ticket
      });
      this.showClaimModal = false;
    },

    // 🌟 Auto-mark toggle info
    autoChanged() {
      this.showAutoInfo = true;
      setTimeout(() => this.showAutoInfo = false, 2000);
    },

    // ❌ Close dialogs
    closeBoogie() {
      this.showBoogie = false;
    },
    closeRoomError() {
      this.showRoomError = false;
    }
  };
}
