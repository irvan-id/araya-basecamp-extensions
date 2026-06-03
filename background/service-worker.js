/**
 * Araya Basecamp Extensions — Background Service Worker
 *
 * Responsibilities:
 *  - Handle messages from content script & popup (LOG_TIME, GET_ENTRIES, etc.)
 *  - Persist time entries in chrome.storage.local
 *  - Sync entries to Google Sheets via a Google Apps Script Web App
 *  - Maintain an offline queue and retry unsynced entries every 5 minutes
 *  - Manage a single running timer across navigation
 *  - Aggregate hours for today / this week
 *
 * Storage layout:
 *   chrome.storage.sync  → { userName, appsScriptUrl, spreadsheetUrl }
 *   chrome.storage.local → { timeEntries: [], activeTimer: null | {} }
 */

// ─── Constants ──────────────────────────────────────────────────────────────────

/** Maximum number of entries kept in local storage to avoid quota overflow. */
const MAX_ENTRIES = 500;

/** Name of the Chrome alarm used for periodic sync retries. */
const SYNC_ALARM_NAME = 'syncRetry';

/** Interval (in minutes) between automatic sync retries. */
const SYNC_RETRY_INTERVAL_MINUTES = 5;

// ─── Initialisation ────────────────────────────────────────────────────────────

/**
 * Set up the periodic sync-retry alarm when the service worker starts.
 * chrome.alarms.create is idempotent — calling it again simply resets the alarm.
 */
chrome.alarms.create(SYNC_ALARM_NAME, {
  periodInMinutes: SYNC_RETRY_INTERVAL_MINUTES,
});

// ─── Alarm Listener ─────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === SYNC_ALARM_NAME) {
    await syncPendingEntries();
  }
});

// ─── Message Router ─────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // We must return `true` to indicate we will respond asynchronously.
  handleMessage(message)
    .then(sendResponse)
    .catch((err) => sendResponse({ success: false, error: err.message }));
  return true;
});

/**
 * Route an incoming message to the appropriate handler.
 *
 * @param {object} message – Must contain a `type` property.
 * @returns {Promise<object>} Response payload.
 */
async function handleMessage(message) {
  switch (message.type) {
    case 'LOG_TIME':
      return handleLogTime(message.payload);
    case 'GET_ENTRIES':
      return handleGetEntries(message.payload);
    case 'GET_SUMMARY':
      return handleGetSummary(message.payload);
    case 'SYNC_PENDING':
      return handleSyncPending();
    case 'TEST_CONNECTION':
      return handleTestConnection();
    case 'GET_PROJECT_ENTRIES':
      return handleGetProjectEntries(message.payload);
    case 'UPDATE_ENTRY':
      return handleUpdateEntry(message.payload);
    case 'GET_TIMER_STATE':
      return handleGetTimerState();
    case 'SET_TIMER_STATE':
      return handleSetTimerState(message.payload);
    default:
      return { success: false, error: `Unknown message type: ${message.type}` };
  }
}

// ─── Message Handlers ───────────────────────────────────────────────────────────

/**
 * LOG_TIME — Create a new time entry, persist it, and attempt to sync.
 *
 * @param {object} payload – Partial time entry data (project, task, hours, etc.)
 * @returns {Promise<object>} The created entry wrapped in a success response.
 */
async function handleLogTime(payload) {
  const entry = buildEntry(payload);
  const entries = await loadEntries();

  entries.push(entry);
  await saveEntries(entries);

  // Attempt to sync immediately (non-blocking for the caller).
  syncEntry(entry).catch(() => {
    // Failure is expected offline — the retry alarm will pick it up.
  });

  return { success: true, entry };
}

/**
 * GET_ENTRIES — Return stored time entries, optionally filtered.
 *
 * @param {object} [filters] – Optional { user, date } filters.
 * @returns {Promise<object>}
 */
async function handleGetEntries(filters = {}) {
  let entries = await loadEntries();

  if (filters.user) {
    entries = entries.filter((e) => e.user === filters.user);
  }
  if (filters.date) {
    const targetDate = normaliseDate(filters.date);
    entries = entries.filter((e) => normaliseDate(e.timestamp) === targetDate);
  }

  return { success: true, entries };
}

/**
 * GET_SUMMARY — Aggregate today's and this week's hours for a user.
 *
 * @param {object} [payload] – Optional { user }.
 * @returns {Promise<object>}
 */
async function handleGetSummary(payload = {}) {
  const entries = await loadEntries();
  const user = payload.user || null;

  const todayHours = getTodayHours(entries, user);
  const weekHours = getWeekHours(entries, user);

  return { success: true, todayHours, weekHours };
}

