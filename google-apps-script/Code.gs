/**
 * Araya Basecamp Extensions — Google Apps Script Backend
 *
 * This script is deployed as a Web App and serves as the backend
 * for the Araya Basecamp Extensions Chrome extension.
 *
 * It receives time tracking entries via POST and returns user-specific
 * summaries via GET. All requests are validated with an API key stored
 * in Script Properties.
 *
 * Sheet Format:
 *   A=Timestamp | B=User | C=Project | D=Task | E=Hours (decimal)
 *   F=Notes | G=Basecamp URL | H=Entry ID
 */

// ─── Constants ───────────────────────────────────────────────────────
var SHEET_NAME = 'Timesheet';
var HEADERS = [
  'Timestamp',
  'User',
  'Project',
  'Task',
  'Hours (decimal)',
  'Durasi',
  'Notes',
  'Basecamp URL',
  'Entry ID',
  'Type'
];

// ─── Web App Endpoints ──────────────────────────────────────────────

/**
 * doPost — Receives time entries from the Chrome extension.
 *
 * Expected JSON payload:
 *   { user, project, task, hours, notes, url, timestamp, apiKey }
 *
 * @param {Object} e - The event object from the web app request.
 * @returns {TextOutput} JSON response with status and message.
 */
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    // Validate API key
    if (!validateApiKey(data.apiKey)) {
      return buildJsonResponse({
        status: 'error',
        message: 'Invalid API key'
      });
    }

    // ── UPDATE existing entry ──
    if (data.action === 'update_entry') {
      return updateEntry(data);
    }

    // Validate required fields
    if (!data.user || !data.project || !data.hours) {
      return buildJsonResponse({
        status: 'error',
        message: 'Missing required fields: user, project, and hours are required'
      });
    }

    // Get or create the sheet and ensure headers
    var sheet = getOrCreateSheet();
    ensureHeaders(sheet);

    // Generate a unique entry ID
    var entryId = Utilities.getUuid();

    // Parse the timestamp or use current time
    var timestamp = data.timestamp ? new Date(data.timestamp) : new Date();
    var hours = parseFloat(data.hours) || 0;

    // Append the new row
    sheet.appendRow([
      timestamp,
      data.user || '',
      data.project || '',
      data.task || '',
      hours,
      formatDurasi(hours),
      data.notes || '',
      data.url || '',
      entryId,
      data.type || 'unknown'
    ]);

    // Format the newly added row
    var lastRow = sheet.getLastRow();
    formatRow(sheet, lastRow);

    return buildJsonResponse({
      status: 'success',
      message: 'Time entry logged',
      entryId: entryId
    });

  } catch (error) {
    return buildJsonResponse({
      status: 'error',
      message: error.toString()
    });
  }
}

/**
 * doGet — Returns data for the Chrome extension.
 *
 * Supported actions:
 *   - ping:    Connection test, returns { status: 'ok' }
 *   - summary: Returns time entries for the specified user only
 *
 * Parameters: action, user, apiKey, startDate (optional), endDate (optional)
 *
 * DATA ACCESS RESTRICTION:
 *   Only entries where the User column matches the requested user are returned.
 *   This ensures team members can only see their own data.
 *
 * @param {Object} e - The event object from the web app request.
 * @returns {TextOutput} JSON response.
 */
