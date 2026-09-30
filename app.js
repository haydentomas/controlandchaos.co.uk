/**
 * CONTROL & CHAOS — MASTER PORTAL ENGINE
 * Modern Luxury Web Experience
 */

document.addEventListener('DOMContentLoaded', () => {
  initParticleCanvas();
  initMobileNav();
  initBlogFeed();
});

/* --- Mobile Navigation Hamburger & Drawer --- */
function initMobileNav() {
  const toggle = document.getElementById('nav-toggle');
  const drawer = document.getElementById('mobile-nav-drawer');
  if (!toggle || !drawer) return;

  function closeMenu() {
    toggle.classList.remove('open');
    drawer.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
  }

  function openMenu() {
    toggle.classList.add('open');
    drawer.classList.add('open');
    toggle.setAttribute('aria-expanded', 'true');
  }

  toggle.onclick = (e) => {
    e.stopPropagation();
    const isOpen = drawer.classList.contains('open');
    if (isOpen) {
      closeMenu();
    } else {
      openMenu();
    }
  };

  // Close when clicking any mobile link
  drawer.querySelectorAll('.mobile-nav-link, .btn').forEach(link => {
    link.onclick = () => {
      closeMenu();
    };
  });

  if (!window._mobileNavGlobalListenersAttached) {
    window._mobileNavGlobalListenersAttached = true;
    document.addEventListener('click', (e) => {
      const activeDrawer = document.getElementById('mobile-nav-drawer');
      const activeToggle = document.getElementById('nav-toggle');
      if (activeDrawer && activeDrawer.classList.contains('open')) {
        if (!activeDrawer.contains(e.target) && !activeToggle.contains(e.target)) {
          activeToggle.classList.remove('open');
          activeDrawer.classList.remove('open');
          activeToggle.setAttribute('aria-expanded', 'false');
        }
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const activeDrawer = document.getElementById('mobile-nav-drawer');
        const activeToggle = document.getElementById('nav-toggle');
        if (activeDrawer && activeDrawer.classList.contains('open')) {
          activeToggle.classList.remove('open');
          activeDrawer.classList.remove('open');
          activeToggle.setAttribute('aria-expanded', 'false');
        }
      }
    });
  }
}