/**
 * SYNC_PENDING — Manually trigger a sync of all unsynced entries.
 *
 * @returns {Promise<object>}
 */
async function handleSyncPending() {
  const result = await syncPendingEntries();
  return { success: true, ...result };
}

/**
 * TEST_CONNECTION — Verify the configured Apps Script URL is reachable.
 *
 * @returns {Promise<object>}
 */
async function handleTestConnection() {
  try {
    const { appsScriptUrl } = await loadSettings();

    if (!appsScriptUrl) {
      return { success: false, error: 'Apps Script URL is not configured.' };
    }

    const response = await fetch(appsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ test: true }),
      redirect: 'follow',
    });

    if (response.ok) {
      // Try to parse the response body for additional info
      let responseData = null;
      try {
        const text = await response.text();
        responseData = JSON.parse(text);
      } catch {
        // Response may not be JSON — that's fine.
      }
      return { success: true, status: response.status, data: responseData };
    }

    return {
      success: false,
      error: `Server responded with status ${response.status}`,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * GET_PROJECT_ENTRIES — Fetch entries for a specific project from Apps Script.
 *
 * @param {object} payload - { project, user, isAdmin }
 * @returns {Promise<object>}
 */
async function handleGetProjectEntries(payload) {
  try {
    const settings = await loadSettings();

    if (!settings.appsScriptUrl) {
      return { success: false, error: 'Apps Script URL is not configured.' };
    }

    const { project, user, isAdmin } = payload;
    
    // Calculate start/end dates for current month
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();

    const queryParams = new URLSearchParams({
      action: 'project_entries',
      apiKey: settings.apiKey || '',
      project: project || '',
      user: user || '',
      isAdmin: isAdmin ? 'true' : 'false',
      startDate: startDate,
      endDate: endDate
    });

    const url = `${settings.appsScriptUrl}${settings.appsScriptUrl.includes('?') ? '&' : '?'}${queryParams.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      mode: 'cors',
    });

    if (response.ok) {
      const data = await response.json();
      if (data.status === 'success') {
        return { success: true, entries: data.entries, totalHours: data.totalHours };
      } else {
        return { success: false, error: data.message };
      }
    }

    return {
      success: false,
      error: `Server responded with status ${response.status}`,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * UPDATE_ENTRY — Edit an existing entry in Google Sheets.
 *
 * @param {object} payload - { entryId, hours?, notes?, task? }
 * @returns {Promise<object>}
 */
async function handleUpdateEntry(payload) {
  try {
    const settings = await loadSettings();

    if (!settings.appsScriptUrl) {
      return { success: false, error: 'Apps Script URL is not configured.' };
    }

    const response = await fetch(settings.appsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'update_entry',
        entryId: payload.entryId,
        hours: payload.hours,
        notes: payload.notes,
        task: payload.task,
        apiKey: settings.apiKey || '',
      }),
      redirect: 'follow',
    });

    if (response.ok) {
      const data = await response.json();
      return { success: data.status === 'success', ...data };
    }

    return { success: false, error: `Server responded with status ${response.status}` };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * GET_TIMER_STATE — Return the currently active timer (or null).
 *
 * @returns {Promise<object>}
 */
async function handleGetTimerState() {
  const timer = await loadTimerState();
  return { success: true, activeTimer: timer };
}

/**
 * SET_TIMER_STATE — Save (or clear) the active timer.
 *
 * When `payload` is `null` or has `action: 'stop'`, the timer is stopped and
 * elapsed time is automatically logged as a new entry.
 *
 * @param {object|null} payload – Timer data or stop instruction.
 * @returns {Promise<object>}
 */
async function handleSetTimerState(payload) {
  // ── Stop / clear timer ────────────────────────────────────────────────
  if (!payload || payload.action === 'stop') {
    const currentTimer = await loadTimerState();

    if (currentTimer) {
      // Calculate elapsed hours and log the entry automatically.
      const elapsedMs = Date.now() - new Date(currentTimer.startTime).getTime();
      const elapsedHours = parseFloat((elapsedMs / 3_600_000).toFixed(2));

      if (elapsedHours > 0) {
        await handleLogTime({
          user: currentTimer.user || '',
          project: currentTimer.project || '',
          task: currentTimer.taskName || '',
          hours: elapsedHours,
          notes: `Timer: ${formatDuration(elapsedMs)}`,
          url: currentTimer.url || '',
        });
      }
    }

    await saveTimerState(null);
    return { success: true, activeTimer: null };
  }

  // ── Start / update timer ──────────────────────────────────────────────
  const timerState = {
    taskId: payload.taskId || '',
    taskName: payload.taskName || '',
    project: payload.project || '',
    url: payload.url || '',
    user: payload.user || '',
    startTime: payload.startTime || new Date().toISOString(),
  };

  await saveTimerState(timerState);
  return { success: true, activeTimer: timerState };
}

// ─── Entry Helpers ──────────────────────────────────────────────────────────────

/**
 * Build a complete time-entry object from a partial payload.
 *
 * @param {object} data – Partial entry data.
 * @returns {object} Full time-entry object.
 */
function buildEntry(data) {
  return {
    id: generateId(),
    user: data.user || '',
    project: data.project || '',
    task: data.task || '',
    hours: typeof data.hours === 'number' ? data.hours : parseFloat(data.hours) || 0,
    notes: data.notes || '',
    url: data.url || '',
    type: data.type || 'unknown',
    timestamp: data.timestamp || new Date().toISOString(),
    synced: false,
    syncError: '',
  };
}

/**
 * Generate a unique ID composed of a timestamp and a short random suffix.
 *
 * @returns {string}
 */
function generateId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}`;
}

// ─── Google Sheets Sync ─────────────────────────────────────────────────────────

/**
 * Attempt to sync a single entry to Google Sheets via the Apps Script Web App.
 *
 * Google Apps Script Web Apps return a 302 redirect to
 * `script.googleusercontent.com` — the fetch `redirect: 'follow'` option
 * handles this transparently.
 *
 * We send the body as `text/plain` (stringified JSON) to avoid triggering a
 * CORS preflight request.
 *
 * @param {object} entry – The time-entry to sync.
 * @returns {Promise<boolean>} `true` if sync succeeded.
 */
async function syncEntry(entry) {
  const settings = await loadSettings();

  if (!settings.appsScriptUrl) {
    await markEntrySyncError(entry.id, 'Apps Script URL not configured.');
    return false;
  }

  try {
    const response = await fetch(settings.appsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        id: entry.id,
        user: entry.user,
        project: entry.project,
        task: entry.task,
        hours: entry.hours,
        notes: entry.notes,
        url: entry.url,
        timestamp: entry.timestamp,
        type: entry.type || 'unknown',
        apiKey: settings.apiKey || '',
      }),
      redirect: 'follow',
    });

    if (response.ok) {
      await markEntrySynced(entry.id);
      broadcastSyncUpdate(entry.id, true);
      return true;
    }

    const errorText = await response.text().catch(() => 'Unknown error');
    await markEntrySyncError(entry.id, `HTTP ${response.status}: ${errorText}`);
    return false;
  } catch (err) {
    // Network error (offline, DNS failure, etc.)
    await markEntrySyncError(entry.id, err.message);
    return false;
  }
}

