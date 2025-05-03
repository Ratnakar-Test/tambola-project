// ✅ admin.js (Alpine.js powered Tambola Admin UI with modular DaisyUI controls)
const socket = io('https://tambola-backend.onrender.com', {
  transports: ['websocket', 'polling']
});

function adminDashboard() {
  return {
    roomId: '',
    called: [],
    players: [],
    ticketRequests: [],
    prizeClaims: [],
    winners: [],
    mode: 'manual',
    interval: 3000,
    rules: [],
    limits: {
      'Full House': 1,
      'Top Line': 1,
      'Middle Line': 1,
      'Bottom Line': 1,
      'Corners': 1
    },
    showMenu: false,

    // ✅ Admin connects to room
    connect() {
      if (!this.roomId) return alert('Enter Room ID');
      socket.emit('admin-connect', this.roomId);
      this.showMenu = true;
    },

    // ✅ Game controls
    startGame() {
      socket.emit('admin-start', {
        roomId: this.roomId,
        mode: this.mode,
        interval: this.interval,
        rules: this.rules,
        limits: this.limits
      });
      this.called = [];
    },
    pauseGame() { socket.emit('admin-pause', this.roomId); },
    resumeGame() { socket.emit('admin-resume', this.roomId); },
    stopGame() { socket.emit('admin-stop', this.roomId); },
    callNext() { socket.emit('admin-call-next', this.roomId); },

    // ✅ Approve/reject claims & tickets
    acceptClaim(playerId, claimType) {
      socket.emit('admin-accept-claim', { roomId: this.roomId, playerId, claimType });
    },
    rejectClaim(playerId, claimType) {
      socket.emit('admin-reject-claim', { roomId: this.roomId, playerId, claimType });
    },
    approveTicket(playerId) {
      socket.emit('admin-approve-ticket', { roomId: this.roomId, playerId });
    },

    // ✅ Incoming data from server
    init() {
      socket.on('number-called', num => {
        this.called.push(num);
      });
      socket.on('update-players', list => this.players = list);
      socket.on('update-ticket-requests', list => this.ticketRequests = list);
      socket.on('update-claims', list => this.prizeClaims = list);
      socket.on('game-summary', list => this.winners = list);
    },

    // ✅ UI logic for called number coloring
    isCalled(n) { return this.called.includes(n); },

    // ✅ Rules toggle logic
    toggleRule(rule) {
      if (this.rules.includes(rule)) {
        this.rules = this.rules.filter(r => r !== rule);
      } else {
        this.rules.push(rule);
      }
    }
  };
}