/* --- 2. Ambient Gold Particle Canvas --- */
function initParticleCanvas() {
  const canvas = document.getElementById('hero-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let width, height;
  let particles = [];

  function resize() {
    width = canvas.width = canvas.parentElement.offsetWidth;
    height = canvas.height = canvas.parentElement.offsetHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  class GoldParticle {
    constructor() {
      this.reset();
    }
    reset() {
      this.x = Math.random() * width;
      this.y = Math.random() * height;
      this.size = Math.random() * 2 + 0.6;
      this.speedY = -(Math.random() * 0.4 + 0.1);
      this.speedX = (Math.random() - 0.5) * 0.25;
      this.alpha = Math.random() * 0.5 + 0.2;
      this.fade = Math.random() * 0.006 + 0.002;
      const goldTones = ['#ebdca9', '#d8c290', '#b89a58'];
      this.color = goldTones[Math.floor(Math.random() * goldTones.length)];
    }
    update() {
      this.y += this.speedY;
      this.x += this.speedX;
      this.alpha -= this.fade;
      if (this.alpha <= 0 || this.y < 0) {
        this.reset();
        this.y = height + 10;
        this.alpha = Math.random() * 0.5 + 0.2;
      }
    }
    draw() {
      ctx.save();
      ctx.globalAlpha = this.alpha;
      ctx.fillStyle = this.color;
      ctx.shadowBlur = 6;
      ctx.shadowColor = this.color;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  for (let i = 0; i < 45; i++) {
    particles.push(new GoldParticle());
  }

  function animate() {
    ctx.clearRect(0, 0, width, height);
    particles.forEach(p => {
      p.update();
      p.draw();
    });
    requestAnimationFrame(animate);
  }
  animate();
}

/* --- 3. Dynamic Blog Feed Loader --- */
async function initBlogFeed() {
  const feedContainer = document.getElementById('recent-posts-grid');
  if (!feedContainer) return;

  try {
    let raw = null;
    for (const p of ['blog/posts.json', '/blog/posts.json', './blog/posts.json', '../blog/posts.json']) {
      try {
        const url = p.includes('?') ? p : `${p}?v=${Date.now()}`;
        const res = await fetch(url, { cache: 'no-store' });
        if (res.ok) { raw = await res.json(); break; }
      } catch(e) {}
    }
    if (!raw) return;
    const posts = Array.isArray(raw) ? raw : (raw.items || raw.posts || []);

    feedContainer.innerHTML = '';
    posts.slice(0, 3).forEach(post => {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div style="font-family: var(--font-mono); font-size: 11px; color: var(--gold-muted); margin-bottom: 8px;">
          ${post.date} &bull; ${post.category}
        </div>
        <h3 class="card-title"><a href="blog/${post.id}/" style="color:#fff; text-decoration:none;">${post.title}</a></h3>
        <p class="card-desc">${post.summary}</p>
        <a href="blog/${post.id}/" class="btn btn-secondary btn-sm" style="align-self: flex-start;">Read Article &rarr;</a>
      `;
      feedContainer.appendChild(card);
    });
  } catch (e) {
    // Fallback if local fetch is restricted by browser file:// protocol
  }
}

/* --- 4. Centralized SiteNavbar and SiteFooter Web Components --- */

function calculateRootPrefix() {
  const p = window.location.pathname.toLowerCase();
  const isSubfolder2 = (p.includes('/blog/') && (p.includes('/vow-launch/') || p.includes('/cage-break-xp/') || p.includes('/profile-picks/') || p.includes('/patch-v2-1/')))
    || (p.includes('/guides/') && p.split('/').filter(Boolean).length > 2)
    || (p.includes('/profile/') && p.split('/').filter(Boolean).length > 2)
    || p.includes('/directory/get-listed/');

  const isSubfolder1 = !isSubfolder2 && (
    p.includes('/directory/') || p.includes('/blog/') || p.includes('/events/') ||
    p.includes('/guides/') || p.includes('/products/') || p.includes('/xp-system/') || p.includes('/profile/')
  );

  return isSubfolder2 ? '../../' : (isSubfolder1 ? '../' : '');
}

class SiteNavbar extends HTMLElement {
  connectedCallback() {
    this.render();
    this.syncData();
  }

  render(navData) {
    const currentPath = (window.location && window.location.pathname) ? window.location.pathname.toLowerCase() : '/';
    const resolveUrl = (u) => {
      if (!u || u === '/' || u === '/index.html') return '/';
      if (u.startsWith('http://') || u.startsWith('https://') || u.startsWith('secondlife://')) return u;
      return u.startsWith('/') ? u : '/' + u;
    };

    const data = navData || {
      brand_title: "CONTROL & CHAOS",
      brand_subtitle: "SECOND LIFE GAMIFIED ECOSYSTEM",
      inworld_slurl: "http://maps.secondlife.com/secondlife/Los%20Pengos/97/181/3000",
      inworld_button_text: "Visit Us InWorld",
      links: [
        { label: "Service Providers", url: "/directory/", icon: "👑" },
        { label: "Store", url: "/products/", icon: "🛍️" },
        { label: "User Guides", url: "/guides/", icon: "📘" },
        { label: "XP & Rules", url: "/xp-system/", icon: "⚡" },
        { label: "Blog", url: "/blog/", icon: "🏰" },
        { label: "Events", url: "/events/", icon: "📅" }
      ]
    };

    const navLinksHtml = (data.links || []).map(link => {
      const href = resolveUrl(link.url);
      const clean = link.url ? link.url.replace(/^\/+/, '').toLowerCase().split('/')[0] : '';
      const isActive = clean && (currentPath.includes('/' + clean) || (clean === 'index.html' && (currentPath === '/' || currentPath.endsWith('index.html'))));
      const target = link.new_tab ? ' target="_blank" rel="noopener noreferrer"' : '';
      return `<li><a href="${href}" class="nav-link${isActive ? ' active' : ''}"${target}>${link.label}</a></li>`;
    }).join('\n');

    const mobileLinksHtml = (data.links || []).map(link => {
      const href = resolveUrl(link.url);
      const clean = link.url ? link.url.replace(/^\/+/, '').toLowerCase().split('/')[0] : '';
      const isActive = clean && (currentPath.includes('/' + clean) || (clean === 'index.html' && (currentPath === '/' || currentPath.endsWith('index.html'))));
      const target = link.new_tab ? ' target="_blank" rel="noopener noreferrer"' : '';
      return `<li><a href="${href}" class="mobile-nav-link${isActive ? ' active' : ''}"${target}><span>${link.icon || '🔗'}</span> ${link.label}</a></li>`;
    }).join('\n');

    const logoSrc = data.logo_image ? resolveUrl(data.logo_image) : resolveUrl('/images/logo.png');

    this.innerHTML = `
      <nav class="navbar" id="navbar">
        <div class="container navbar-container">
          <a href="/" class="nav-brand" aria-label="${data.brand_title || 'CONTROL &amp; CHAOS'}">
            <img src="${logoSrc}" alt="${data.brand_title || 'CONTROL &amp; CHAOS'}" class="brand-logo-img">
          </a>

          <div class="nav-links-wrapper">
            <ul class="nav-links">
              ${navLinksHtml}
            </ul>
          </div>

          <div class="nav-actions">
            <a href="${data.inworld_slurl || 'http://maps.secondlife.com/secondlife/Los%20Pengos/97/181/3000'}" target="_blank" rel="noopener" class="btn btn-gold btn-sm">
              <span>📍</span> ${data.inworld_button_text || 'Visit Us InWorld'}
            </a>
            <button class="nav-toggle" id="nav-toggle" aria-label="Toggle navigation menu" aria-expanded="false">
              <span class="hamburger-line"></span>
              <span class="hamburger-line"></span>
              <span class="hamburger-line"></span>
            </button>
          </div>
        </div>

        <!-- Mobile Navigation Drawer -->
        <div class="mobile-nav-drawer" id="mobile-nav-drawer">
          <ul class="mobile-nav-links">
            ${mobileLinksHtml}
          </ul>
          <div class="mobile-nav-actions">
            <a href="${data.inworld_slurl || 'http://maps.secondlife.com/secondlife/Los%20Pengos/97/181/3000'}" target="_blank" rel="noopener" class="btn btn-gold btn-sm" style="width: 100%;">
              <span>📍</span> ${data.inworld_button_text || 'Visit Us InWorld'}
            </a>
          </div>
        </div>
      </nav>
    `;

    initMobileNav();
  }

  async syncData() {
    const urls = [
      `/settings/navigation.json?v=${Date.now()}`
    ];
    for (const u of urls) {
      try {
        const res = await fetch(u, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          this.render(data);
          break;
        }
      } catch(e) {}
    }
  }
}

class SiteFooter extends HTMLElement {
  connectedCallback() {
    this.render();
    this.syncData();
  }

  render(footerData) {
    const resolveUrl = (u) => {
      if (!u || u === '/' || u === '/index.html') return '/';
      if (u.startsWith('http://') || u.startsWith('https://') || u.startsWith('secondlife://')) return u;
      return u.startsWith('/') ? u : '/' + u;
    };

    const data = footerData || {
      logo_image: "/images/logo.png",
      brand_title: "CONTROL & CHAOS",
      desc: "Second Life's premier gamified FinDom sim, escort directory, and hardware development house.",
      copyright: "© 2026 Control & Chaos. All rights reserved.",
      columns: [
        {
          title: "Store & Products",
          links: [
            { label: "Product Catalogue", url: "/products/" },
            { label: "All User Guides", url: "/guides/" },
            { label: "Vow Collar Suite", url: "/guides/vow-collar/" }
          ]
        },
        {
          title: "Ecosystem",
          links: [
            { label: "Service Providers", url: "/directory/" },
            { label: "XP System & Rules", url: "/xp-system/" },
            { label: "Events Board", url: "/events/" }
          ]
        },
        {
          title: "Community",
          links: [
            { label: "Sim Game Rules", url: "/xp-system/#sim-rules" },
            { label: "Get Listed", url: "/directory/#get-listed" },
            { label: "Contact & Concierge", url: "/contact/" }
          ]
        }
      ]
    };

    const logoSrc = data.logo_image ? resolveUrl(data.logo_image) : resolveUrl('/images/logo.png');

    const columnsHtml = (data.columns || []).map(col => `
      <div class="footer-links-col">
        <div class="footer-col-title">${col.title}</div>
        ${(col.links || []).map(l => {
          const href = resolveUrl(l.url);
          const target = l.new_tab ? ' target="_blank" rel="noopener noreferrer"' : '';
          return `<a href="${href}" class="footer-link"${target}>${l.label}</a>`;
        }).join('\n')}
      </div>
    `).join('\n');

    this.innerHTML = `
      <footer class="footer">
        <div class="container">
          <div class="footer-grid">
            <div>
              <div class="footer-brand-wrap" style="margin-bottom: 14px;">
                <a href="/" class="nav-brand footer-nav-brand" aria-label="${data.brand_title || 'CONTROL &amp; CHAOS'}">
                  <img src="${logoSrc}" alt="${data.brand_title || 'CONTROL &amp; CHAOS'}" class="footer-logo-img">
                </a>
              </div>
              <p class="footer-desc">
                ${data.desc || "Second Life's premier gamified FinDom sim, escort directory, and hardware development house."}
              </p>
            </div>

            ${columnsHtml}
          </div>

          <div class="footer-bottom">
            ${data.copyright || '&copy; 2026 Control &amp; Chaos. All rights reserved.'}
          </div>
        </div>
      </footer>
    `;
  }

  async syncData() {
    const rootPrefix = calculateRootPrefix();
    const urls = [
      `/settings/footer.json?v=${Date.now()}`,
      rootPrefix + `settings/footer.json?v=${Date.now()}`
    ];
    for (const u of urls) {
      try {
        const res = await fetch(u, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          this.render(data);
          break;
        }
      } catch(e) {}
    }
  }
}

if (!customElements.get('site-navbar')) {
  customElements.define('site-navbar', SiteNavbar);
}
if (!customElements.get('site-footer')) {
  customElements.define('site-footer', SiteFooter);
}

// Fallback hydration for existing legacy navbars/footers if present
function initDynamicNavigation() {
  // If custom elements are used, they manage themselves automatically
  if (document.querySelector('site-navbar')) return;
}

