/**
 * ============================================================
 *  Araya Basecamp Extensions — Content Script
 * ============================================================
 *  Injected into Basecamp pages. Adds time-tracking timer
 *  buttons next to to-do items, with a modal for manual entry
 *  or start/stop stopwatch logging.
 *
 *  All DOM elements use the `.bctl-` CSS class prefix.
 * ============================================================
 */

(function () {
  'use strict';

  // Prevent double-initialisation (e.g. if injected twice)
  if (window.__bctlInitialised) return;
  window.__bctlInitialised = true;

  /* --------------------------------------------------------
     Constants
     -------------------------------------------------------- */

  const STORAGE_KEYS = {
    USER_NAME: 'bctl_user_name',
    TIMER_STATE: 'bctl_timer_state',
    TIME_CACHE: 'bctl_time_cache',
  };

  const DEBOUNCE_MS = 300;

  const TODO_SELECTORS = [
    '.todo',
    '.step', // Older Basecamp subtasks
    '.step__item', // Basecamp 4 Subtasks
    '.recordable--todo',
    '.recordable--kanban-card', // Kanban Card Detail
    'article.event--show', // Schedule Event Detail
    '[data-drag-and-drop-type="kanban_card"]', // Kanban Card Board Wrapper
    '.kanban-card', // Kanban Card Board View
    '.card', // Generic Card
    '[data-behavior="todo_item"]',
    '.todos .todo_name',
    '.checkbox--todo',
  ];

  /** Selectors to try for the current user's display name. */
  const USER_SELECTORS = [
    '[data-current-person]',
    '.nav-user',
    '#person_avatar',
    '.avatar--current-user',
    '.jump_menu__current-user',
  ];

  /* --------------------------------------------------------
     State
     -------------------------------------------------------- */

  /** Cached user display name. */
  let currentUserName = '';
  
  /** Admin status. */
  let currentIsAdmin = false;

  /** In-memory cache of logged hours keyed by task URL. */
  let timeCache = {};

  /** Currently active timer info (or null). */
  let activeTimer = null;

  /** Remember the last selected tab mode ('manual' or 'timer') */
  let lastSelectedMode = 'timer';

  /** Interval id for the running stopwatch UI update. */
  let timerIntervalId = null;

  /* --------------------------------------------------------
     1. Initialisation
     -------------------------------------------------------- */

  async function init() {
    try {
      await loadCachedData();
      applyTheme();
      detectUserProfile();
      injectProjectButton();
      injectButtons();
      startObserver();
      listenForTurboNavigation();
      restoreRunningTimer();
      ensureToastContainer();
      initKeyboardShortcuts();
    } catch (err) {
      console.error('[BCTL] Init error:', err);
    }
  }

  /** Load persisted data from chrome.storage.local. */
  async function loadCachedData() {
    try {
      const data = await chrome.storage.local.get([
        STORAGE_KEYS.USER_NAME,
        STORAGE_KEYS.TIMER_STATE,
        STORAGE_KEYS.TIME_CACHE,
      ]);
      if (data[STORAGE_KEYS.USER_NAME]) {
        currentUserName = data[STORAGE_KEYS.USER_NAME];
      }
      if (data[STORAGE_KEYS.TIME_CACHE]) {
        timeCache = data[STORAGE_KEYS.TIME_CACHE];
      }
      if (data[STORAGE_KEYS.TIMER_STATE]) {
        activeTimer = data[STORAGE_KEYS.TIMER_STATE];
      }
    } catch (err) {
      console.warn('[BCTL] Could not load cached data:', err);
    }
  }

  /* --------------------------------------------------------
     2. Profile Detection
     -------------------------------------------------------- */

  
  function applyTheme() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get('theme', (data) => {
        let theme = data.theme || 'system';
        if (theme === 'system') {
          theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        document.documentElement.setAttribute('data-bctl-theme', theme);
      });
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        chrome.storage.sync.get('theme', (data) => {
          if (!data.theme || data.theme === 'system') {
            document.documentElement.setAttribute('data-bctl-theme', e.matches ? 'dark' : 'light');
          }
        });
      });
    }
  }

  function detectUserProfile() {
    try {
      // Always detect admin status first
      currentIsAdmin = document.querySelector('meta[name="current-person-admin"][content="true"]') !== null;

      // Strategy 1 — known selectors
      for (const sel of USER_SELECTORS) {
        const el = document.querySelector(sel);
        if (el) {
          const name =
            el.getAttribute('data-current-person') ||
            el.getAttribute('title') ||
            el.getAttribute('alt') ||
            el.getAttribute('aria-label') ||
            el.textContent.trim();
          if (name) {
            setUserName(name);
            return;
          }
        }
      }

      // Strategy 2 — <meta> tags that Basecamp sometimes renders
      const metaName = document.querySelector(
        'meta[name="current-person-name"], meta[name="current-user"]'
      );
      if (metaName) {
        const content = metaName.getAttribute('content');
        if (content) {
          setUserName(content);
          return;
        }
      }

      // Strategy 3 — account menu dropdown containing initials avatar
      const initialsEl = document.querySelector(
        '.nav__account-name, .avatar-initials, [data-role="current-user-name"]'
      );
      if (initialsEl && initialsEl.textContent.trim()) {
        setUserName(initialsEl.textContent.trim());
        return;
      }

      // Fallback — use whatever was previously stored
      if (!currentUserName) {
        currentUserName = 'Unknown User';
      }
    } catch (err) {
      if (err.message && err.message.includes('Extension context invalidated')) {
        // Ignore this error; it happens when the extension is updated/reloaded
        return;
      }
      console.log('[BCTL] Profile detection error:', err);
    }
  }

  /** Persist the detected user name. */
  function setUserName(name) {
    currentUserName = name;
    chrome.storage.local
      .set({ [STORAGE_KEYS.USER_NAME]: name })
      .catch(() => {});
  }

  /* --------------------------------------------------------
     3. MutationObserver
     -------------------------------------------------------- */

  let observerDebounceTimer = null;

  function startObserver() {
    const observer = new MutationObserver(() => {
      clearTimeout(observerDebounceTimer);
      observerDebounceTimer = setTimeout(() => {
        injectProjectButton();
        injectButtons();
      }, DEBOUNCE_MS);
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  /** Handle Turbo / Turbolinks page transitions. */
  function listenForTurboNavigation() {
    const events = [
      'turbo:load',
      'turbolinks:load',
      'turbo:render',
      'turbo:frame-load',
    ];
    events.forEach((evt) => {
      document.addEventListener(evt, () => {
        detectUserProfile();
        injectProjectButton();
        injectButtons();
      });
    });
  }

  /* --------------------------------------------------------
     4. Timer Button Injection
     -------------------------------------------------------- */

  /**
   * Scan the DOM for to-do items and inject a timer button
   * next to each one that hasn't been augmented yet.
   */
  function injectButtons() {
    const pageTypeMeta = document.querySelector('meta[name="current-page-type"]');
    if (pageTypeMeta && pageTypeMeta.content === 'home') {
      return; // Do not inject timer buttons on the global home page
    }

    const url = window.location.href;
    // Do not inject timer buttons on the Project Home page, Schedule, Activity, or Timeline pages
    if (
      /\/projects\/\d+\/?$/.test(url) || 
      /\/schedules\/\d+/.test(url) ||
      /\/activity/.test(url) ||
      /\/timeline/.test(url)
    ) {
      return;
    }

    const todos = findTodoElements();
    todos.forEach((todoEl) => {
      try {
        if (todoEl.dataset.bctlInjected === 'true') return; // already injected
        const injected = injectTimerButton(todoEl);
        if (injected) {
          todoEl.dataset.bctlInjected = 'true';
        }
      } catch (err) {
        console.warn('[BCTL] Button injection error:', err);
      }
    });
  }

  /**
   * Walk through TODO_SELECTORS and collect all matching
   * elements (de-duplicated).
   */
  function findTodoElements() {
    const seen = new Set();
    const results = [];

    for (const sel of TODO_SELECTORS) {
      try {
        document.querySelectorAll(sel).forEach((el) => {
          if (!seen.has(el)) {
            if (
              el.closest('.completed') || 
              el.classList.contains('completed') || 
              el.classList.contains('step--completed')
            ) return;

            // If the element is INSIDE a detail view container but is NOT a subtask, ignore it.
            // This firmly prevents duplicate icons on the detail page when multiple selectors match inner wrappers.
            const recordable = el.closest('.recordable--todo, .recordable--kanban-card');
            if (recordable && el !== recordable && !el.classList.contains('step') && !el.classList.contains('step__item')) {
              return;
            }

            // Ignore items actively being created or edited (they contain text inputs)
            if (!el.classList.contains('recordable--todo') && !el.classList.contains('recordable--kanban-card')) {
              if (el.querySelector('input[type="text"], input[placeholder], textarea')) {
                return;
              }
            }
            
            seen.add(el);
            results.push(el);
          }
        });
      } catch (_) {
        // invalid selector — skip
      }
    }

    // Fallback: generic pattern — checkbox + label inside a list
    if (results.length === 0) {
      document
        .querySelectorAll(
          'ul li input[type="checkbox"], ol li input[type="checkbox"]'
        )
        .forEach((cb) => {
          const li = cb.closest('li');
          if (li && !seen.has(li)) {
            // Ignore completed to-dos
            if (li.closest('.completed') || li.classList.contains('completed')) return;
            seen.add(li);
            results.push(li);
          }
        });
    }

    return results;
  }

  /**
   * Create and append a timer button to a to-do element.
   */
  function injectTimerButton(todoEl) {
    const btn = document.createElement('button');
    btn.className = 'bctl-timer-btn';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Log time');
    btn.title = 'Log time';

    // Icon
    const icon = document.createElement('span');
    icon.className = 'bctl-btn-icon';
    icon.textContent = '⏱️';
    btn.appendChild(icon);

    // Show cached hours badge if available
    const taskUrl = getTaskUrl(todoEl);
    const cachedHours = timeCache[taskUrl];
    if (cachedHours && cachedHours > 0) {
      const badge = createBadge(cachedHours);
      btn.appendChild(badge);
    }

    // If this task has the active timer, mark the button
    if (activeTimer && activeTimer.taskUrl === taskUrl) {
      markButtonAsActive(btn);
    }

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openModal(todoEl);
    });

    const appendBtn = (container) => {
      if (!container) return false;
      if (container.querySelector(':scope > .bctl-timer-btn')) return true;
      container.appendChild(btn);
      return true;
    };

    // 1. Detail View Main Header (To-do, Kanban Card, Schedule Event)
    if (todoEl.classList.contains('recordable--todo') || 
        todoEl.classList.contains('recordable--kanban-card') || 
        todoEl.classList.contains('event--show')) {
      const permaTitle = todoEl.querySelector('.perma-header__title');
      if (permaTitle) {
        permaTitle.style.display = 'flex';
        permaTitle.style.alignItems = 'center';
        permaTitle.style.gap = '12px';
        
        // Scale up the icon to better match the large H1 text
        btn.style.transform = 'scale(1.35)';
        btn.style.transformOrigin = 'left center';
        
        return appendBtn(permaTitle);
      }
      return false; // Did not inject yet, turbo frame is loading
    }

    // 2. Subtasks (Steps)
    if (todoEl.classList.contains('step') || todoEl.classList.contains('step__item')) {
      const taskDetails = todoEl.querySelector('.task-details');
      if (taskDetails) {
        return appendBtn(taskDetails);
      } else {
        const stepContent = todoEl.querySelector('.step__content, .step__text-container') || todoEl;
        return appendBtn(stepContent);
      }
    }

    // 3. Kanban Card on Board View
    if (
      todoEl.matches('[data-drag-and-drop-type="kanban_card"]') ||
      todoEl.classList.contains('kanban-card') ||
      todoEl.classList.contains('card')
    ) {
      // Find a good place to mount the button inside the card
      const targetContainer = todoEl.querySelector('.kanban-card__title, .card__title, .title, .card__content, .card__header') || todoEl.firstElementChild || todoEl;
      
      // Force it to float or sit on the right
      btn.style.marginLeft = '8px';
      btn.style.zIndex = '10';
      
      return appendBtn(targetContainer);
    }

    // 4. Regular To-Do list item
    // Append — try to put it at the end of the task-details container so it aligns to the right
    const taskDetails = todoEl.querySelector('.task-details');
    if (taskDetails) {
      return appendBtn(taskDetails);
    } else {
      const textContainer =
        todoEl.querySelector('.checkbox__content, .todo__content, .todo_name, .todo__name') || todoEl;
      return appendBtn(textContainer);
    }
  }

  /** Convert decimal hours to readable 'Xj Ym' format. */
  function formatHoursDisplay(decimalHours) {
    const totalMinutes = Math.round(decimalHours * 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}j`;
    return `${h}j ${m}m`;
  }

  /** Create a small hours badge element. */
  function createBadge(hours) {
    const badge = document.createElement('span');
    badge.className = 'bctl-badge bctl-badge--has-time';
    badge.textContent = formatHoursDisplay(hours);
    return badge;
  }

  /* --------------------------------------------------------
     5. Context Extraction Helpers
     -------------------------------------------------------- */

  function getProjectName(todoEl = null) {
    // 0. Strongest guarantee for detail pages (To-dos, Cards, Schedules)
    const breadcrumb = document.querySelector('.perma-toolbar__breadcrumb--bucket strong, .perma-toolbar__breadcrumb--bucket');
    if (breadcrumb && breadcrumb.textContent.trim()) {
      return breadcrumb.textContent.replace(/\s*G\s*$/, '').trim();
    }

    const isProjectLink = (href) => /\/(projects|buckets)\/\d+(\/)?(\?.*|#.*)?$/.test(href);

    if (todoEl) {
      // 1. Basecamp explicitly provides the project name in this element on some list views!
      const ancestry = todoEl.querySelector('.assignment__ancestry');
      if (ancestry && ancestry.textContent.trim()) {
        return ancestry.textContent.trim();
      }

      // 2. Check inside the task itself for a project link (exclude task/edit/list links)
      const internalLink = Array.from(todoEl.querySelectorAll('a[href*="/projects/"], a[href*="/buckets/"]'))
        .find(a => isProjectLink(a.href) && !a.classList.contains('task-details__edit-button'));
      if (internalLink && internalLink.textContent.trim()) {
        return internalLink.textContent.trim();
      }

      // 3. Walk up the DOM to find a grouping container or a preceding header
      let current = todoEl;
      while (current && current !== document.body && current.tagName !== 'MAIN') {
        // Check previous siblings for a header (if lists aren't wrapped in sections)
        let prev = current.previousElementSibling;
        while (prev) {
          if (prev.matches('header, h2, h3, h4, h5, .bucket__header, .assignments__bucket-name')) {
            const link = prev.querySelector('a[href*="/projects/"], a[href*="/buckets/"]') || 
                         (prev.matches('a[href*="/projects/"], a[href*="/buckets/"]') ? prev : null);
            if (link && isProjectLink(link.href)) {
              return link.textContent.trim();
            }
          }
          prev = prev.previousElementSibling;
        }

        // Check if the current container has a header (including 'everything-bucket' for My Assignments)
        if (current.matches('section, article, .assignments__bucket, .bucket, .bucket-group, .everything-bucket')) {
          const headerLink = Array.from(current.querySelectorAll('header a, h2 a, h3 a, h4 a, .bucket__name a, a.project-link'))
            .find(a => isProjectLink(a.href));
          if (headerLink && headerLink.textContent.trim()) {
            return headerLink.textContent.trim();
          }
        }
        current = current.parentElement;
      }
    }

    // 2. Check meta tags (Basecamp often provides the exact name here)
    const metaBucket = document.querySelector('meta[name="current-bucket-name"]');
    if (metaBucket && metaBucket.getAttribute('content')) {
      return metaBucket.getAttribute('content').trim();
    }

    // 4. Breadcrumb selectors used by Basecamp 3/4
    const breadcrumbSelectors = [
      '.breadcrumb a',
      '.breadcrumbs a',
      '.project-header__name',
      '.project__name',
      '[data-role="project-name"]',
      'h1.project-name',
      '.perma-toolbar a[href*="/projects/"]',
      '.perma-toolbar a[href*="/buckets/"]',
    ];

    for (const sel of breadcrumbSelectors) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          if (el.hasAttribute('title')) {
            return el.getAttribute('title').trim();
          }
          const strongEl = el.querySelector('strong');
          if (strongEl && strongEl.textContent.trim()) {
            return strongEl.textContent.trim();
          }
          if (el.textContent.trim()) {
            // strip out known keyboard shortcuts if they exist at the end
            return el.textContent.replace(/\s*G\s*$/, '').trim();
          }
        }
      } catch (_) {}
    }

    // Last resort — pull from <title> (format: "Item · Project · Basecamp")
    const titleParts = document.title.split('·').map((s) => s.trim());
    if (titleParts.length >= 2) {
      return titleParts[titleParts.length - 2]; // second-to-last is usually the project
    }
    return document.title || 'Unknown Project';
  }

  /**
   * Get the text content (name) of a to-do item.
   */
  function getTaskName(todoEl) {
    // First try the aria-label from the checkbox (Basecamp often stores the clean title here)
    const checkbox = todoEl.querySelector('input[type="checkbox"]');
    if (checkbox && checkbox.getAttribute('aria-label')) {
      const label = checkbox.getAttribute('aria-label').trim();
      if (label && label !== 'Mark as complete' && label !== 'Unmark as complete') {
        return label.length > 200 ? label.slice(0, 200) + '…' : label;
      }
    }

    // Fallback to text element
    const textEl = todoEl.querySelector(
      '.perma-header__title, .todo__content > a, .todo_name, .todo__name, .checkbox__text, .step__text, .step__title, .kanban-card__title, .card__title, a[href*="/card_tables/cards/"]'
    );
    
    let raw = '';
    if (textEl) {
      const clone = textEl.cloneNode(true);
      const injectedBtns = clone.querySelectorAll('.bctl-timer-btn');
      injectedBtns.forEach(b => b.remove());
      raw = clone.textContent.trim();
    } else {
      const clone = todoEl.cloneNode(true);
      const injectedBtns = clone.querySelectorAll('.bctl-timer-btn');
      injectedBtns.forEach(b => b.remove());
      raw = clone.textContent.trim();
    }
    
    // Truncate if excessively long
    return raw.length > 200 ? raw.slice(0, 200) + '…' : raw;
  }

  /** Get the current page URL. */
  function getCurrentUrl() {
    return window.location.href;
  }

  /**
   * Derive a stable-ish key for a specific task. We combine the
   * page URL with the task name so each todo has a unique key.
   */
  function getTaskUrl(todoEl) {
    // Check for a dedicated permalink first
    const link = todoEl.querySelector('a[href]');
    if (link && link.href) return link.href;
    return getCurrentUrl() + '#' + encodeURIComponent(getTaskName(todoEl));
  }

  /* --------------------------------------------------------
     6. Time Entry Modal
     -------------------------------------------------------- */

  /** Reference to the currently open modal overlay (if any). */
  let currentOverlay = null;

  /**
   * Build and show the time entry modal.
   */
  function openModal(todoEl) {
    // Close existing modal if any
    closeModal();

    const taskName = getTaskName(todoEl);
    const projectName = getProjectName(todoEl);
    const taskUrl = getTaskUrl(todoEl);

    // Overlay
    const overlay = document.createElement('div');
    overlay.className = 'bctl-modal-overlay';
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    // Modal box
    const modal = document.createElement('div');
    modal.className = 'bctl-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Log time');

    // ── Header ──
    const header = document.createElement('div');
    header.className = 'bctl-modal-header';

    const title = document.createElement('h2');
    title.className = 'bctl-modal-title';
    title.innerHTML =
      '<span class="bctl-modal-title-icon">⏱️</span> Log Time';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'bctl-modal-close';
    closeBtn.type = 'button';
    closeBtn.innerHTML = '✕';
    closeBtn.title = 'Close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.addEventListener('click', closeModal);

    header.appendChild(title);
    header.appendChild(closeBtn);
    modal.appendChild(header);

    // ── Body ──
    const body = document.createElement('div');
    body.className = 'bctl-modal-body';

    // Task info card
    body.appendChild(
      buildTaskInfoCard(taskName, projectName)
    );

    // Mode tabs (Manual vs Timer)
    const { tabs, manualSection, timerSection, manualTab } = buildModeTabs(taskUrl);

    body.appendChild(tabs);

    // ── Manual entry section ──
    const hoursInput = document.createElement('input');
    hoursInput.type = 'text';
    hoursInput.className = 'bctl-input';
    hoursInput.placeholder = '00:00';
    hoursInput.title = 'Format: Jam:Menit (contoh: 01:30 untuk 1.5 jam)';
    hoursInput.value = '';

    const notesManual = document.createElement('textarea');
    notesManual.className = 'bctl-textarea';
    notesManual.placeholder = 'What did you work on?';

    manualSection.appendChild(buildFormGroup('Hours', hoursInput));
    manualSection.appendChild((() => { const g = buildFormGroup('Notes', notesManual); g.classList.add('bctl-notes-group'); return g; })());
    body.appendChild(manualSection);

    // ── Timer section ──
    const timerDisplay = document.createElement('div');
    timerDisplay.className = 'bctl-timer-display';

    const timerTime = document.createElement('div');
    timerTime.className = 'bctl-timer-time';
    timerTime.id = 'bctl-modal-timer';
    timerTime.innerHTML = formatTimeHTML(0);

    const timerHint = document.createElement('div');
    timerHint.className = 'bctl-timer-hint';
    timerHint.textContent = 'Click Start to begin tracking';

    const pauseBtn = document.createElement('button');
    pauseBtn.type = 'button';
    pauseBtn.className = 'bctl-btn bctl-btn-pause';
    pauseBtn.style.display = 'none';

    const timerBtn = document.createElement('button');
    timerBtn.type = 'button';
    timerBtn.className = 'bctl-btn bctl-btn-timer';

    const btnContainer = document.createElement('div');
    btnContainer.style.display = 'flex';
    btnContainer.style.gap = '8px';
    btnContainer.style.justifyContent = 'center';
    btnContainer.style.marginTop = '12px';
    btnContainer.appendChild(pauseBtn);
    btnContainer.appendChild(timerBtn);

    function updateTimerUIState() {
      if (activeTimer && activeTimer.taskUrl === taskUrl) {
        const elapsed = getElapsedSeconds();
        timerTime.innerHTML = formatTimeHTML(elapsed);
        timerTime.classList.add('bctl-running');
        
        timerBtn.classList.add('bctl-active');
        timerBtn.innerHTML = '■ Stop';
        
        pauseBtn.style.display = '';
        if (activeTimer.status === 'paused') {
          pauseBtn.innerHTML = '▶ Resume';
          timerHint.textContent = 'Timer is paused';
        } else {
          pauseBtn.innerHTML = '⏸ Pause';
          timerHint.textContent = 'Timer is running…';
        }
        startModalTimerDisplay(timerTime);
        
        manualTab.disabled = true;
        manualTab.style.opacity = '0.5';
        manualTab.title = 'Timer is running';
      } else {
        timerTime.classList.remove('bctl-running');
        timerBtn.classList.remove('bctl-active');
        timerBtn.innerHTML = '▶ Start';
        pauseBtn.style.display = 'none';
        timerHint.textContent = 'Click Start to begin tracking';
        stopModalTimerDisplay();
        
        manualTab.disabled = false;
        manualTab.style.opacity = '1';
        manualTab.title = '';
      }
    }

    pauseBtn.addEventListener('click', () => {
      if (activeTimer && activeTimer.status === 'paused') {
        resumeTimer();
      } else {
        pauseTimer();
      }
      updateTimerUIState();
    });

    timerBtn.addEventListener('click', () => {
      if (activeTimer && activeTimer.taskUrl === taskUrl) {
        const elapsed = getElapsedSeconds();
        stopTimer();
        timerHint.textContent = `Stopped at ${formatTime(elapsed)}`;
        const totalMinutes = Math.round(elapsed / 60);
        const h = Math.floor(totalMinutes / 60);
        const m = totalMinutes % 60;
        hoursInput.value = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
      } else {
        if (activeTimer) {
          showToast('Another timer is already running. Stop it first.', 'error');
          return;
        }
        startTimer(taskUrl, taskName, projectName);
      }
      updateTimerUIState();
    });

    updateTimerUIState();

    const notesTimer = document.createElement('textarea');
    notesTimer.className = 'bctl-textarea';
    notesTimer.placeholder = 'What did you work on?';

    timerDisplay.appendChild(timerTime);
    timerDisplay.appendChild(timerHint);
    timerDisplay.appendChild(btnContainer);
    timerSection.appendChild(timerDisplay);
    timerSection.appendChild((() => { const g = buildFormGroup('Notes', notesTimer); g.classList.add('bctl-notes-group'); return g; })());
    body.appendChild(timerSection);

    // ── Footer ──
    const footer = document.createElement('div');
    footer.className = 'bctl-modal-footer';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'bctl-btn bctl-btn-secondary';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', closeModal);

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'bctl-btn bctl-btn-primary';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', async () => {

      if (lastSelectedMode === 'timer' && activeTimer && activeTimer.taskUrl === taskUrl) {
        showToast('Tolong berhentikan timer terlebih dahulu (Stop) sebelum menyimpan.', 'error');
        return;
      }
      const hoursStr = hoursInput.value.trim();
      let hours = 0;
      if (/^\d{1,2}:\d{2}$/.test(hoursStr)) {
        const [h, m] = hoursStr.split(':');
        hours = parseInt(h, 10) + parseInt(m, 10) / 60;
      } else {
        showToast('Tolong masukkan durasi dengan format 00:00 (Jam:Menit).', 'error');
        return;
      }
      if (!hours || hours <= 0 || isNaN(hours)) {
        showToast('Tunggu hingga 1 menit untuk bisa menyimpan log timer.', 'error');
        return;
      }
      const notes =
        (manualSection.style.display !== 'none'
          ? notesManual.value
          : notesTimer.value
        ).trim();

      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span class="bctl-spinner"></span> Saving…';

      const success = await logTime({
        user: currentUserName,
        project: projectName,
        task: taskName,
        hours,
        notes,
        url: taskUrl,
        timestamp: new Date().toISOString(),
        type: manualSection.style.display !== 'none' ? 'manual' : 'otomatis',
      });

      if (success) {
        updateTimeCache(taskUrl, hours);
        refreshBadge(todoEl, taskUrl);
        showToast(`Logged ${formatHoursDisplay(hours)} for "${truncate(taskName, 40)}"`, 'success');
        closeModal();
      } else {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
        showToast('Failed to save. Please try again.', 'error');
      }
    });

    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);
    body.appendChild(footer);

    modal.appendChild(body);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    currentOverlay = overlay;

    // Trap focus & keyboard handling
    handleModalKeyboard(overlay, closeBtn);

    // Tab-switch helper exposed to timer button handler
    function switchTab(mode) {
      tabs.querySelectorAll('.bctl-mode-tab').forEach((t) => {
        t.classList.toggle('bctl-active', t.dataset.mode === mode);
      });
      manualSection.style.display = mode === 'manual' ? '' : 'none';
      timerSection.style.display = mode === 'timer' ? '' : 'none';
      lastSelectedMode = mode;
    }

    switchTab('timer');
  }

  /** Close and animate-out the modal. */
  function closeModal() {
    if (!currentOverlay) return;
    const overlay = currentOverlay;
    currentOverlay = null;
    stopModalTimerDisplay();

    overlay.classList.add('bctl-closing');
    overlay.addEventListener('animationend', () => overlay.remove(), {
      once: true,
    });
    // Safety fallback removal
    setTimeout(() => {
      if (overlay.parentNode) overlay.remove();
    }, 400);
  }

  /* --------------------------------------------------------
     6a. Modal Sub-builders
     -------------------------------------------------------- */

  function buildTaskInfoCard(taskName, projectName) {
    const card = document.createElement('div');
    card.className = 'bctl-task-info';

    const projLabel = document.createElement('div');
    projLabel.className = 'bctl-task-info-label';
    projLabel.textContent = 'Project';

    const projVal = document.createElement('div');
    projVal.className = 'bctl-task-info-value';
    projVal.textContent = projectName;

    const divider = document.createElement('div');
    divider.className = 'bctl-task-info-divider';

    const taskLabel = document.createElement('div');
    taskLabel.className = 'bctl-task-info-label';
    taskLabel.textContent = 'Task';

    const taskVal = document.createElement('div');
    taskVal.className = 'bctl-task-info-value';
    taskVal.textContent = taskName;

    card.append(projLabel, projVal, divider, taskLabel, taskVal);
    return card;
  }

  function buildModeTabs(currentTaskUrl) {
    const tabs = document.createElement('div');
    tabs.className = 'bctl-mode-tabs';

    const manualTab = document.createElement('button');
    manualTab.type = 'button';
    manualTab.className = 'bctl-mode-tab';
    manualTab.dataset.mode = 'manual';
    manualTab.innerHTML = '✏️ Manual';

    const timerTab = document.createElement('button');
    timerTab.type = 'button';
    timerTab.className = 'bctl-mode-tab bctl-active';
    timerTab.dataset.mode = 'timer';
    timerTab.innerHTML = '⏱️ Timer';

    const manualSection = document.createElement('div');
    manualSection.className = 'bctl-manual-section';
    manualSection.style.display = 'none';

    const timerSection = document.createElement('div');
    timerSection.className = 'bctl-timer-section';

    manualTab.addEventListener('click', () => {
      manualTab.classList.add('bctl-active');
      timerTab.classList.remove('bctl-active');
      manualSection.style.display = '';
      timerSection.style.display = 'none';
      lastSelectedMode = 'manual';
    });

    timerTab.addEventListener('click', () => {
      timerTab.classList.add('bctl-active');
      manualTab.classList.remove('bctl-active');
      timerSection.style.display = '';
      manualSection.style.display = 'none';
      lastSelectedMode = 'timer';
    });

    // Make Timer tab first
    tabs.appendChild(timerTab);
    tabs.appendChild(manualTab);

    // Disable manual tab if timer is running
    if (activeTimer && activeTimer.taskUrl === currentTaskUrl) {
      manualTab.disabled = true;
      manualTab.style.opacity = '0.5';
      manualTab.title = 'Timer is running';
    }

    return { tabs, manualSection, timerSection, manualTab };
  }

  function buildFormGroup(labelText, inputEl) {
    const group = document.createElement('div');
    group.className = 'bctl-form-group';

    const label = document.createElement('label');
    label.className = 'bctl-label';
    label.textContent = labelText;

    group.appendChild(label);
    group.appendChild(inputEl);
    return group;
  }

  /** Keyboard handling (Escape to close, trap focus). */
  function handleModalKeyboard(overlay) {
    const handler = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeModal();
      }
      // Basic focus trapping
      if (e.key === 'Tab') {
        const focusable = overlay.querySelectorAll(
          'button, input, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handler, true);
    // Clean up when overlay is removed
    const mo = new MutationObserver(() => {
      if (!document.body.contains(overlay)) {
        document.removeEventListener('keydown', handler, true);
        mo.disconnect();
      }
    });
    mo.observe(document.body, { childList: true });
  }

  /* --------------------------------------------------------
     7. Running Timer Logic
     -------------------------------------------------------- */

  /**
   * Start a timer for a specific task. Only one timer can
   * be active at a time; the state is persisted to storage.
   */
  function startTimer(taskUrl, taskName, projectName) {
    activeTimer = {
      taskUrl,
      taskName,
      projectName,
      startedAt: Date.now(),
      user: currentUserName,
      pageUrl: getCurrentUrl(),
      accumulatedSeconds: 0,
      status: 'running',
    };
    persistTimerState();
  }

  function pauseTimer() {
    if (!activeTimer || activeTimer.status === 'paused') return;
    activeTimer.accumulatedSeconds = getElapsedSeconds();
    activeTimer.status = 'paused';
    activeTimer.startedAt = null;
    persistTimerState();
    updateAllTimerButtons();
  }

  function resumeTimer() {
    if (!activeTimer || activeTimer.status === 'running') return;
    activeTimer.status = 'running';
    activeTimer.startedAt = Date.now();
    persistTimerState();
    updateAllTimerButtons();
  }

  function stopTimer() {
    const elapsed = getElapsedSeconds();
    activeTimer = null;
    chrome.storage.local.remove(STORAGE_KEYS.TIMER_STATE).catch(() => {});
    stopInlineTimerUpdates();
    updateAllTimerButtons(); // clear active styles
    return elapsed;
  }

  function getElapsedSeconds() {
    if (!activeTimer) return 0;
    let seconds = activeTimer.accumulatedSeconds || 0;
    if (activeTimer.status !== 'paused' && activeTimer.startedAt) {
      seconds += Math.floor((Date.now() - activeTimer.startedAt) / 1000);
    }
    return seconds;
  }

  function persistTimerState() {
    chrome.storage.local
      .set({ [STORAGE_KEYS.TIMER_STATE]: activeTimer })
      .catch(() => {});
  }

  function restoreRunningTimer() {
    if (!activeTimer) return;
    updateAllTimerButtons();
    startInlineTimerUpdates();
  }

  /* --------------------------------------------------------
     7a. Inline timer display on buttons
     -------------------------------------------------------- */

  let inlineTimerInterval = null;

  function startInlineTimerUpdates() {
    stopInlineTimerUpdates();
    inlineTimerInterval = setInterval(() => {
      updateAllTimerButtons();
    }, 1000);
  }

  function stopInlineTimerUpdates() {
    if (inlineTimerInterval) {
      clearInterval(inlineTimerInterval);
      inlineTimerInterval = null;
    }
  }

  /**
   * Iterate over all injected timer buttons and update their
   * visual state (active vs. inactive, elapsed time display).
   */
  function updateAllTimerButtons() {
    document.querySelectorAll('.bctl-timer-btn').forEach((btn) => {
      const todoEl = btn.closest(TODO_SELECTORS.join(',')) || btn.parentElement;
      if (!todoEl) return;
      const taskUrl = getTaskUrl(todoEl);

      if (activeTimer && activeTimer.taskUrl === taskUrl) {
        markButtonAsActive(btn);
      } else {
        btn.classList.remove('bctl-timer-active');
        // Remove elapsed span if present
        const elapsed = btn.querySelector('.bctl-elapsed');
        if (elapsed) elapsed.remove();
      }
    });

    updateProjectTimerIndicator();
  }

  /** Mark a specific button as the active (running) timer button. */
  function markButtonAsActive(btn) {
    btn.classList.add('bctl-timer-active');
    let elSpan = btn.querySelector('.bctl-elapsed');
    if (!elSpan) {
      elSpan = document.createElement('span');
      elSpan.className = 'bctl-elapsed';
      btn.appendChild(elSpan);
    }
    elSpan.textContent = formatTime(getElapsedSeconds());
    if (!inlineTimerInterval) startInlineTimerUpdates();
  }

  /* --------------------------------------------------------
     7b. Modal timer display
     -------------------------------------------------------- */

  let modalTimerInterval = null;

  function startModalTimerDisplay(timerTimeEl) {
    stopModalTimerDisplay();
    modalTimerInterval = setInterval(() => {
      if (!activeTimer) {
        stopModalTimerDisplay();
        return;
      }
      timerTimeEl.innerHTML = formatTimeHTML(getElapsedSeconds());
    }, 500);
  }

  function stopModalTimerDisplay() {
    if (modalTimerInterval) {
      clearInterval(modalTimerInterval);
      modalTimerInterval = null;
    }
  }

  /* --------------------------------------------------------
     8. Time Logging (background communication)
     -------------------------------------------------------- */

  /**
   * Send the LOG_TIME message to the background service worker.
   * Returns true on success, false on failure.
   */
  async function logTime(data) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'LOG_TIME',
        payload: data,
      });
      return response && response.success !== false;
    } catch (err) {
      console.error('[BCTL] logTime sendMessage error:', err);
      return false;
    }
  }

  /** Update the in-memory and stored time cache. */
  function updateTimeCache(taskUrl, hours) {
    const prev = timeCache[taskUrl] || 0;
    timeCache[taskUrl] = prev + hours;
    chrome.storage.local
      .set({ [STORAGE_KEYS.TIME_CACHE]: timeCache })
      .catch(() => {});
  }

  /** Refresh the hours badge on a specific to-do element. */
  function refreshBadge(todoEl, taskUrl) {
    const btn = todoEl.querySelector('.bctl-timer-btn');
    if (!btn) return;

    // Remove old badge
    const oldBadge = btn.querySelector('.bctl-badge');
    if (oldBadge) oldBadge.remove();

    const total = timeCache[taskUrl];
    if (total && total > 0) {
      btn.appendChild(createBadge(total));
    }
  }

  /* --------------------------------------------------------
     9. Toast Notifications
     -------------------------------------------------------- */

  function ensureToastContainer() {
    if (document.querySelector('.bctl-toast-container')) return;
    const container = document.createElement('div');
    container.className = 'bctl-toast-container';
    document.body.appendChild(container);
  }

  /**
   * Show a toast notification.
   * @param {string} message
   * @param {'success'|'error'|'info'} variant
   * @param {number} duration — auto-dismiss time in ms
   */
  function showToast(message, variant = 'info', duration = 3000) {
    ensureToastContainer();
    const container = document.querySelector('.bctl-toast-container');

    const toast = document.createElement('div');
    toast.className = `bctl-toast bctl-toast-${variant}`;

    const iconMap = { success: '✅', error: '❌', info: 'ℹ️' };
    const icon = document.createElement('span');
    icon.className = 'bctl-toast-icon';
    icon.textContent = iconMap[variant] || 'ℹ️';

    const msg = document.createElement('span');
    msg.className = 'bctl-toast-message';
    msg.textContent = message;

    toast.appendChild(icon);
    toast.appendChild(msg);
    container.appendChild(toast);

    // Auto-dismiss
    setTimeout(() => dismissToast(toast), duration);
  }

  function dismissToast(toast) {
    if (!toast.parentNode) return;
    toast.classList.add('bctl-toast-dismissing');
    toast.addEventListener('animationend', () => toast.remove(), {
      once: true,
    });
    setTimeout(() => {
      if (toast.parentNode) toast.remove();
    }, 400);
  }

  /* --------------------------------------------------------
     10. Utility Helpers
     -------------------------------------------------------- */

  /**
   * Format seconds as HH:MM:SS (plain text).
   */
  function formatTime(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
  }

  /**
   * Format seconds as HH:MM:SS with <span> wrapped colons
   * so CSS can animate them (blinking).
   */
  function formatTimeHTML(totalSeconds) {
    const h = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
    const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
    const s = String(totalSeconds % 60).padStart(2, '0');
    return `${h}<span class="bctl-colon">:</span>${m}<span class="bctl-colon">:</span>${s}`;
  }

  /** Truncate a string to `len` characters. */
  function truncate(str, len) {
    return str.length > len ? str.slice(0, len) + '…' : str;
  }

  /* --------------------------------------------------------
     11. Project Timesheet Modal
     -------------------------------------------------------- */

  function injectProjectButton() {
    const toolbarActions = document.querySelector('.perma-toolbar__actions');
    if (!toolbarActions) return;

    if (document.querySelector('.bctl-project-btn-wrapper')) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'bctl-project-btn-wrapper';
    wrapper.style.marginRight = '8px';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--sm';
    btn.style.display = 'flex';
    btn.style.alignItems = 'center';
    btn.style.gap = '6px';
    btn.style.backgroundColor = 'rgba(16, 185, 129, 0.15)'; // Teal / Green transparent
    btn.style.color = '#047857'; // Teal dark
    btn.style.border = 'none';
    btn.style.borderRadius = '6px';
    btn.style.padding = '0 10px';
    btn.style.height = '30px';
    btn.style.fontWeight = '500';
    btn.style.fontSize = '14px';

    const pageTypeMeta = document.querySelector('meta[name="current-page-type"]');
    const isMainProjectPage = pageTypeMeta && pageTypeMeta.content === 'project';

    if (isMainProjectPage) {
      btn.innerHTML = '<span>⏱️</span> Timesheet <span class="bctl-project-total-hours" style="color: #047857; font-weight: 400; margin-left: 2px;">...</span>';
    } else {
      btn.innerHTML = '<span>⏱️</span> Timesheet';
    }
    
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      openProjectModal();
    });

    wrapper.appendChild(btn);

    const indicator = document.createElement('a');
    indicator.className = 'bctl-project-timer-indicator';
    indicator.style.display = 'none';
    indicator.style.alignItems = 'center';
    indicator.style.gap = '6px';
    indicator.style.backgroundColor = 'rgba(234, 179, 8, 0.15)'; // Yellow transparent
    indicator.style.color = '#a16207'; // Yellow dark
    indicator.style.borderRadius = '6px';
    indicator.style.padding = '0 10px';
    indicator.style.height = '30px';
    indicator.style.fontWeight = '500';
    indicator.style.fontSize = '14px';
    indicator.style.textDecoration = 'none';
    indicator.innerHTML = '<span class="bctl-pulse">⏳</span> <span class="bctl-indicator-time"></span>';
    
    wrapper.appendChild(indicator);

    toolbarActions.insertBefore(wrapper, toolbarActions.firstChild);

    // Fetch the total hours for this project only if we need to display it
    if (isMainProjectPage) {
      chrome.runtime.sendMessage({
        type: 'GET_PROJECT_ENTRIES',
        payload: {
          project: getProjectName(),
          user: currentUserName,
          isAdmin: currentIsAdmin
        }
      }, (response) => {
        const hoursSpan = btn.querySelector('.bctl-project-total-hours');
        if (hoursSpan) {
          if (response && response.success && response.totalHours !== undefined) {
            hoursSpan.textContent = formatHoursDisplay(response.totalHours);
          } else {
            hoursSpan.textContent = `0m`;
          }
        }
      });
    }
  }

  function openProjectModal() {
    closeModal(); // Close existing modal if any

    const projectName = getProjectName();

    // Overlay
    const overlay = document.createElement('div');
    overlay.className = 'bctl-modal-overlay';
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    // Modal box
    const modal = document.createElement('div');
    modal.className = 'bctl-modal bctl-project-modal';

    // Header
    const header = document.createElement('div');
    header.className = 'bctl-modal-header';

    const title = document.createElement('h2');
    title.className = 'bctl-modal-title';
    title.innerHTML = `<span class="bctl-modal-title-icon">⏱️</span> ${projectName} Timesheet`;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'bctl-modal-close';
    closeBtn.innerHTML = '✕';
    closeBtn.addEventListener('click', closeModal);

    header.appendChild(title);
    header.appendChild(closeBtn);
    modal.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.className = 'bctl-modal-body';

    const tableContainer = document.createElement('div');
    tableContainer.className = 'bctl-table-container';
    
    const loadingState = document.createElement('div');
    loadingState.className = 'bctl-empty-state';
    loadingState.innerHTML = '<span class="bctl-spinner bctl-spinner--dark"></span> Loading entries...';
    tableContainer.appendChild(loadingState);

    body.appendChild(tableContainer);
    modal.appendChild(body);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    currentOverlay = overlay;
    
    handleModalKeyboard(overlay);

    // Fetch entries
    chrome.runtime.sendMessage({
      type: 'GET_PROJECT_ENTRIES',
      payload: {
        project: projectName,
        user: currentUserName,
        isAdmin: currentIsAdmin
      }
    }).then(response => {
      tableContainer.innerHTML = ''; // clear loading state
      
      if (!response.success) {
        const errorState = document.createElement('div');
        errorState.className = 'bctl-empty-state';
        errorState.textContent = 'Failed to load entries: ' + (response.error || 'Unknown error');
        tableContainer.appendChild(errorState);
        return;
      }

      // Render table
      const table = document.createElement('table');
      table.className = 'bctl-table';
      
      const thead = document.createElement('thead');
      thead.innerHTML = `
        <tr>
          <th>Date</th>
          <th>Person</th>
          <th>Task</th>
          <th>Notes</th>
          <th>Durasi</th>
          <th></th>
        </tr>
      `;
      table.appendChild(thead);
      
      const tbody = document.createElement('tbody');
      
      // Inline add row
      const addRow = document.createElement('tr');
      addRow.className = 'bctl-table-row--new';
      
      const todayDateStr = new Date().toISOString().split('T')[0];
      
      addRow.innerHTML = `
        <td><input type="date" class="bctl-input" value="${todayDateStr}" disabled style="width:130px; opacity:0.8" /></td>
        <td><strong>${currentUserName}</strong></td>
        <td><input type="text" class="bctl-input bctl-new-task" placeholder="Optional task name" /></td>
        <td><input type="text" class="bctl-input bctl-new-notes" placeholder="What did you work on?" /></td>
        <td>
          <input type="text" class="bctl-input bctl-new-hours" placeholder="00:00" title="Format: Jam:Menit (contoh: 01:30)" style="width:70px" />
        </td>
        <td>
          <button type="button" class="bctl-btn bctl-btn-primary bctl-btn-save-new" style="padding:4px 14px; font-size:12px; height:auto;">Save</button>
        </td>
      `;
      
      const saveNewBtn = addRow.querySelector('.bctl-btn-save-new');
      const hoursInput = addRow.querySelector('.bctl-new-hours');
      const notesInput = addRow.querySelector('.bctl-new-notes');
      const taskInput = addRow.querySelector('.bctl-new-task');

      saveNewBtn.addEventListener('click', async () => {
        const hoursStr = hoursInput.value.trim();
        let hours = 0;
        if (/^\d{1,2}:\d{2}$/.test(hoursStr)) {
          const [h, m] = hoursStr.split(':');
          hours = parseInt(h, 10) + parseInt(m, 10) / 60;
        } else {
          showToast('Tolong masukkan durasi dengan format 00:00 (Jam:Menit).', 'error');
          return;
        }
        if (!hours || hours <= 0 || isNaN(hours)) {
          showToast('Tolong masukkan durasi dengan format 00:00 (Jam:Menit).', 'error');
          return;
        }
        
        saveNewBtn.disabled = true;
        saveNewBtn.textContent = '...';
        
        const success = await logTime({
          user: currentUserName,
          project: projectName,
          task: taskInput.value.trim(),
          hours: hours,
          notes: notesInput.value.trim(),
          url: getCurrentUrl(), // Project URL
          timestamp: new Date().toISOString(),
          type: 'manual',
        });
        
        if (success) {
          showToast('Added new time entry', 'success');
          // Refresh modal
          openProjectModal();
        } else {
          saveNewBtn.disabled = false;
          saveNewBtn.textContent = 'Save';
          showToast('Failed to save', 'error');
        }
      });
      
      tbody.appendChild(addRow);
      
      // Data rows
      if (response.entries && response.entries.length > 0) {
        // Sort newest first
        response.entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        response.entries.forEach(entry => {
          const tr = document.createElement('tr');
          const date = new Date(entry.timestamp).toLocaleDateString();
          const isOwner = entry.user === currentUserName;
          tr.innerHTML = `
            <td style="white-space:nowrap; color: var(--bctl-text-secondary); font-size:12px;">${date}</td>
            <td><strong>${entry.user}</strong></td>
            <td>${entry.task || '-'}</td>
            <td>${entry.notes || '-'}</td>
            <td><strong>${formatHoursDisplay(entry.hours)}</strong></td>
            <td>${isOwner ? '<button class="bctl-btn bctl-btn-primary bctl-btn-edit" data-entry-id="' + entry.id + '" data-entry-hours="' + entry.hours + '" data-entry-notes="' + (entry.notes || '').replace(/"/g, '&quot;') + '" data-entry-task="' + (entry.task || '').replace(/"/g, '&quot;') + '" style="padding:4px 14px;font-size:12px;height:auto;">✏️ Edit</button>' : ''}</td>
          `;
          tbody.appendChild(tr);
        });

        // Attach edit handlers
        tbody.querySelectorAll('.bctl-btn-edit').forEach(btn => {
          btn.addEventListener('click', () => {
            const entryId = btn.dataset.entryId;
            const curHours = parseFloat(btn.dataset.entryHours);
            const curNotes = btn.dataset.entryNotes;
            const curTask = btn.dataset.entryTask;
            openEditEntryInline(btn.closest('tr'), entryId, curHours, curNotes, curTask);
          });
        });
        
        // Total row
        const formattedTotal = response.totalHours ? formatHoursDisplay(response.totalHours) : '0m';
        const totalTr = document.createElement('tr');
        totalTr.style.background = 'var(--bctl-surface-alt)';
        totalTr.innerHTML = `
          <td colspan="5" style="text-align:right; text-transform:uppercase; font-size:11px; font-weight:700; color:var(--bctl-text-secondary);">Total (Current Month)</td>
          <td style="font-size:15px; font-weight:700; color:var(--bctl-green-700);">${formattedTotal}</td>
        `;
        tbody.appendChild(totalTr);
      } else {
        const emptyTr = document.createElement('tr');
        emptyTr.innerHTML = `<td colspan="6" class="bctl-empty-state">No entries found for this project this month.</td>`;
        tbody.appendChild(emptyTr);
      }
      
      table.appendChild(tbody);
      tableContainer.appendChild(table);
      
      // Update header with total
      if (response.totalHours !== undefined) {
        const formattedTotal = formatHoursDisplay(response.totalHours);
        title.innerHTML = `<span class="bctl-modal-title-icon">⏱️</span> ${projectName} Timesheet &nbsp;<span class="bctl-badge bctl-badge--has-time" style="font-size:12px; height:24px; padding:0 8px">${formattedTotal} total</span>`;
      }
    });
  }

  /**
   * Replace a table row with inline edit fields for task, notes & hours.
   */
  function openEditEntryInline(tr, entryId, curHours, curNotes, curTask) {
    const originalHTML = tr.innerHTML;
    const h = Math.floor(Math.round(curHours * 60) / 60);
    const m = Math.round(curHours * 60) % 60;
    const curHHMM = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;

    tr.innerHTML = `
      <td colspan="2" style="font-size:12px;color:var(--bctl-text-secondary);">Editing...</td>
      <td><input type="text" class="bctl-input bctl-edit-task" value="${(curTask || '').replace(/"/g, '&quot;')}" style="width:100%;" /></td>
      <td><input type="text" class="bctl-input bctl-edit-notes" value="${(curNotes || '').replace(/"/g, '&quot;')}" style="width:100%;" /></td>
      <td><input type="text" class="bctl-input bctl-edit-hours" value="${curHHMM}" placeholder="00:00" title="Format: Jam:Menit" style="width:70px;" /></td>
      <td colspan="2" style="display:flex;gap:6px;">
        <button class="bctl-btn bctl-btn-primary bctl-edit-save" style="padding:2px 10px;font-size:11px;height:auto;">💾 Save</button>
        <button class="bctl-btn bctl-btn-secondary bctl-edit-cancel" style="padding:2px 10px;font-size:11px;height:auto;">Cancel</button>
      </td>
    `;

    tr.querySelector('.bctl-edit-cancel').addEventListener('click', () => {
      tr.innerHTML = originalHTML;
      // Re-attach edit handler
      const editBtn = tr.querySelector('.bctl-btn-edit');
      if (editBtn) {
        editBtn.addEventListener('click', () => {
          openEditEntryInline(tr, editBtn.dataset.entryId, parseFloat(editBtn.dataset.entryHours), editBtn.dataset.entryNotes, editBtn.dataset.entryTask);
        });
      }
    });

    tr.querySelector('.bctl-edit-save').addEventListener('click', async () => {
      const newHoursStr = tr.querySelector('.bctl-edit-hours').value.trim();
      const newNotes = tr.querySelector('.bctl-edit-notes').value.trim();
      const newTask = tr.querySelector('.bctl-edit-task').value.trim();

      if (!/^\d{1,2}:\d{2}$/.test(newHoursStr)) {
        showToast('Format durasi salah. Gunakan format 00:00 (Jam:Menit).', 'error');
        return;
      }
      const [hh, mm] = newHoursStr.split(':');
      const newHours = parseInt(hh, 10) + parseInt(mm, 10) / 60;
      if (!newHours || newHours <= 0) {
        showToast('Durasi harus lebih dari 0.', 'error');
        return;
      }

      const saveBtn = tr.querySelector('.bctl-edit-save');
      saveBtn.disabled = true;
      saveBtn.textContent = '...';

      const result = await chrome.runtime.sendMessage({
        type: 'UPDATE_ENTRY',
        payload: { entryId, hours: newHours, notes: newNotes, task: newTask }
      });

      if (result && result.success) {
        showToast('Entry berhasil diperbarui!', 'success');
        openProjectModal(); // refresh the whole table
      } else {
        showToast('Gagal memperbarui: ' + (result?.error || 'Unknown'), 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = '💾 Save';
      }
    });
  }

  function updateProjectTimerIndicator() {
    const indicator = document.querySelector('.bctl-project-timer-indicator');
    if (!indicator) return;

    if (activeTimer && activeTimer.projectName === getProjectName()) {
      indicator.style.display = 'inline-flex';
      indicator.href = activeTimer.pageUrl || activeTimer.taskUrl;
      const timeSpan = indicator.querySelector('.bctl-indicator-time');
      if (timeSpan) {
        timeSpan.textContent = formatTime(getElapsedSeconds());
      }
      indicator.title = `Running: ${activeTimer.taskName}`;
    } else {
      indicator.style.display = 'none';
    }
  }

  /* --------------------------------------------------------
     12. Global Keyboard Shortcuts
     -------------------------------------------------------- */
  function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() === 't') {
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
          return;
        }
        
        const projectName = getProjectName();
        if (projectName && projectName !== 'Unknown Project') {
          openProjectModal();
        }
      }
    });
  }

  /* --------------------------------------------------------
     Bootstrap
     -------------------------------------------------------- */

  // Wait for the page to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