function doGet(e) {
  try {
    var params = e.parameter || {};
    var action = params.action || '';
    var apiKey = params.apiKey || '';

    // ── Ping action (no API key required for basic connectivity check) ──
    if (action === 'ping') {
      // Still validate API key for ping to confirm full configuration
      if (!validateApiKey(apiKey)) {
        return buildJsonResponse({
          status: 'error',
          message: 'Invalid API key'
        });
      }
      return buildJsonResponse({ status: 'ok' });
    }

    // ── All other actions require valid API key ──
    if (!validateApiKey(apiKey)) {
      return buildJsonResponse({
        status: 'error',
        message: 'Invalid API key'
      });
    }

    // ── Summary action ──
    if (action === 'summary') {
      var user = params.user || '';

      if (!user) {
        return buildJsonResponse({
          status: 'error',
          message: 'User parameter is required for summary'
        });
      }

      var sheet = getOrCreateSheet();
      ensureHeaders(sheet);

      var entries = getUserEntries(sheet, user, params.startDate, params.endDate);
      var summary = calculateSummary(entries);

      return buildJsonResponse({
        status: 'success',
        entries: entries,
        todayHours: summary.todayHours,
        weekHours: summary.weekHours
      });
    }

    // ── Project Entries action ──
    if (action === 'project_entries') {
      var user = params.user || '';
      var project = params.project || '';
      var isAdmin = params.isAdmin === 'true';

      if (!project) {
        return buildJsonResponse({
          status: 'error',
          message: 'Project parameter is required for project_entries'
        });
      }
      if (!user && !isAdmin) {
        return buildJsonResponse({
          status: 'error',
          message: 'User parameter is required for non-admin requests'
        });
      }

      var sheet = getOrCreateSheet();
      ensureHeaders(sheet);

      var entries = getProjectEntries(sheet, project, user, isAdmin, params.startDate, params.endDate);
      
      var totalHours = 0;
      for (var i = 0; i < entries.length; i++) {
        totalHours += entries[i].hours;
      }

      return buildJsonResponse({
        status: 'success',
        entries: entries,
        totalHours: Math.round(totalHours * 100) / 100
      });
    }

    // ── Unknown action ──
    return buildJsonResponse({
      status: 'error',
      message: 'Unknown action: ' + action
    });

  } catch (error) {
    return buildJsonResponse({
      status: 'error',
      message: error.toString()
    });
  }
}

// ─── Helper Functions ────────────────────────────────────────────────

/**
 * Ensures the header row exists in the sheet.
 * If the sheet is empty or the first row doesn't match expected headers,
 * a header row is inserted and formatted.
 *
 * @param {Sheet} sheet - The Google Sheet object.
 */
function ensureHeaders(sheet) {
  var firstRow = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  var hasHeaders = firstRow[0] === HEADERS[0] && firstRow[1] === HEADERS[1];

  if (!hasHeaders) {
    // Insert headers at row 1
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);

    // Format header row
    var headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
    headerRange
      .setFontWeight('bold')
      .setBackground('#4285F4')
      .setFontColor('#FFFFFF')
      .setHorizontalAlignment('center');

    // Freeze header row
    sheet.setFrozenRows(1);

    // Set column widths for readability
    sheet.setColumnWidth(1, 180); // Timestamp
    sheet.setColumnWidth(2, 150); // User
    sheet.setColumnWidth(3, 200); // Project
    sheet.setColumnWidth(4, 200); // Task
    sheet.setColumnWidth(5, 120); // Hours
    sheet.setColumnWidth(6, 120); // Durasi
    sheet.setColumnWidth(7, 250); // Notes
    sheet.setColumnWidth(8, 300); // Basecamp URL
    sheet.setColumnWidth(9, 280); // Entry ID
    sheet.setColumnWidth(10, 100); // Type

    // Set number format for Hours column
    sheet.getRange('E:E').setNumberFormat('0.00');

    // Set date format for Timestamp column
    sheet.getRange('A:A').setNumberFormat('yyyy-MM-dd HH:mm:ss');
  }
}

/**
 * Validates the provided API key against the one stored in Script Properties.
 *
 * @param {string} providedKey - The API key from the request.
 * @returns {boolean} True if the key matches.
 */
function validateApiKey(providedKey) {
  if (!providedKey) return false;

  var storedKey = PropertiesService.getScriptProperties().getProperty('API_KEY');
  if (!storedKey) {
    // No API key configured — reject all requests
    return false;
  }

  return providedKey === storedKey;
}

