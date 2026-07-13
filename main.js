/**
 * Shores of Ignorance — One Page Site
 * Episode data is inlined so the page works when opened locally or served static.
 */

(function () {
  // Update footer year
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  const episodes = [
    {
      number: 286,
      title: 'Pass the Salt (I Love You)',
      date: '2026-07-09',
      duration: '89 min',
      description: 'Matt and Michael explore language itself — how the same sentence can carry seven different meanings depending on which word you emphasize. From there they spiral into John\'s claim that Jesus Christ is the Word, and why we so often use language to hide rather than reveal.',
      url: 'https://soundcloud.com/shoresofignorance'
    },
    {
      number: 285,
      title: 'Are You Feeling Semiquincentennial?',
      date: '2026-07-02',
      duration: '74 min',
      description: 'America\'s 250th birthday, why patriotism became politically coded, the strange guilt of prosperity, and what happens when a culture stops celebrating what\'s good.',
      url: '#'
    },
    {
      number: 284,
      title: 'Seek First the Kingdom of Heaven',
      date: '2026-06-24',
      duration: '76 min',
      description: 'On the proper posture when nothing\'s working: wallowing vs. scapegoating, the maturing conscience, Brother Lawrence, and finding God in the dishes.',
      url: '#'
    },
    {
      number: 283,
      title: 'What Is This Madness?',
      date: '2026-06-10',
      duration: '96 min',
      description: 'Three news stories expose a deeper sickness: when half the country stops operating in good faith, unhooks from reality, and forgets there should be a shared goal.',
      url: '#'
    },
    {
      number: 282,
      title: 'Dumb Idols and the Cost of Showing Up',
      date: '2026-06-03',
      duration: '79 min',
      description: 'When good things become mechanical, tools become idols, and participation in the world costs more than opting out.',
      url: '#'
    },
    {
      number: 281,
      title: 'Over My Dead Body',
      date: '2026-05-27',
      duration: '94 min',
      description: 'Why Jesus had to die, the story of Cain and Abel, God justifying himself to Job, and why Christianity\'s claim of divine self-sacrifice is unlike anything else.',
      url: '#'
    }
  ];

  const latest = episodes[0];

  // Render latest episode hero
  const latestTitle = document.getElementById('latest-title');
  const latestMeta = document.getElementById('latest-meta');
  const latestDesc = document.getElementById('latest-description');
  const latestPlay = document.getElementById('latest-play');

  if (latestTitle) latestTitle.textContent = latest.title;
  if (latestMeta) {
    const date = new Date(latest.date).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
    latestMeta.textContent = `Episode ${latest.number} · ${date}${latest.duration ? ' · ' + latest.duration : ''}`;
  }
  if (latestPlay) {
    latestPlay.href = latest.url || '#';
    latestPlay.textContent = latest.url ? 'Listen Now' : 'Coming Soon';
    if (latest.url && latest.url !== '#') {
      latestPlay.target = '_blank';
      latestPlay.rel = 'noopener';
    }
  }

  // Render episode list (include the latest so it appears under Recent Episodes too)
  const listContainer = document.getElementById('episode-list');
  if (listContainer) {
    const recentEpisodes = episodes.slice(0, 6); // show latest + next 5

    if (recentEpisodes.length === 0) {
      listContainer.innerHTML = '<p class="empty-state">More episodes coming soon.</p>';
    } else {
      listContainer.innerHTML = recentEpisodes.map(ep => {
        const date = new Date(ep.date).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        });
        return `
          <article class="episode-card">
            <div class="episode-number">${ep.number}</div>
            <div class="episode-info">
              <h3>${ep.title}</h3>
              <p>${ep.description || ''}</p>
              <span class="meta">${date}${ep.duration ? ' · ' + ep.duration : ''}</span>
            </div>
            <a href="${ep.url || '#'}" class="btn btn-ghost">${ep.url ? 'Listen' : 'Soon'}</a>
          </article>
        `;
      }).join('');
    }
  }
})();