/**
 * Iterate over all unsynced entries and attempt to sync each one.
 *
 * @returns {Promise<{ synced: number, failed: number }>}
 */
async function syncPendingEntries() {
  const entries = await loadEntries();
  const pending = entries.filter((e) => !e.synced);

  if (pending.length === 0) {
    return { synced: 0, failed: 0 };
  }

  let synced = 0;
  let failed = 0;

  for (const entry of pending) {
    const ok = await syncEntry(entry);
    if (ok) {
      synced++;
    } else {
      failed++;
    }
  }

  return { synced, failed };
}

// ─── Data Aggregation ───────────────────────────────────────────────────────────

/**
 * Sum hours for entries logged today.
 *
 * @param {object[]} entries – All time entries.
 * @param {string|null} userName – Optional user filter.
 * @returns {number} Total hours today (rounded to 2 decimal places).
 */
function getTodayHours(entries, userName) {
  const today = normaliseDate(new Date().toISOString());

  const filtered = entries.filter((e) => {
    const matchDate = normaliseDate(e.timestamp) === today;
    const matchUser = userName ? e.user === userName : true;
    return matchDate && matchUser;
  });

  return roundHours(filtered.reduce((sum, e) => sum + e.hours, 0));
}

/**
 * Sum hours for entries logged in the current week (Monday → Sunday).
 *
 * @param {object[]} entries – All time entries.
 * @param {string|null} userName – Optional user filter.
 * @returns {number} Total hours this week (rounded to 2 decimal places).
 */
