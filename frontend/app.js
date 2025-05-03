// ✅ Player-side Tambola Logic using Alpine.js + Socket.IO
const socket = io('https://tambola-backend.onrender.com', {
  transports: ['websocket', 'polling']
});

function playerDashboard() {
  return {
    // 🔹 Reactive State
    playerName: '',
    roomId: '',
    tickets: [],
    pendingTickets: [],
    calledNumbers: [],
    latestCall: null,
    autoMark: true,
    selectedPrize: null,
    prizeTypes: ['Full House', 'Top Line', 'Middle Line', 'Bottom Line', 'Corners'],
    showAddTicketModal: false,
    showClaimPrizeModal: false,

    // 🔹 Join Room Logic
    joinRoom() {
      if (!this.playerName || !this.roomId) {
        alert('Please enter Room ID and Player Name.');
        return;
      }
      socket.emit('join-room', {
        roomId: this.roomId,
        playerName: this.playerName
      });
    },

    // 🔹 Request Additional Ticket
    requestTicket() {
      socket.emit('request-ticket', {
        roomId: this.roomId,
        playerName: this.playerName
      });
      this.showAddTicketModal = false;
    },

    // 🔹 Claim a Prize
    submitClaim() {
      if (!this.selectedPrize) return alert('Select a prize type first.');
      this.tickets.forEach(ticket => {
        socket.emit('claim-prize', {
          roomId: this.roomId,
          playerName: this.playerName,
          claimType: this.selectedPrize,
          ticket: ticket.layout
        });
      });
      this.showClaimPrizeModal = false;
    },

    // 🔹 Check if number is marked
    isMarked(ticket, num) {
      return this.autoMark
        ? this.calledNumbers.includes(num)
        : (ticket.marks || []).includes(num);
    },

    // 🔹 Mark or Unmark cell manually
    toggleMark(ticket, num) {
      if (this.autoMark || !num) return;
      ticket.marks = ticket.marks || [];
      if (ticket.marks.includes(num)) {
        ticket.marks = ticket.marks.filter(n => n !== num);
      } else {
        ticket.marks.push(num);
      }
    },

    // 🔹 Mark all called numbers (auto)
    markCalled() {
      this.tickets.forEach(ticket => {
        ticket.marks = [];
        ticket.layout.flat().forEach(num => {
          if (num && this.calledNumbers.includes(num)) {
            ticket.marks.push(num);
          }
        });
      });
    },

    // 🔹 Confetti 🎉
    fireConfetti() {
      const duration = 1000;
      const animationEnd = Date.now() + duration;
      const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 9999 };
      const interval = setInterval(() => {
        if (Date.now() > animationEnd) return clearInterval(interval);
        confetti(Object.assign({}, defaults, {
          particleCount: 50,
          origin: { x: Math.random(), y: Math.random() * 0.5 }
        }));
      }, 200);
    },

    // 🔹 Init Alpine: Setup Socket Listeners
    init() {
      socket.on('room-error', (msg) => {
        alert(msg || 'Room does not exist.');
      });

      socket.on('ticket-assigned', (tickets, pending = []) => {
        this.tickets = tickets.map((t, i) => ({ id: i + 1, layout: t, marks: [] }));
        this.pendingTickets = pending;
        if (this.autoMark) this.markCalled();
      });

      socket.on('number-called', (num) => {
        this.calledNumbers.push(num);
        this.latestCall = num;
        if (this.autoMark) this.markCalled();
        if (document.querySelector(`.cell-${num}`)) this.fireConfetti();
      });

      socket.on('claim-result', ({ status, claimType, reason }) => {
        const message = `${claimType}: ${status === 'accepted' ? '✅ Accepted' : '❌ Rejected'} ${reason || ''}`;
        alert(message);
        if (status === 'accepted') this.fireConfetti();
      });
    }
  };
}
