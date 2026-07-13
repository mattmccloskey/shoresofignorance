/**
 * Shores of Ignorance — One Page Site
 * Loads episode data from episodes.json and renders the hero + episode list.
 */

(async function () {
  // Update footer year
  document.getElementById('year').textContent = new Date().getFullYear();

  // Default fallback data so the page never looks broken
  const fallbackEpisodes = [
    {
      number: 1,
      title: 'Welcome to Shores of Ignorance',
      date: '2026-07-08',
      description: 'Matt and Michael introduce the show, the questions they hope to explore, and why ignorance might be a better starting point than certainty.',
      url: '#',
      duration: '58 min'
    }
  ];

  let episodes = [];
  try {
    const response = await fetch('episodes.json');
    if (response.ok) {
      episodes = await response.json();
    }
  } catch (err) {
    console.warn('Could not load episodes.json, using fallback.', err);
  }

  if (!Array.isArray(episodes) || episodes.length === 0) {
    episodes = fallbackEpisodes;
  }

  // Sort newest first
  episodes.sort((a, b) => new Date(b.date) - new Date(a.date));

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
  if (latestDesc) latestDesc.textContent = latest.description || '';
  if (latestPlay) {
    latestPlay.href = latest.url || '#';
    latestPlay.textContent = latest.url ? 'Listen Now' : 'Coming Soon';
    if (latest.url && latest.url !== '#') {
      latestPlay.target = '_blank';
      latestPlay.rel = 'noopener';
    }
  }

  // Render episode list (skip the latest since it's featured above)
  const listContainer = document.getElementById('episode-list');
  if (listContainer) {
    const recentEpisodes = episodes.slice(1, 6); // show next 5

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