function getWeekHours(entries, userName) {
  const { weekStart, weekEnd } = getCurrentWeekBounds();

  const filtered = entries.filter((e) => {
    const entryDate = new Date(e.timestamp);
    const inWeek = entryDate >= weekStart && entryDate <= weekEnd;
    const matchUser = userName ? e.user === userName : true;
    return inWeek && matchUser;
  });

  return roundHours(filtered.reduce((sum, e) => sum + e.hours, 0));
}

/**
 * Get the start (Monday 00:00) and end (Sunday 23:59:59.999) of the current week.
 *
 * @returns {{ weekStart: Date, weekEnd: Date }}
 */
function getCurrentWeekBounds() {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, …

  // Convert to Monday-based index (Mon=0 … Sun=6).
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - mondayOffset);
  weekStart.setHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  return { weekStart, weekEnd };
}

/**
 * Extract a YYYY-MM-DD string from an ISO 8601 timestamp.
 *
 * @param {string} isoString
 * @returns {string}
 */
function normaliseDate(isoString) {
  return new Date(isoString).toISOString().split('T')[0];
}

/**
 * Round a number to two decimal places.
 *
 * @param {number} n
 * @returns {number}
 */
function roundHours(n) {
  return Math.round(n * 100) / 100;
}

// ─── Storage Helpers ────────────────────────────────────────────────────────────

/**
 * Load time entries from chrome.storage.local.
 *
 * @returns {Promise<object[]>}
 */
async function loadEntries() {
  const result = await chrome.storage.local.get('timeEntries');
  return result.timeEntries || [];
}

/**
 * Save time entries to chrome.storage.local, trimming to MAX_ENTRIES.
 *
 * Oldest entries are removed first when the cap is exceeded.
 *
 * @param {object[]} entries
 */
async function saveEntries(entries) {
  // Keep only the most recent MAX_ENTRIES.
  const trimmed = entries.length > MAX_ENTRIES
    ? entries.slice(entries.length - MAX_ENTRIES)
    : entries;

  await chrome.storage.local.set({ timeEntries: trimmed });
}

/**
 * Mark a specific entry as successfully synced.
 *
 * @param {string} entryId
 */
async function markEntrySynced(entryId) {
  const entries = await loadEntries();
  const entry = entries.find((e) => e.id === entryId);
  if (entry) {
    entry.synced = true;
    entry.syncError = '';
    await saveEntries(entries);
  }
}

/**
 * Store a sync error against a specific entry.
 *
 * @param {string} entryId
 * @param {string} errorMessage
 */
async function markEntrySyncError(entryId, errorMessage) {
  const entries = await loadEntries();
  const entry = entries.find((e) => e.id === entryId);
  if (entry) {
    entry.synced = false;
    entry.syncError = errorMessage;
    await saveEntries(entries);
  }
}

/**
 * Load user settings from chrome.storage.sync.
 *
 * @returns {Promise<{ userName: string, appsScriptUrl: string, spreadsheetUrl: string }>}
 */
async function loadSettings() {
  const result = await chrome.storage.sync.get([
    'userName',
    'appsScriptUrl',
    'spreadsheetUrl',
    'apiKey',
  ]);
  return {
    userName: result.userName || '',
    appsScriptUrl: result.appsScriptUrl || '',
    spreadsheetUrl: result.spreadsheetUrl || '',
    apiKey: result.apiKey || '',
  };
}

/**
 * Load the active timer state from chrome.storage.local.
 *
 * @returns {Promise<object|null>}
 */
async function loadTimerState() {
  const result = await chrome.storage.local.get('activeTimer');
  return result.activeTimer || null;
}

/**
 * Save (or clear) the active timer state in chrome.storage.local.
 *
 * @param {object|null} timerState
 */
async function saveTimerState(timerState) {
  await chrome.storage.local.set({ activeTimer: timerState });
}

// ─── Broadcast Helpers ──────────────────────────────────────────────────────────

/**
 * Notify all extension contexts (popup, content scripts) that an entry's sync
 * status has changed. Failures are silently ignored — the recipient may not
 * be open.
 *
 * @param {string} entryId
 * @param {boolean} synced
 */
function broadcastSyncUpdate(entryId, synced) {
  chrome.runtime.sendMessage({
    type: 'SYNC_STATUS_UPDATE',
    payload: { entryId, synced },
  }).catch(() => {
    // No listeners — popup / content script might be closed. That's fine.
  });
}

// ─── Utility ────────────────────────────────────────────────────────────────────

/**
 * Format a duration in milliseconds as "Xh Ym".
 *
 * @param {number} ms – Duration in milliseconds.
 * @returns {string}
 */
function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}
