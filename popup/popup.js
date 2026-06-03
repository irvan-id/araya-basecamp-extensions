/**
 * Araya Basecamp Extensions — Popup Script
 *
 * Handles all popup UI logic: settings management, summary calculations,
 * recent entries display, connection testing, and real-time updates.
 */

/* ==========================================================================
   DOM References
   ========================================================================== */
const DOM = {
  // Status
  statusDot: document.getElementById('statusDot'),
  statusText: document.getElementById('statusText'),

  // Running Timer
  runningTimerSection: document.getElementById('runningTimerSection'),
  runningTimerProject: document.getElementById('runningTimerProject'),
  runningTimerTask: document.getElementById('runningTimerTask'),
  runningTimerTime: document.getElementById('runningTimerTime'),

  // Summary
  todayHours: document.getElementById('todayHours'),
  weekHours: document.getElementById('weekHours'),

  // Entries
  entriesList: document.getElementById('entriesList'),
  entriesEmpty: document.getElementById('entriesEmpty'),

  // Settings
  settingsToggle: document.getElementById('settingsToggle'),
  settingsPanel: document.getElementById('settingsPanel'),
  userName: document.getElementById('userName'),
  appsScriptUrl: document.getElementById('appsScriptUrl'),
  apiKey: document.getElementById('apiKey'),
  themeSelect: document.getElementById('themeSelect'),
  saveSettingsBtn: document.getElementById('saveSettingsBtn'),
  testConnectionBtn: document.getElementById('testConnectionBtn'),
  testResult: document.getElementById('testResult'),

  // Footer
  openBasecampBtn: document.getElementById('openBasecampBtn'),
  versionBadge: document.getElementById('versionBadge'),

  // Toast
  toast: document.getElementById('toast'),
  toastIcon: document.getElementById('toastIcon'),
  toastMessage: document.getElementById('toastMessage'),
};

/* ==========================================================================
   Initialization
   ========================================================================== */
let popupTimerInterval = null;

document.addEventListener('DOMContentLoaded', async () => {
  displayVersion();
  await loadSettings();
  await loadTimeEntries();
  await loadActiveTimer();
  checkConnectionStatus();
  bindEvents();

  // Watch for system theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    chrome.storage.sync.get('theme', (data) => {
      if (!data.theme || data.theme === 'system') {
        applyTheme('system');
      }
    });
  });
});

