
class MobileNavbar {
    constructor(mobileMenu, navList, navLinks) {
      this.mobileMenu = document.querySelector(mobileMenu);
      this.navList = document.querySelector(navList);
      this.navLinks = document.querySelectorAll(navLinks);
      this.activeClass = "active";
  
      this.handleClick = this.handleClick.bind(this);
    }
  
    animateLinks() {
      this.navLinks.forEach((link, index) => {
        link.style.animation
          ? (link.style.animation = "")
          : (link.style.animation = `navLinkFade 0.5s ease forwards ${
              index / 7 + 0.3
            }s`);
      });
    }
  
    handleClick() {
      this.navList.classList.toggle(this.activeClass);
      this.mobileMenu.classList.toggle(this.activeClass);
      this.animateLinks();
    }
  
    addClickEvent() {
      this.mobileMenu.addEventListener("click", this.handleClick);
    }
  
    init() {
      if (this.mobileMenu) {
        this.addClickEvent();
      }
      return this;
    }
  }
  
  const mobileNavbar = new MobileNavbar(
    ".mobile-menu",
    ".nav-list",
    ".nav-list li",
  );
  mobileNavbar.init();
  
  // Floating chat button: appears on every page that loads this script
  function addFloatingChatButton() {
    // don't show the floating button on the chat page itself
    if (window.location && window.location.pathname && window.location.pathname.toLowerCase().endsWith('chat.html')) return;
    if (document.querySelector('.floating-chat')) return; // already added

    const chatLink = document.createElement('a');
    // if user is not logged in, direct to login page instead of chat
    let _userRaw = null;
    try { _userRaw = localStorage.getItem('sme_user'); } catch (e) { _userRaw = null; }
    let _user = null;
    try { _user = _userRaw ? JSON.parse(_userRaw) : null; } catch (e) { _user = null; }
    chatLink.href = (_user && _user.email) ? 'chat.html' : 'login.html';
    chatLink.className = 'floating-chat';
    chatLink.setAttribute('aria-label', 'Abrir Chat SME');
    chatLink.style.position = 'fixed';
    chatLink.style.right = '18px';
    chatLink.style.bottom = '18px';
    chatLink.style.width = '64px';
    chatLink.style.height = '64px';
    chatLink.style.borderRadius = '50%';
    chatLink.style.display = 'flex';
    chatLink.style.alignItems = 'center';
    chatLink.style.justifyContent = 'center';
    chatLink.style.background = '#003366';
    chatLink.style.boxShadow = '0 6px 18px rgba(0,0,0,0.18)';
    chatLink.style.zIndex = '9999';
    chatLink.style.border = '3px solid #ffffff';
    chatLink.style.textDecoration = 'none';

    const img = document.createElement('img');
    img.src = 'IMG/chat.svg';
    img.alt = 'Chat';
    img.style.width = '36px';
    img.style.height = '36px';

    // tooltip element shown on hover/focus
    const tooltip = document.createElement('span');
    tooltip.className = 'floating-chat-tooltip';
    tooltip.textContent = 'Chat';
    tooltip.style.position = 'absolute';
    tooltip.style.bottom = '82px';
    tooltip.style.left = '50%';
    tooltip.style.transform = 'translateX(-50%)';
    tooltip.style.background = 'rgba(0,0,0,0.78)';
    tooltip.style.color = '#fff';
    tooltip.style.padding = '6px 10px';
    tooltip.style.borderRadius = '6px';
    tooltip.style.fontSize = '13px';
    tooltip.style.whiteSpace = 'nowrap';
    tooltip.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
    tooltip.style.opacity = '0';
    tooltip.style.pointerEvents = 'none';
    tooltip.style.transition = 'opacity 180ms ease, transform 180ms ease';
    tooltip.style.transformOrigin = 'center bottom';

    chatLink.appendChild(img);
    chatLink.appendChild(tooltip);
    document.body.appendChild(chatLink);

    // mobile-friendly spacing for very small viewports
    function adjustForSafeArea() {
      const bottom = Math.max(18, (window.innerHeight - document.documentElement.clientHeight) || 18);
      chatLink.style.bottom = `${18 + bottom}px`;
    }

    window.addEventListener('resize', adjustForSafeArea);
    adjustForSafeArea();

    // show/hide tooltip on hover and focus
    function showTooltip() {
      tooltip.style.opacity = '1';
      tooltip.style.transform = 'translateX(-50%) translateY(-4px)';
    }

    function hideTooltip() {
      tooltip.style.opacity = '0';
      tooltip.style.transform = 'translateX(-50%) translateY(0)';
    }

    chatLink.addEventListener('mouseenter', showTooltip);
    chatLink.addEventListener('mouseleave', hideTooltip);
    chatLink.addEventListener('focus', showTooltip, true);
    chatLink.addEventListener('blur', hideTooltip, true);

    // on touch devices, show tooltip briefly when tapped (then navigation happens)
    chatLink.addEventListener('touchstart', function () {
      showTooltip();
      setTimeout(hideTooltip, 1200);
    }, {passive: true});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addFloatingChatButton);
  } else {
    addFloatingChatButton();
  }

  // Profile handling: replace Login link with Perfil when user is stored
  function applyProfileToNav() {
    let raw = null;
    try { raw = localStorage.getItem('sme_user'); } catch (e) { raw = null; }
    if (!raw) return;
    let user = null;
    try { user = JSON.parse(raw); } catch (e) { return; }

    const loginAnchor = document.querySelector('.nav-list a[href*="login.html"]');
    if (!loginAnchor) return;

    const li = loginAnchor.closest('li') || loginAnchor.parentElement;
    if (!li) return;

    // create profile menu
    const profileButton = document.createElement('button');
    profileButton.type = 'button';
    profileButton.className = 'profile-toggle';
    profileButton.textContent = user.name ? user.name.split(' ')[0] : 'Perfil';
    profileButton.setAttribute('aria-expanded', 'false');

    const dropdown = document.createElement('div');
    dropdown.className = 'profile-dropdown';
    dropdown.setAttribute('role', 'menu');
    dropdown.style.display = 'none';

    const info = document.createElement('div');
    info.className = 'profile-info';
    const roleHtml = user.isAdmin
      ? '<div class="profile-role" style="color:#a2d94c;font-weight:700;margin-bottom:6px;">Administrador</div>'
      : '<div class="profile-role" style="color:#4a90e2;font-weight:700;margin-bottom:6px;">Usuário</div>';
    info.innerHTML = `${roleHtml}<strong>${escapeHtml(user.name || '')}</strong><br><small>${escapeHtml(user.email || '')}</small>`;

    const logout = document.createElement('button');
    logout.type = 'button';
    logout.className = 'profile-logout';
    logout.innerHTML = 'Sair <span aria-hidden="true">🚪</span>';

    dropdown.appendChild(info);
    dropdown.appendChild(logout);

    // replace li content
    li.innerHTML = '';
    li.style.position = 'relative';
    li.appendChild(profileButton);
    li.appendChild(dropdown);

    function openMenu() {
      dropdown.style.display = 'block';
      profileButton.setAttribute('aria-expanded', 'true');
    }
    function closeMenu() {
      dropdown.style.display = 'none';
      profileButton.setAttribute('aria-expanded', 'false');
    }

    profileButton.addEventListener('click', function (e) {
      e.stopPropagation();
      const isOpen = profileButton.getAttribute('aria-expanded') === 'true';
      if (isOpen) closeMenu(); else openMenu();
    });

    logout.addEventListener('click', function () {
      try { localStorage.removeItem('sme_user'); } catch (e) {}
      window.location.href = 'index.html';
    });

    function closeMenuOnScroll() {
      if (profileButton.getAttribute('aria-expanded') === 'true') {
        closeMenu();
      }
    }

    window.addEventListener('scroll', closeMenuOnScroll, { passive: true });
    document.addEventListener('wheel', closeMenuOnScroll, { passive: true });
    document.addEventListener('touchmove', closeMenuOnScroll, { passive: true });

    // close when clicking outside
    document.addEventListener('click', function (ev) {
      if (!li.contains(ev.target)) closeMenu();
    });
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"'`]/g, function (s) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',"`":'&#96;'})[s]; });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyProfileToNav);
  } else {
    applyProfileToNav();
  }