/**
 * Gets the 'Timesheet' sheet, creating it if it doesn't exist.
 *
 * @returns {Sheet} The Timesheet sheet object.
 */
function getOrCreateSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  return sheet;
}

/**
 * Retrieves time entries for a specific user, optionally filtered by date range.
 *
 * DATA ACCESS RESTRICTION:
 *   Only rows where the User column (B) exactly matches the requested user
 *   are returned. This ensures team members can only view their own data.
 *
 * @param {Sheet} sheet - The Google Sheet object.
 * @param {string} user - The username to filter by.
 * @param {string} [startDate] - Optional start date string (inclusive).
 * @param {string} [endDate] - Optional end date string (inclusive).
 * @returns {Array<Object>} Array of entry objects.
 */
function getUserEntries(sheet, user, startDate, endDate) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return []; // No data rows

  var dataRange = sheet.getRange(2, 1, lastRow - 1, HEADERS.length);
  var data = dataRange.getValues();
  var entries = [];

  var filterStart = startDate ? new Date(startDate) : null;
  var filterEnd = endDate ? new Date(endDate) : null;

  // Set filterEnd to end of day if provided
  if (filterEnd) {
    filterEnd.setHours(23, 59, 59, 999);
  }

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var rowUser = row[1].toString().trim();

    // DATA ACCESS RESTRICTION: only return entries matching the requested user
    if (rowUser !== user) continue;

    var rowTimestamp = new Date(row[0]);

    // Apply date range filter if provided
    if (filterStart && rowTimestamp < filterStart) continue;
    if (filterEnd && rowTimestamp > filterEnd) continue;

    entries.push({
      timestamp: rowTimestamp.toISOString(),
      user: rowUser,
      project: row[2] || '',
      task: row[3] || '',
      hours: parseFloat(row[4]) || 0,
      duration: row[5] || '',
      notes: row[6] || '',
      url: row[7] || '',
      id: row[8] || '',
      type: row[9] || 'unknown'
    });
  }

  return entries;
}

/**
 * Retrieves time entries for a specific project.
 * 
 * DATA ACCESS RESTRICTION:
 *   If isAdmin is true, returns all entries for the project.
 *   If isAdmin is false, only returns entries matching the user parameter.
 *
 * @param {Sheet} sheet - The Google Sheet object.
 * @param {string} project - The project name to filter by.
 * @param {string} user - The username of the requester.
 * @param {boolean} isAdmin - Whether the requester is an admin.
 * @param {string} [startDate] - Optional start date string (inclusive).
 * @param {string} [endDate] - Optional end date string (inclusive).
 * @returns {Array<Object>} Array of entry objects.
 */
function getProjectEntries(sheet, project, user, isAdmin, startDate, endDate) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return []; // No data rows

  var dataRange = sheet.getRange(2, 1, lastRow - 1, HEADERS.length);
  var data = dataRange.getValues();
  var entries = [];

  var filterStart = startDate ? new Date(startDate) : null;
  var filterEnd = endDate ? new Date(endDate) : null;

  if (filterEnd) {
    filterEnd.setHours(23, 59, 59, 999);
  }

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var rowProject = row[2] ? row[2].toString().trim() : '';
    
    if (rowProject !== project) continue;

    var rowUser = row[1] ? row[1].toString().trim() : '';
    
    // DATA ACCESS RESTRICTION
    if (!isAdmin && rowUser !== user) continue;

    var rowTimestamp = new Date(row[0]);

    if (filterStart && rowTimestamp < filterStart) continue;
    if (filterEnd && rowTimestamp > filterEnd) continue;

    entries.push({
      timestamp: rowTimestamp.toISOString(),
      user: rowUser,
      project: rowProject,
      task: row[3] || '',
      hours: parseFloat(row[4]) || 0,
      duration: row[5] || '',
      notes: row[6] || '',
      url: row[7] || '',
      id: row[8] || '',
      type: row[9] || 'unknown'
    });
  }

  return entries;
}

