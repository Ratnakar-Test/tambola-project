// ✅ app.js — Alpine.js Tambola Player Logic (DaisyUI + Socket.IO integrated)

const socket = io('https://tambola-backend.onrender.com', { transports: ['websocket', 'polling'] });

function playerDashboard() {
  return {
    // 🌐 Game state
    roomId: '',
    playerName: '',
    tickets: [],
    called: [],
    autoMark: false,
    joined: false,                // controls visibility of join UI

    // 📦 UI States
    showMenu: false,
    showAddModal: false,
    showClaimModal: false,
    showAutoInfo: false,
    showRoomError: false,         // room validation dialog
    roomErrorMessage: '',
    showBoogie: false,            // wrong mark dialog

    // 🎯 Claim types
    selectedPrize: null,
    prizeTypes: ['Full House', 'Top Line', 'Middle Line', 'Bottom Line', 'Corners'],

    // 🚀 On page load
    init() {
      const urlParams = new URLSearchParams(window.location.search);
      this.roomId = urlParams.get('room') || '';
      if (this.roomId) this.showMenu = true;

      socket.on('number-called', (n) => {
        this.called.push(n);
      });

      socket.on('ticket-assigned', (tickets, pending = []) => {
        this.tickets = tickets.map((layout, i) => ({ id: i + 1, layout, marks: [] }));
        this.initLayouts();
        this.showMenu = true;
        this.joined = true;
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
        this.roomErrorMessage = 'Please enter both name and Room ID';
        this.showRoomError = true;
        return;
      }
      socket.emit('join-room', { roomId: this.roomId, playerName: this.playerName });
      // joined = true will be set on 'ticket-assigned' event
    },

    // 🎟 Ticket grid prep (layout already 3×9)
    initLayouts() {
      this.tickets.forEach((ticket, i) => {
        this.tickets[i].marks = [];
      });
    },

    // ✅ Is number marked?
    isMarked(tid, num) {
      if (this.autoMark) return this.called.includes(num);
      const t = this.tickets.find(t => t.id === tid);
      return t?.marks?.includes(num);
    },

    // ✏️ Toggle mark manually
    toggleMark(tid, num) {
      if (this.autoMark) return;
      const t = this.tickets.find(t => t.id === tid);
      if (!t) return;
      const idx = t.marks.indexOf(num);
      if (idx > -1) t.marks.splice(idx, 1);
      else t.marks.push(num);
    },

    // 📍 Mark number action (with Boogie logic)
    markNumber(tid, num) {
      if (this.autoMark) return;
      if (!this.called.includes(num)) {
        this.showBoogie = true;
      } else {
        this.toggleMark(tid, num);
      }
    },

    // ➕ Ticket request
    requestTicket() {
      socket.emit('request-ticket', { roomId: this.roomId, playerName: this.playerName });
      this.showAddModal = false;
      this.roomErrorMessage = '📨 Request sent to admin for a new ticket';
      this.showRoomError = true;
    },

    // 🏆 Submit prize claim
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
        ticket,
      });
      this.showClaimModal = false;
    },

    // 🎯 Toggle auto-mark UI alert
    autoChanged() {
      this.showAutoInfo = true;
      setTimeout(() => this.showAutoInfo = false, 2000);
    },

    // ❌ Close Boogie modal
    closeBoogie() {
      this.showBoogie = false;
    },

    // ❌ Close Room Error modal
    closeRoomError() {
      this.showRoomError = false;
    }
  };
}