function applyTheme(theme) {
  let activeTheme = theme;
  if (theme === 'system') {
    activeTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', activeTheme);
}

/**
 * Show the extension version from the manifest.
 */
function displayVersion() {
  try {
    const manifest = chrome.runtime.getManifest();
    DOM.versionBadge.textContent = `v${manifest.version}`;
  } catch {
    DOM.versionBadge.textContent = 'v1.0.0';
  }
}

/* ==========================================================================
   Settings Management
   ========================================================================== */

/**
 * Load saved settings from chrome.storage.sync and populate form fields.
 */
async function loadSettings() {
  try {
    const data = await chrome.storage.sync.get([
      'userName',
      'appsScriptUrl',
      'spreadsheetUrl',
      'apiKey',
      'theme',
    ]);

    if (data.userName) DOM.userName.value = data.userName;
    if (data.appsScriptUrl) DOM.appsScriptUrl.value = data.appsScriptUrl;
    if (data.apiKey) DOM.apiKey.value = data.apiKey;
    
    const theme = data.theme || 'system';
    DOM.themeSelect.value = theme;
    applyTheme(theme);
  } catch (err) {
    console.error('[Popup] Failed to load settings:', err);
  }
}

/**
 * Save current form values to chrome.storage.sync.
 */
async function saveSettings() {
  const userName = DOM.userName.value.trim();
  const appsScriptUrl = DOM.appsScriptUrl.value.trim();
  const apiKey = DOM.apiKey.value.trim();
  const theme = DOM.themeSelect.value;

  try {
    await chrome.storage.sync.set({ userName, appsScriptUrl, apiKey, theme });
    applyTheme(theme);
    showToast('Settings saved ✓', 'success');
    checkConnectionStatus();
  } catch (err) {
    console.error('[Popup] Failed to save settings:', err);
    showToast('Failed to save settings', 'error');
  }
}

/* ==========================================================================
   Connection Status
   ========================================================================== */

/**
 * Check if the Apps Script URL is configured and update the status indicator.
 */
async function checkConnectionStatus() {
  try {
    const { appsScriptUrl } = await chrome.storage.sync.get('appsScriptUrl');

    if (appsScriptUrl && appsScriptUrl.trim()) {
      setStatusConnected();
    } else {
      setStatusDisconnected('Not configured');
    }
  } catch {
    setStatusDisconnected('Error');
  }
}

/**
 * Test the connection to the Apps Script web app.
 */
async function testConnection() {
  const url = DOM.appsScriptUrl.value.trim();
  const apiKey = DOM.apiKey.value.trim();

  if (!url) {
    showTestResult('Please enter an Apps Script URL first.', 'error');
    return;
  }

  // Validate URL format
  if (!isValidUrl(url)) {
    showTestResult('Please enter a valid URL.', 'error');
    return;
  }

  setButtonLoading(DOM.testConnectionBtn, true);
  hideTestResult();

  try {
    const pingUrl = `${url}${url.includes('?') ? '&' : '?'}action=ping&apiKey=${encodeURIComponent(apiKey)}`;
    const response = await fetch(pingUrl, {
      method: 'GET',
      mode: 'cors',
    });

    if (response.ok) {
      showTestResult('✓ Connection successful!', 'success');
      setStatusConnected();
    } else {
      showTestResult(
        `✗ Server returned ${response.status}. Check your URL.`,
        'error'
      );
      setStatusDisconnected('Connection failed');
    }
  } catch (err) {
    console.error('[Popup] Connection test failed:', err);
    showTestResult(
      '✗ Could not connect. Check the URL and try again.',
      'error'
    );
    setStatusDisconnected('Connection failed');
  } finally {
    setButtonLoading(DOM.testConnectionBtn, false);
  }
}

function setStatusConnected() {
  DOM.statusDot.className = 'status-dot connected';
  DOM.statusText.textContent = 'Connected';
}

function setStatusDisconnected(message = 'Not configured') {
  DOM.statusDot.className = 'status-dot disconnected';
  DOM.statusText.textContent = message;
}

/* ==========================================================================
   Time Entries & Summaries
   ========================================================================== */

/**
 * Load and display the currently running timer if it exists.
 */
async function loadActiveTimer() {
  const result = await chrome.storage.local.get('activeTimer');
  const activeTimer = result.activeTimer;

  if (popupTimerInterval) {
    clearInterval(popupTimerInterval);
    popupTimerInterval = null;
  }

  if (activeTimer) {
    DOM.runningTimerSection.style.display = 'block';
    
    // Set text
    DOM.runningTimerProject.textContent = activeTimer.projectName || 'Unknown Project';
    DOM.runningTimerTask.textContent = activeTimer.taskName || 'Unknown Task';
    DOM.runningTimerTask.title = activeTimer.taskName || '';
    
    // Set link
    const url = activeTimer.pageUrl || activeTimer.taskUrl || '#';
    DOM.runningTimerProject.href = url;

    // Update time every second
    const updateTime = () => {
      const seconds = Math.floor((Date.now() - activeTimer.startedAt) / 1000);
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = seconds % 60;
      DOM.runningTimerTime.textContent = 
        `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };
    
    updateTime();
    popupTimerInterval = setInterval(updateTime, 1000);
  } else {
    DOM.runningTimerSection.style.display = 'none';
  }
}

/**
 * Load recent time entries from storage and render them.
 */
async function loadTimeEntries() {
  try {
    const { timeEntries = [] } = await chrome.storage.local.get('timeEntries');
    updateSummaryCards(timeEntries);
    renderRecentEntries(timeEntries);
  } catch (err) {
    console.error('[Popup] Failed to load time entries:', err);
  }
}

/**
 * Calculate and display today's and this week's total hours.
 * @param {Array} entries - Array of time entry objects
 */
function updateSummaryCards(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    DOM.todayHours.textContent = '0.0';
    DOM.weekHours.textContent = '0.0';
    return;
  }

  const now = new Date();
  const todayStr = toDateString(now);
  const weekStart = getWeekStart(now);
  const weekEnd = getWeekEnd(now);

  let todayTotal = 0;
  let weekTotal = 0;

  for (const entry of entries) {
    const entryDate = entry.timestamp ? new Date(entry.timestamp) : (entry.date ? new Date(entry.date) : null);
    if (!entryDate || isNaN(entryDate)) continue;

    const hours = parseFloat(entry.hours) || 0;
    const entryDateStr = toDateString(entryDate);

    if (entryDateStr === todayStr) {
      todayTotal += hours;
    }

    if (entryDate >= weekStart && entryDate <= weekEnd) {
      weekTotal += hours;
    }
  }

  DOM.todayHours.textContent = todayTotal.toFixed(1);
  DOM.weekHours.textContent = weekTotal.toFixed(1);
}

/**
 * Render the last 5 time entries in the popup.
 * @param {Array} entries - Array of time entry objects
 */
function renderRecentEntries(entries) {
  // Clear existing entries (keep the empty state element)
  const existingItems = DOM.entriesList.querySelectorAll('.entry-item');
  existingItems.forEach((item) => item.remove());

  if (!Array.isArray(entries) || entries.length === 0) {
    DOM.entriesEmpty.style.display = 'flex';
    return;
  }

  DOM.entriesEmpty.style.display = 'none';

  // Sort by date descending, take last 5
  const sorted = [...entries]
    .sort((a, b) => new Date(b.timestamp || b.date || 0) - new Date(a.timestamp || a.date || 0))
    .slice(0, 5);

  for (const entry of sorted) {
    const el = createEntryElement(entry);
    DOM.entriesList.appendChild(el);
  }
}

/**
 * Create a DOM element for a single time entry.
 * @param {Object} entry - Time entry object
 * @returns {HTMLElement}
 */
function createEntryElement(entry) {
  const item = document.createElement('div');
  item.className = 'entry-item';

  const taskName = truncate(entry.task || entry.taskName || entry.todo || 'Untitled task', 40);
  const project = entry.project || entry.projectName || 'Unknown project';
  const hours = (parseFloat(entry.hours) || 0).toFixed(1);
  const dateVal = entry.timestamp || entry.date;
  const timeAgo = dateVal ? getRelativeTime(new Date(dateVal)) : '';

  item.innerHTML = `
    <div class="entry-info">
      <div class="entry-task" title="${escapeHtml(entry.task || entry.taskName || entry.todo || '')}">${escapeHtml(taskName)}</div>
      <div class="entry-project" title="${escapeHtml(entry.project || entry.projectName || '')}">${escapeHtml(project)}</div>
    </div>
    <div class="entry-meta">
      <span class="entry-hours">${hours}h</span>
      <span class="entry-time">${timeAgo}</span>
    </div>
  `;

  return item;
}

/* ==========================================================================
   UI Helpers
   ========================================================================== */

/**
 * Toggle the settings panel open/closed.
 */
function toggleSettings() {
  const isExpanded = DOM.settingsToggle.getAttribute('aria-expanded') === 'true';
  const nowExpanded = !isExpanded;

  DOM.settingsToggle.setAttribute('aria-expanded', String(nowExpanded));
  DOM.settingsPanel.setAttribute('aria-hidden', String(!nowExpanded));
}

/**
 * Show a toast notification.
 * @param {string} message - Toast message text
 * @param {'success'|'error'} type - Toast type
 */
function showToast(message, type = 'success') {
  DOM.toastIcon.textContent = type === 'success' ? '✓' : '✗';
  DOM.toastMessage.textContent = message;
  DOM.toast.classList.add('visible');

  setTimeout(() => {
    DOM.toast.classList.remove('visible');
  }, 2500);
}

/**
 * Show the connection test result message.
 * @param {string} message
 * @param {'success'|'error'} type
 */
function showTestResult(message, type) {
  DOM.testResult.textContent = message;
  DOM.testResult.className = `test-result show ${type}`;
}

/**
 * Hide the connection test result.
 */
function hideTestResult() {
  DOM.testResult.className = 'test-result';
}

/**
 * Toggle loading state on a button.
 * @param {HTMLButtonElement} button
 * @param {boolean} isLoading
 */
function setButtonLoading(button, isLoading) {
  if (isLoading) {
    button.classList.add('loading');
    button.disabled = true;
  } else {
    button.classList.remove('loading');
    button.disabled = false;
  }
}

/**
 * Open Basecamp to the last used account.
 */
async function openBasecamp() {
  try {
    const data = await chrome.storage.local.get(['timeEntries']);
    const entries = data.timeEntries || [];
    
    let basecampUrl = 'https://3.basecamp.com/';
    
    if (entries.length > 0) {
      const lastEntry = entries[0];
      if (lastEntry.url) {
        // Extract the base path: e.g. https://3.basecamp.com/5526083
        const match = lastEntry.url.match(/^(https:\/\/[^/]+\/\d+)/);
        if (match) {
          basecampUrl = match[1];
        } else {
          basecampUrl = lastEntry.url; // Fallback
        }
      }
    }
    
    chrome.tabs.create({ url: basecampUrl });
  } catch (err) {
    console.error('[Popup] Failed to open Basecamp:', err);
    chrome.tabs.create({ url: 'https://3.basecamp.com/' });
  }
}

/* ==========================================================================
   Event Binding
   ========================================================================== */

function bindEvents() {
  // Settings toggle
  DOM.settingsToggle.addEventListener('click', toggleSettings);

  // Save settings
  DOM.saveSettingsBtn.addEventListener('click', saveSettings);

  // Test connection
  DOM.testConnectionBtn.addEventListener('click', testConnection);

  // Open Basecamp
  DOM.openBasecampBtn.addEventListener('click', openBasecamp);
}

/* ==========================================================================
   Message Listener (real-time updates from background)
   ========================================================================== */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'TIME_ENTRIES_UPDATED' || message.type === 'ENTRIES_UPDATED') {
    loadTimeEntries();
    sendResponse({ received: true });
  }

  if (message.type === 'SETTINGS_UPDATED') {
    loadSettings();
    checkConnectionStatus();
    sendResponse({ received: true });
  }

  if (message.type === 'CONNECTION_STATUS') {
    if (message.connected) {
      setStatusConnected();
    } else {
      setStatusDisconnected(message.reason || 'Disconnected');
    }
    sendResponse({ received: true });
  }

  // Return true to keep the message channel open for async responses
  return true;
});

/* ==========================================================================
   Utility Functions
   ========================================================================== */

/**
 * Get a YYYY-MM-DD string for a Date object (local time).
 * @param {Date} date
 * @returns {string}
 */
function toDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Get the start of the current week (Monday 00:00:00).
 * @param {Date} date
 * @returns {Date}
 */
function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  // Shift so Monday = 0
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Get the end of the current week (Sunday 23:59:59).
 * @param {Date} date
 * @returns {Date}
 */
function getWeekEnd(date) {
  const start = getWeekStart(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

/**
 * Get a human-friendly relative time string.
 * @param {Date} date
 * @returns {string}
 */
function getRelativeTime(date) {
  if (!date || isNaN(date)) return '';

  const now = new Date();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay === 1) return 'yesterday';
  if (diffDay < 7) return `${diffDay}d ago`;

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Truncate a string to maxLen characters, appending '…' if truncated.
 * @param {string} str
 * @param {number} maxLen
 * @returns {string}
 */
function truncate(str, maxLen) {
  if (!str || str.length <= maxLen) return str || '';
  return str.slice(0, maxLen - 1) + '…';
}

/**
 * Escape HTML special characters to prevent XSS.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str || ''));
  return div.innerHTML;
}

/**
 * Validate a URL string.
 * @param {string} str
 * @returns {boolean}
 */
function isValidUrl(str) {
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
}
