const fs = require('fs');

const path = '/Users/irvan/Documents/GitProject/araya-basecamp-extensions/content/content.js';
let code = fs.readFileSync(path, 'utf8');

// 1. Add applyTheme
code = code.replace(/async function init\(\) \{[\s\S]*?try \{[\s\S]*?await loadCachedData\(\);/,
  `async function init() {\n    try {\n      await loadCachedData();\n      applyTheme();`
);

const applyThemeCode = `
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
`;
if (!code.includes('function applyTheme()')) {
  code = code.replace('function detectUserProfile() {', applyThemeCode + '\n  function detectUserProfile() {');
}

// 2. buildModeTabs
code = code.replace(/function buildModeTabs\(\) \{[\s\S]*?return \{ tabs, manualSection, timerSection \};\n  \}/, 
`function buildModeTabs(currentTaskUrl) {
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
  }`);

// 3. openModal and saveBtn
const openModalRegex = /const \{ tabs, manualSection, timerSection \} = buildModeTabs\(\);([\s\S]*?)saveBtn\.addEventListener\('click', async \(\) => \{([\s\S]*?)const notes =([\s\S]*?)\.trim\(\);\n\n      saveBtn\.disabled = true;/;
code = code.replace(openModalRegex, (match, p1, p2, p3) => {
  let rep = p1.replace(`buildFormGroup('Notes', notesManual)`, `(() => { const g = buildFormGroup('Notes', notesManual); g.classList.add('bctl-notes-group'); return g; })()`);
  rep = rep.replace(`buildFormGroup('Notes', notesTimer)`, `(() => { const g = buildFormGroup('Notes', notesTimer); g.classList.add('bctl-notes-group'); return g; })()`);
  
  // Timer UI replacement
  const timerUiOld = `
    const timerBtn = document.createElement('button');
    timerBtn.type = 'button';
    timerBtn.className = 'bctl-btn bctl-btn-timer';
    timerBtn.innerHTML = '▶ Start';

    // If this task already has an active timer, show running state
    if (activeTimer && activeTimer.taskUrl === taskUrl) {
      const elapsed = getElapsedSeconds();
      timerTime.innerHTML = formatTimeHTML(elapsed);
      timerTime.classList.add('bctl-running');
      timerBtn.classList.add('bctl-active');
      timerBtn.innerHTML = '■ Stop';
      timerHint.textContent = 'Timer is running…';
      startModalTimerDisplay(timerTime);
    }

    timerBtn.addEventListener('click', () => {
      if (activeTimer && activeTimer.taskUrl === taskUrl) {
        // Stop the timer
        const elapsed = getElapsedSeconds();
        stopTimer();
        timerTime.classList.remove('bctl-running');
        timerBtn.classList.remove('bctl-active');
        timerBtn.innerHTML = '▶ Start';
        timerHint.textContent = \`Stopped at \${formatTime(elapsed)}\`;
        hoursInput.value = (elapsed / 3600).toFixed(2);
      } else {
        // Only one timer at a time
        if (activeTimer) {
          showToast('Another timer is already running. Stop it first.', 'error');
          return;
        }
        startTimer(taskUrl, taskName, projectName);
        timerTime.classList.add('bctl-running');
        timerBtn.classList.add('bctl-active');
        timerBtn.innerHTML = '■ Stop';
        timerHint.textContent = 'Timer is running…';
        startModalTimerDisplay(timerTime);
        updateAllTimerButtons();
      }
    });

    const notesTimer = document.createElement('textarea');
    notesTimer.className = 'bctl-textarea';
    notesTimer.placeholder = 'What did you work on?';

    timerDisplay.appendChild(timerTime);
    timerDisplay.appendChild(timerHint);
    timerDisplay.appendChild(timerBtn);`;

  const timerUiNew = `
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
        timerHint.textContent = \`Stopped at \${formatTime(elapsed)}\`;
        hoursInput.value = (elapsed / 3600).toFixed(2);
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
    timerDisplay.appendChild(btnContainer);`;

  rep = rep.replace(timerUiOld.trim(), timerUiNew.trim());

  // Wait, I need to make sure timerUiOld string actually matches exactly. The regex approach is safer.
  
  const saveCheck = `
      if (lastSelectedMode === 'timer' && activeTimer && activeTimer.taskUrl === taskUrl) {
        showToast('Tolong berhentikan timer terlebih dahulu (Stop) sebelum menyimpan.', 'error');
        return;
      }`;
  
  return `const { tabs, manualSection, timerSection, manualTab } = buildModeTabs(taskUrl);\n` +
         rep +
         `saveBtn.addEventListener('click', async () => {\n` + saveCheck + p2 + `const notes =` + p3 + `.trim();\n\n      saveBtn.disabled = true;`;
});

// Since the string replacement for TimerUI might fail if formatting is slightly different, 
// let's do it via regex instead
const timerUiOldRegex = /const timerBtn = document\.createElement\('button'\);[\s\S]*?timerDisplay\.appendChild\(timerBtn\);/;
const timerUiNewRegex = `    const pauseBtn = document.createElement('button');
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
        timerHint.textContent = \`Stopped at \${formatTime(elapsed)}\`;
        hoursInput.value = (elapsed / 3600).toFixed(2);
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
    timerDisplay.appendChild(btnContainer);`;

code = code.replace(timerUiOldRegex, timerUiNewRegex);

// Also set default tab mode to timer at the bottom of openModal
code = code.replace(/lastSelectedMode = mode;[\s\S]*?if \(activeTimer && activeTimer\.taskUrl === taskUrl\) \{[\s\S]*?switchTab\('timer'\);[\s\S]*?\} else \{[\s\S]*?switchTab\(lastSelectedMode\);[\s\S]*?\}/,
`lastSelectedMode = mode;
    }

    switchTab('timer');`);


// 4. Timer State Functions
const timerFunctionsOld = /function startTimer\([\s\S]*?function restoreRunningTimer\(\) \{[\s\S]*?\}/;
const timerFunctionsNew = `function startTimer(taskUrl, taskName, projectName) {
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
  }`;

code = code.replace(timerFunctionsOld, timerFunctionsNew);

fs.writeFileSync(path, code);