/**
 * Calculates summary totals from a list of entries.
 *
 * @param {Array<Object>} entries - Array of entry objects.
 * @returns {Object} Summary with todayHours and weekHours.
 */
function calculateSummary(entries) {
  var now = new Date();

  // Today: start of day
  var todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // This week: Monday start
  var weekStart = new Date(todayStart);
  var dayOfWeek = weekStart.getDay(); // 0=Sun, 1=Mon, ...
  var diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  weekStart.setDate(weekStart.getDate() - diffToMonday);

  var todayHours = 0;
  var weekHours = 0;

  for (var i = 0; i < entries.length; i++) {
    var entryDate = new Date(entries[i].timestamp);
    var hours = entries[i].hours || 0;

    // Check if entry is from today
    if (entryDate >= todayStart) {
      todayHours += hours;
    }

    // Check if entry is from this week (Monday to now)
    if (entryDate >= weekStart) {
      weekHours += hours;
    }
  }

  return {
    todayHours: Math.round(todayHours * 100) / 100,
    weekHours: Math.round(weekHours * 100) / 100
  };
}

/**
 * Formats a data row (timestamp and hours columns).
 *
 * @param {Sheet} sheet - The Google Sheet object.
 * @param {number} row - The row number to format.
 */
function formatRow(sheet, row) {
  // Format Timestamp column (A)
  sheet.getRange(row, 1).setNumberFormat('yyyy-MM-dd HH:mm:ss');

  // Format Hours column (E) with 2 decimal places
  sheet.getRange(row, 5).setNumberFormat('0.00');
}

/**
 * Convert decimal hours to "Xj Ym" format for the Durasi column.
 *
 * @param {number} decimalHours - Hours in decimal format.
 * @returns {string} Formatted duration string.
 */
function formatDurasi(decimalHours) {
  var totalMinutes = Math.round(decimalHours * 60);
  var h = Math.floor(totalMinutes / 60);
  var m = totalMinutes % 60;
  if (h === 0) return m + 'm';
  if (m === 0) return h + 'j';
  return h + 'j ' + m + 'm';
}

/**
 * Update an existing entry by its Entry ID.
 *
 * @param {Object} data - { entryId, hours?, notes?, task?, apiKey }
 * @returns {TextOutput} JSON response.
 */
function updateEntry(data) {
  var entryId = data.entryId;
  if (!entryId) {
    return buildJsonResponse({ status: 'error', message: 'Missing entryId' });
  }

  var sheet = getOrCreateSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return buildJsonResponse({ status: 'error', message: 'No data rows found' });
  }

  // Entry ID is in column I (9)
  var idRange = sheet.getRange(2, 9, lastRow - 1, 1).getValues();

  for (var i = 0; i < idRange.length; i++) {
    if (idRange[i][0] === entryId) {
      var row = i + 2; // 1-indexed + header offset

      if (data.task !== undefined) {
        sheet.getRange(row, 4).setValue(data.task);  // Task = col D
      }
      if (data.hours !== undefined) {
        var hours = parseFloat(data.hours) || 0;
        sheet.getRange(row, 5).setValue(hours);             // Hours = col E
        sheet.getRange(row, 6).setValue(formatDurasi(hours)); // Durasi = col F
        sheet.getRange(row, 5).setNumberFormat('0.00');
      }
      if (data.notes !== undefined) {
        sheet.getRange(row, 7).setValue(data.notes); // Notes = col G
      }

      return buildJsonResponse({ status: 'success', message: 'Entry updated' });
    }
  }

  return buildJsonResponse({ status: 'error', message: 'Entry not found: ' + entryId });
}

/**
 * Builds a JSON text output response for the web app.
 *
 * @param {Object} data - The data to serialize as JSON.
 * @returns {TextOutput} A ContentService TextOutput with JSON MIME type.
 */
function buildJsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
