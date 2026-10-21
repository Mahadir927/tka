// Spaced Repetition System (SRS) Algorithm based on modified SM-2 (Anki style)
// Rating:
// 1 = Again (Ulangi - gagal ingat)
// 2 = Hard (Sulit)
// 3 = Good (Bagus / Ingat dengan usaha wajar)
// 4 = Easy (Mudah sekali)

const SRS = {
  // Hitung status kartu setelah rating
  processRating(cardStats, rating) {
    const now = Date.now();
    let stats = cardStats ? { ...cardStats } : {
      reps: 0,
      interval: 0, // dalam hari (0 = hari ini / menit)
      easeFactor: 2.5,
      nextReview: now,
      lapses: 0,
      state: 'new' // 'new', 'learning', 'review'
    };

    if (rating === 1) { // AGAIN
      stats.lapses += 1;
      stats.reps = 0;
      stats.interval = 0; // ulang dalam sesi belajar saat ini (atau 10 menit lagi)
      stats.easeFactor = Math.max(1.3, stats.easeFactor - 0.2);
      stats.nextReview = now + (10 * 60 * 1000); // 10 menit ke depan
      stats.state = 'learning';
    } else if (rating === 2) { // HARD
      if (stats.reps === 0) {
        stats.interval = 1;
      } else {
        stats.interval = Math.max(1, Math.round(stats.interval * 1.2));
      }
      stats.easeFactor = Math.max(1.3, stats.easeFactor - 0.15);
      stats.reps += 1;
      stats.nextReview = now + (stats.interval * 24 * 60 * 60 * 1000);
      stats.state = 'review';
    } else if (rating === 3) { // GOOD
      if (stats.reps === 0) {
        stats.interval = 1; // 1 hari
      } else if (stats.reps === 1) {
        stats.interval = 3; // 3 hari
      } else {
        stats.interval = Math.round(stats.interval * stats.easeFactor);
      }
      stats.reps += 1;
      stats.nextReview = now + (stats.interval * 24 * 60 * 60 * 1000);
      stats.state = 'review';
    } else if (rating === 4) { // EASY
      if (stats.reps === 0) {
        stats.interval = 4; // 4 hari langsung
      } else {
        stats.interval = Math.round(stats.interval * stats.easeFactor * 1.3);
      }
      stats.easeFactor += 0.15;
      stats.reps += 1;
      stats.nextReview = now + (stats.interval * 24 * 60 * 60 * 1000);
      stats.state = 'review';
    }

    stats.lastReviewed = now;
    return stats;
  },

  // Periksa apakah kartu sudah masuk jadwal review hari ini
  isDue(cardStats) {
    if (!cardStats || !cardStats.nextReview) return true; // Kartu baru selalu ready dipelajari
    return Date.now() >= cardStats.nextReview;
  },

  // Format estimasi interval untuk tombol
  getIntervalLabel(cardStats, rating) {
    const projected = this.processRating(cardStats, rating);
    if (rating === 1) return '< 10m';
    if (projected.interval <= 1) return '1h';
    return `${projected.interval}h`;
  }
};

window.SRS = SRS;

