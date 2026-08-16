/**
 * Super-Sudoku-16 UI & Game Controller
 * Manages grid rendering, keyboard/mouse events, game progress, Web Audio sound synthesis,
 * history stack (undo/redo), and animated theme shifts.
 */

// Core state
let boardState = Array(16).fill(0).map(() => Array(16).fill(0));
let solutionState = Array(16).fill(0).map(() => Array(16).fill(0));
let givenMask = Array(16).fill(0).map(() => Array(16).fill(false));
let notesState = Array(16).fill(0).map(() => Array(16).fill(0).map(() => Array(17).fill(false))); // 1-indexed

let selectedCell = null;
let notesMode = false;
let clueMode = false;
let clueSelectedCells = [];
let isDragging = false;
let dragStartCell = null;
let assistanceMode = 'MASTER'; // 'JUNIOR' (Alerts ON) vs 'MASTER' (Alerts OFF) - Elite Default
let soundEnabled = true;
let timerInterval = null;
let secondsElapsed = 0;
let timerVisible = true;
let currentDifficulty = 'intermediate';
let currentDocNum = '-';
let isPaused = false;
let activeStatusLog = "System Ready. Choose difficulty and click 'Start 🏁' to begin.";

// Elite monetization & time limits state
let tokens = 5;
let lastTicketDate = '';
let isLocked = false;
let isGameOver = false;
let puzzleStartTimestamp = 0;
let currentUnlockedHours = 1;
let adsShown = { 900: false, 1800: false, 2700: false, 4500: false, 5400: false, 6300: false };
let isAdPlaying = false;
const MAX_GAME_SECONDS = 3600; // 1 hour time limit


// History stack for undo/redo
let historyStack = [];
let historyPointer = -1;

// Web Audio API Context
let audioCtx = null;

// Double-key input helper (typing '1' then '2' -> '12')
let lastKeypressTime = 0;
let lastKeyPressed = '';

// Confetti Particle System
let confettiParticles = [];
let confettiAnimationId = null;

// Initialize DLX Engine
const dlxEngine = new SudokuDLX();

/* ==========================================================================
   1. System Initialization
   ========================================================================== */

window.onload = () => {
  initGrid();
  renderKeypad();
  setupKeyboardListeners();
  initButtonHoverHelp();
  
  loadTokensAndTickets();
  document.getElementById('alertToggleBtn').innerText = (assistanceMode === 'JUNIOR') ? 'ON' : 'OFF';
  
  // Try to restore previous game. If none, render empty board so they choose level and click Start.
  if (!loadGameState()) {
    renderBoard();
    document.getElementById('statTimer').innerText = '00:00:00';
    writeToConsoleLog("Welcome to Super-Sudoku-16! Select a difficulty and click 'Start 🏁' to begin.");
  }
};

// Creates the 16x16 interactive DOM grid
function initGrid() {
  const gridEl = document.getElementById('grid');
  gridEl.innerHTML = '';

  for (let r = 0; r < 16; r++) {
    for (let c = 0; c < 16; c++) {
      const cell = document.createElement('div');
      cell.classList.add('cell');
      cell.id = `cell-${r}-${c}`;
      
      // Determine 4x4 sub-box checkerboard background
      const boxRow = Math.floor(r / 4);
      const boxCol = Math.floor(c / 4);
      if ((boxRow + boxCol) % 2 === 0) {
        cell.classList.add('box-even');
      }

      // Add thick borders for 4x4 subgrids
      if ((c + 1) % 4 === 0 && c !== 15) {
        cell.classList.add('border-right-thick');
      }
      if ((r + 1) % 4 === 0 && r !== 15) {
        cell.classList.add('border-bottom-thick');
      }

      // Drag selection events (Clue mode) and standard select
      cell.addEventListener('mousedown', (e) => {
        if (isPaused || isLocked || isGameOver || isAdPlaying) return;
        e.stopPropagation();
        if (clueMode) {
          e.preventDefault();
          isDragging = true;
          dragStartCell = { r, c };
          clueSelectedCells = [{ r, c }];
          renderHighlights();
        } else {
          selectCell(r, c);
        }
      });

      cell.addEventListener('mouseenter', () => {
        if (isPaused || isLocked || isGameOver || isAdPlaying) return;
        if (clueMode && isDragging && dragStartCell) {
          calculateDragRange(dragStartCell, { r, c });
          renderHighlights();
        }
      });

      cell.addEventListener('touchstart', (e) => {
        if (isPaused || isLocked || isGameOver || isAdPlaying) return;
        e.stopPropagation();
        if (clueMode) {
          e.preventDefault();
          isDragging = true;
          dragStartCell = { r, c };
          clueSelectedCells = [{ r, c }];
          renderHighlights();
        } else {
          selectCell(r, c);
        }
      });

      cell.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        showFloatingKeypad(e, r, c);
      });

      cell.addEventListener('click', (e) => {
        e.stopPropagation();
      });

      gridEl.appendChild(cell);
    }
  }

  // Clicking outside cell deselects and hides floating overlays
  document.addEventListener('click', (e) => {
    if (e.target.closest('.billdoku-grid') || e.target.closest('.keypad-panel')) {
      return;
    }
    deselectCell();
    hideFloatingKeypad();
  });

  // Global drag stop listeners
  document.addEventListener('mouseup', () => {
    if (clueMode && isDragging) {
      isDragging = false;
    }
  });

  document.addEventListener('touchend', () => {
    if (clueMode && isDragging) {
      isDragging = false;
    }
  });

  // Touch move tracking for drag-select on mobile
  document.addEventListener('touchmove', (e) => {
    if (clueMode && isDragging && dragStartCell) {
      const touch = e.touches[0];
      const element = document.elementFromPoint(touch.clientX, touch.clientY);
      if (element && element.classList.contains('cell')) {
        const parts = element.id.split('-');
        if (parts.length === 3) {
          const r = parseInt(parts[1], 10);
          const c = parseInt(parts[2], 10);
          calculateDragRange(dragStartCell, { r, c });
          renderHighlights();
        }
      }
    }
  }, { passive: false });
}

function calculateDragRange(start, end) {
  clueSelectedCells = [];
  const rStart = start.r;
  const cStart = start.c;
  const rEnd = end.r;
  const cEnd = end.c;

  if (Math.abs(rEnd - rStart) >= Math.abs(cEnd - cStart)) {
    // Vertical line: constant column, varying row
    const step = rEnd >= rStart ? 1 : -1;
    for (let r = rStart; r !== rEnd + step; r += step) {
      clueSelectedCells.push({ r, c: cStart });
    }
  } else {
    // Horizontal line: constant row, varying column
    const step = cEnd >= cStart ? 1 : -1;
    for (let c = cStart; c !== cEnd + step; c += step) {
      clueSelectedCells.push({ r: rStart, c });
    }
  }
}

// Generates the virtual keypad dynamically (1 row of 16 buttons)
function renderKeypad() {
  const keypadGrid = document.getElementById('keypadGrid');
  keypadGrid.innerHTML = '';

  for (let i = 1; i <= 16; i++) {
    const btn = document.createElement('button');
    btn.classList.add('key-btn');
    
    const shortcut = i >= 10 ? String.fromCharCode(65 + (i - 10)) : i.toString();
    
    // Wrap numbers 10-16 in circle in input pad
    if (i >= 10) {
      btn.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1.1; height: 100%;">
          <span class="number-circle" style="margin-bottom: 1px;">${getDisplayValue(i)}</span>
          <span class="key-shortcut" style="font-family: Arial, sans-serif; font-size: 8px; font-weight: normal; opacity: 0.85; text-transform: uppercase;">[${shortcut}]</span>
        </div>
      `;
    } else {
      btn.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1.1; height: 100%;">
          <span style="font-size: 1.15rem; font-weight: 700; margin-bottom: 2px;">${getDisplayValue(i)}</span>
          <span class="key-shortcut" style="font-family: Arial, sans-serif; font-size: 8px; font-weight: normal; opacity: 0.85; text-transform: uppercase;">[${shortcut}]</span>
        </div>
      `;
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      inputDigit(i);
    });
    keypadGrid.appendChild(btn);
  }
}

// Generates the dynamic Note Pad in White underneath the Erase/Last Step row
function renderNotepad() {
  const notepadGrid = document.getElementById('notepadGrid');
  if (!notepadGrid) return;
  notepadGrid.innerHTML = '';

  const hasValue = selectedCell ? (boardState[selectedCell.r][selectedCell.c] !== 0) : false;

  for (let i = 1; i <= 16; i++) {
    const btn = document.createElement('button');
    btn.className = 'notepad-btn';
    
    // Wrap numbers 10-16 in circle inside notepad
    if (i >= 10) {
      btn.innerHTML = `<span class="number-circle">${getDisplayValue(i)}</span>`;
    } else {
      btn.innerText = getDisplayValue(i);
    }

    // Toggle note on click
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!selectedCell) return;
      toggleCellNote(selectedCell.r, selectedCell.c, i);
    });

    if (selectedCell) {
      const { r, c } = selectedCell;
      
      // If cell is filled, cross out all numbers in Notepad
      if (hasValue) {
        btn.style.textDecoration = 'line-through';
        btn.style.opacity = '0.35';
        btn.style.pointerEvents = 'none';
      } else if (notesState[r][c][i]) {
        btn.classList.add('note-active');
      }
    } else {
      // If no cell is selected, display Note Pad disabled
      btn.style.opacity = '0.4';
      btn.style.pointerEvents = 'none';
    }

    notepadGrid.appendChild(btn);
  }
}

// Toggles note state directly from tapping the Note Pad
function toggleCellNote(r, c, digit) {
  if (givenMask[r][c]) return;
  
  const oldNotes = [...notesState[r][c]];
  notesState[r][c][digit] = !notesState[r][c][digit];
  
  pushHistoryState({
    type: 'note',
    r, c,
    prevVal: boardState[r][c],
    newVal: boardState[r][c],
    prevNotes: oldNotes,
    newNotes: [...notesState[r][c]]
  });

  renderCell(r, c);
  renderNotepad();
  
  // Re-routed: play chimp sound
  playChimpSound();
  saveGameState();
}

/* ==========================================================================
   2. Keyboard & Input Handling
   ========================================================================== */

function setupKeyboardListeners() {
  document.addEventListener('keydown', (e) => {
    if (isLocked || isGameOver || isAdPlaying) return;
    
    // Space or Escape to toggle pause
    if (e.key === ' ' || e.key === 'Escape') {
      e.preventDefault();
      togglePauseGame();
      return;
    }

    if (isPaused) return;

    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      if (!clueMode && selectedCell) e.preventDefault();
    }

    if (clueMode) {
      if (clueSelectedCells.length === 0) return;
    } else {
      if (!selectedCell) return;
    }

    const currentActiveCell = clueMode ? clueSelectedCells[clueSelectedCells.length - 1] : selectedCell;
    const { r, c } = currentActiveCell;

    // Grid Navigation (disabled in Clue mode)
    if (!clueMode) {
      if (e.key === 'ArrowUp') {
        selectCell(Math.max(0, r - 1), c);
        return;
      }
      if (e.key === 'ArrowDown') {
        selectCell(Math.min(15, r + 1), c);
        return;
      }
      if (e.key === 'ArrowLeft') {
        selectCell(r, Math.max(0, c - 1));
        return;
      }
      if (e.key === 'ArrowRight') {
        selectCell(r, Math.min(15, c + 1));
        return;
      }
    }

    // Delete / Clear
    if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
      clearActiveCell();
      return;
    }

    // Shift Key toggles Notes mode temporarily
    if (e.key === 'Shift') {
      toggleNotesMode(true);
      return;
    }

    // 'H' key toggles Clue Mode
    if (e.key.toLowerCase() === 'h') {
      e.preventDefault();
      toggleClueMode();
      return;
    }

    // Undo / Redo keyboard shortcuts
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      handleUndo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      handleRedo();
      return;
    }

    // Hex Input Key Parsing (A-G keys)
    const keyLower = e.key.toLowerCase();
    if (keyLower >= 'a' && keyLower <= 'g') {
      const hexValue = keyLower.charCodeAt(0) - 97 + 10; 
      inputDigit(hexValue);
      return;
    }

    // Multi-digit entry system for 1-16 (typing '1' then '2' quickly -> 12)
    if (e.key >= '1' && e.key <= '9') {
      const now = Date.now();
      const val = parseInt(e.key, 10);
      
      if (now - lastKeypressTime < 600 && lastKeyPressed === '1' && val <= 6) {
        const combined = 10 + val;
        handleUndo();
        inputDigit(combined);
        resetDoubleKeyBuffer();
      } else {
        inputDigit(val);
        lastKeypressTime = now;
        lastKeyPressed = e.key;
      }
    }
  });

  document.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') {
      toggleNotesMode(false);
    }
  });
}

function resetDoubleKeyBuffer() {
  lastKeypressTime = 0;
  lastKeyPressed = '';
}

// Selects a cell and triggers highlight renders
function selectCell(r, c) {
  if (isPaused) return;
  if (clueMode) {
    clueSelectedCells = [{ r, c }];
    renderHighlights();
    playChimpSound();
    return;
  }
  if (selectedCell && selectedCell.r === r && selectedCell.c === c) return;
  
  selectedCell = { r, c };
  renderHighlights();
  
  // Trigger Chimp sound when Picking the Cell
  playChimpSound();
  
  renderNotepad();
  hideFloatingKeypad();
}

function deselectCell() {
  if (clueMode) {
    clueSelectedCells = [];
    renderHighlights();
    return;
  }
  selectedCell = null;
  renderHighlights();
  renderNotepad();
}

// Renders axis (row, col) and duplicate value highlights
function renderHighlights() {
  if (clueMode) {
    for (let r = 0; r < 16; r++) {
      for (let c = 0; c < 16; c++) {
        const cellEl = document.getElementById(`cell-${r}-${c}`);
        cellEl.classList.remove('selected', 'highlight-axis', 'highlight-same-val', 'clue-highlighted');
        const isClueSel = clueSelectedCells.some(cell => cell.r === r && cell.c === c);
        if (isClueSel) {
          cellEl.classList.add('clue-highlighted', 'selected');
        }
      }
    }
    return;
  }

  const currentVal = selectedCell ? boardState[selectedCell.r][selectedCell.c] : 0;

  for (let r = 0; r < 16; r++) {
    for (let c = 0; c < 16; c++) {
      const cellEl = document.getElementById(`cell-${r}-${c}`);
      cellEl.classList.remove('selected', 'highlight-axis', 'highlight-same-val', 'clue-highlighted');

      if (!selectedCell) continue;

      const isSameCell = selectedCell.r === r && selectedCell.c === c;
      if (isSameCell) {
        cellEl.classList.add('selected');
        continue;
      }

      // Check if cell shares same row or column ONLY (No Box Highlight)
      const inSameRow = selectedCell.r === r;
      const inSameCol = selectedCell.c === c;

      if (inSameRow || inSameCol) {
        cellEl.classList.add('highlight-axis');
      }

      // Highlight same values
      if (currentVal !== 0 && boardState[r][c] === currentVal) {
        cellEl.classList.add('highlight-same-val');
      }
    }
  }
}

/* ==========================================================================
   3. Floating Keypad Popup for touch/mouse
   ========================================================================== */

function showFloatingKeypad(e, r, c) {
  hideFloatingKeypad();
  if (isPaused) return;
  if (givenMask[r][c]) return;

  const floatPad = document.createElement('div');
  floatPad.id = 'floatingKeypad';
  floatPad.classList.add('floating-keypad');

  floatPad.style.left = `${e.clientX + 10}px`;
  floatPad.style.top = `${e.clientY - 60}px`;

  for (let i = 1; i <= 16; i++) {
    const btn = document.createElement('button');
    btn.classList.add('floating-key-btn');
    
    // Numbers 10-16 in floating pad inside circle
    if (i >= 10) {
      btn.innerHTML = `<span class="number-circle">${getDisplayValue(i)}</span>`;
    } else {
      btn.innerText = getDisplayValue(i);
    }

    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      selectCell(r, c);
      inputDigit(i);
      hideFloatingKeypad();
    });
    floatPad.appendChild(btn);
  }

  // Add clear option
  const clearBtn = document.createElement('button');
  clearBtn.classList.add('floating-key-btn');
  clearBtn.style.gridColumn = 'span 4';
  clearBtn.style.background = 'rgba(239,68,68,0.1)';
  clearBtn.innerText = 'Erase';
  clearBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    selectCell(r, c);
    clearActiveCell();
    hideFloatingKeypad();
  });
  floatPad.appendChild(clearBtn);

  document.body.appendChild(floatPad);
}

function hideFloatingKeypad() {
  const pad = document.getElementById('floatingKeypad');
  if (pad) pad.remove();
}

/* ==========================================================================
   4. Game Commands: Input & Erasure
   ========================================================================== */

// Input digit to active cell (handles either note pencil mark or value fill)
// Input digit to active cell (handles either note pencil mark or value fill)
function inputDigit(digit) {
  if (isPaused || isLocked || isGameOver || isAdPlaying) return;

  if (clueMode) {
    if (clueSelectedCells.length === 0) {
      writeToConsoleLog("Select cell(s) on the grid first!");
      return;
    }
    let updatedAny = false;
    clueSelectedCells.forEach(cell => {
      const { r, c } = cell;
      if (givenMask[r][c]) return;
      if (boardState[r][c] !== 0) return; // except those already had Numbers

      const oldNotes = [...notesState[r][c]];
      notesState[r][c][digit] = !notesState[r][c][digit];
      pushHistoryState({
        type: 'note',
        r, c,
        prevVal: 0,
        newVal: 0,
        prevNotes: oldNotes,
        newNotes: [...notesState[r][c]]
      });
      renderCell(r, c);
      updatedAny = true;
    });

    if (updatedAny) {
      playChimpSound();
      saveGameState();
    }
    return;
  }

  // Normal Mode
  if (!selectedCell) {
    writeToConsoleLog("Select a cell on the grid first!");
    return;
  }
  const { r, c } = selectedCell;

  if (givenMask[r][c]) return; // Cannot modify givens

  if (notesMode) {
    const oldNotes = [...notesState[r][c]];
    notesState[r][c][digit] = !notesState[r][c][digit];
    
    pushHistoryState({
      type: 'note',
      r, c,
      prevVal: boardState[r][c],
      newVal: boardState[r][c],
      prevNotes: oldNotes,
      newNotes: [...notesState[r][c]]
    });

    renderCell(r, c);
    playChimpSound();
  } else {
    const prevVal = boardState[r][c];
    if (prevVal === digit) return; // No change

    const oldNotes = [...notesState[r][c]];

    notesState[r][c].fill(false);
    boardState[r][c] = digit;

    pushHistoryState({
      type: 'value',
      r, c,
      prevVal,
      newVal: digit,
      prevNotes: oldNotes,
      newNotes: [...notesState[r][c]]
    });

    const isCorrect = digit === solutionState[r][c];
    if (!isCorrect && assistanceMode === 'JUNIOR') {
      playGongSound();
    } else {
      playChimpSound();
    }

    renderCell(r, c);
    validateBoardConflicts();
    renderHighlights();
    updateProgress();
    checkVictory();
  }

  saveGameState();
}

// Clear digit/notes from selected cell
function clearActiveCell() {
  if (isPaused || isLocked || isGameOver || isAdPlaying) return;

  if (clueMode) {
    if (clueSelectedCells.length === 0) {
      writeToConsoleLog("Erase: Please drag/select cell(s) on the grid first.");
      playChimpSound();
      return;
    }
    let updatedAny = false;
    clueSelectedCells.forEach(cell => {
      const { r, c } = cell;
      if (givenMask[r][c]) return;

      const prevVal = boardState[r][c];
      const oldNotes = [...notesState[r][c]];

      if (prevVal !== 0) {
        boardState[r][c] = 0;
        notesState[r][c].fill(false);
        pushHistoryState({
          type: 'clear',
          r, c,
          prevVal,
          newVal: 0,
          prevNotes: oldNotes,
          newNotes: [...notesState[r][c]]
        });
        renderCell(r, c);
        updatedAny = true;
      } else if (oldNotes.includes(true)) {
        notesState[r][c].fill(false);
        pushHistoryState({
          type: 'note',
          r, c,
          prevVal: 0,
          newVal: 0,
          prevNotes: oldNotes,
          newNotes: [...notesState[r][c]]
        });
        renderCell(r, c);
        updatedAny = true;
      }
    });

    if (updatedAny) {
      playChimpSound();
      validateBoardConflicts();
      renderHighlights();
      updateProgress();
      saveGameState();
    }
    return;
  }

  // Normal Mode
  if (!selectedCell) {
    writeToConsoleLog("Erase: Please click/select a cell on the grid first.");
    playChimpSound();
    return;
  }
  const { r, c } = selectedCell;

  if (givenMask[r][c]) {
    writeToConsoleLog("Erase: Cannot clear a Given/Root cell!");
    return;
  }

  const prevVal = boardState[r][c];
  const oldNotes = [...notesState[r][c]];

  if (prevVal === 0 && !oldNotes.includes(true)) return; // Already empty

  boardState[r][c] = 0;
  notesState[r][c].fill(false);

  pushHistoryState({
    type: 'clear',
    r, c,
    prevVal,
    newVal: 0,
    prevNotes: oldNotes,
    newNotes: [...notesState[r][c]]
  });

  renderCell(r, c);
  validateBoardConflicts();
  renderHighlights();
  updateProgress();
  
  playChimpSound();
  writeToConsoleLog("Cell cleared.");
  saveGameState();
}

function toggleClueMode(force = null) {
  if (isPaused) return;
  clueMode = force !== null ? force : !clueMode;
  const btn = document.getElementById('clueBtn');
  if (btn) {
    if (clueMode) {
      btn.classList.add('clue-active');
      btn.innerHTML = `<span>Notes (ON)</span><span style="font-family: Arial, sans-serif; font-size: 8px; font-weight: normal; opacity: 0.85; margin-top: 1px; text-transform: uppercase;">[H]</span>`;
      // Convert normal selection to clue selection!
      if (selectedCell) {
        clueSelectedCells = [selectedCell];
        selectedCell = null;
      } else {
        clueSelectedCells = [];
      }
      writeToConsoleLog("Notes Mode ON: Drag to select cells, then press numbers to add pencil marks.");
    } else {
      btn.classList.remove('clue-active');
      btn.innerHTML = `<span>Notes</span><span style="font-family: Arial, sans-serif; font-size: 8px; font-weight: normal; opacity: 0.85; margin-top: 1px; text-transform: uppercase;">[H]</span>`;
      // Convert clue selection back to normal selection!
      if (clueSelectedCells.length > 0) {
        selectedCell = clueSelectedCells[clueSelectedCells.length - 1];
      }
      clueSelectedCells = [];
      writeToConsoleLog("Notes Mode deactivated.");
    }
  }
  renderHighlights();
  playChimpSound();
}

function resetBoard() {
  if (isPaused) return;
  if (confirm("Are you sure you want to clear all your entries? Your progress will be reset.")) {
    for (let r = 0; r < 16; r++) {
      for (let c = 0; c < 16; c++) {
        if (!givenMask[r][c]) {
          boardState[r][c] = 0;
          notesState[r][c].fill(false);
        }
      }
    }
    historyStack = [];
    historyPointer = -1;

    // Reset Last Step box
    const textEl = document.getElementById('lastStepText');
    if (textEl) textEl.innerText = '-';

    renderBoard();
    deselectCell();
    writeToConsoleLog("Board reset. All player entries cleared.");
    
    // Re-routed: play chimp sound
    playChimpSound();
    saveGameState();
  }
}

/* ==========================================================================
   5. UI Rendering & Grid Updates
   ========================================================================== */

function getDisplayValue(val) {
  if (val === 0) return '';
  return val.toString();
}

// Refreshes cell contents in DOM
function renderCell(r, c) {
  const cellEl = document.getElementById(`cell-${r}-${c}`);
  cellEl.innerHTML = '';
  cellEl.className = 'cell';

  const boxRow = Math.floor(r / 4);
  const boxCol = Math.floor(c / 4);
  if ((boxRow + boxCol) % 2 === 0) {
    cellEl.classList.add('box-even');
  }

  if ((c + 1) % 4 === 0 && c !== 15) {
    cellEl.classList.add('border-right-thick');
  }
  if ((r + 1) % 4 === 0 && r !== 15) {
    cellEl.classList.add('border-bottom-thick');
  }

  const val = boardState[r][c];
  const isGiven = givenMask[r][c];

  if (isGiven) {
    cellEl.classList.add('given');
    
    // Wrap numbers 10-16 in a circle
    if (val >= 10) {
      cellEl.innerHTML = `<span class="number-circle">${getDisplayValue(val)}</span>`;
    } else {
      cellEl.innerText = getDisplayValue(val);
    }
  } else if (val !== 0) {
    cellEl.classList.add('player-filled');
    
    // Wrap numbers 10-16 in a circle
    if (val >= 10) {
      cellEl.innerHTML = `<span class="number-circle">${getDisplayValue(val)}</span>`;
    } else {
      cellEl.innerText = getDisplayValue(val);
    }
  } else {
    // Render pencil marks notes
    const hasNotes = notesState[r][c].some(n => n === true);
    if (hasNotes) {
      const notesGrid = document.createElement('div');
      notesGrid.classList.add('notes-grid');

      for (let n = 1; n <= 16; n++) {
        const noteCell = document.createElement('div');
        noteCell.classList.add('note-cell');
        if (notesState[r][c][n]) {
          noteCell.innerText = getDisplayValue(n);
        }
        notesGrid.appendChild(noteCell);
      }
      cellEl.appendChild(notesGrid);
    }
  }
}

// Renders the entire board
function renderBoard() {
  for (let r = 0; r < 16; r++) {
    for (let c = 0; c < 16; c++) {
      renderCell(r, c);
    }
  }
  validateBoardConflicts();
  updateProgress();
}

/* ==========================================================================
   6. Conflict Proofreading & Mode Controllers (ON/OFF Toggles)
   ========================================================================== */

function toggleAlert() {
  assistanceMode = (assistanceMode === 'JUNIOR') ? 'MASTER' : 'JUNIOR';
  const btn = document.getElementById('alertToggleBtn');
  btn.innerText = (assistanceMode === 'JUNIOR') ? 'ON' : 'OFF';
  
  validateBoardConflicts();
  
  // Trigger Chimp sound when Alert Button is clicked
  playChimpSound();
  
  saveGameState();
}

// Scans board and marks conflicts with red badges in JUNIOR mode
function validateBoardConflicts() {
  for (let r = 0; r < 16; r++) {
    for (let c = 0; c < 16; c++) {
      document.getElementById(`cell-${r}-${c}`).classList.remove('collision');
    }
  }

  if (assistanceMode !== 'JUNIOR') return;

  // Check row/column collisions
  for (let r = 0; r < 16; r++) {
    const rowCounts = Array(17).fill(0).map(() => []);
    const colCounts = Array(17).fill(0).map(() => []);

    for (let c = 0; c < 16; c++) {
      const rowVal = boardState[r][c];
      if (rowVal !== 0) rowCounts[rowVal].push({ r, c });

      const colVal = boardState[c][r];
      if (colVal !== 0) colCounts[colVal].push({ r: c, c: r });
    }

    for (let v = 1; v <= 16; v++) {
      if (rowCounts[v].length > 1) {
        rowCounts[v].forEach(cell => {
          document.getElementById(`cell-${cell.r}-${cell.c}`).classList.add('collision');
        });
      }
      if (colCounts[v].length > 1) {
        colCounts[v].forEach(cell => {
          document.getElementById(`cell-${cell.r}-${cell.c}`).classList.add('collision');
        });
      }
    }
  }

  // Check 4x4 box collisions
  for (let br = 0; br < 4; br++) {
    for (let bc = 0; bc < 4; bc++) {
      const boxCounts = Array(17).fill(0).map(() => []);

      for (let r = br * 4; r < br * 4 + 4; r++) {
        for (let c = bc * 4; c < bc * 4 + 4; c++) {
          const val = boardState[r][c];
          if (val !== 0) {
            boxCounts[val].push({ r, c });
          }
        }
      }

      for (let v = 1; v <= 16; v++) {
        if (boxCounts[v].length > 1) {
          boxCounts[v].forEach(cell => {
            document.getElementById(`cell-${cell.r}-${cell.c}`).classList.add('collision');
          });
        }
      }
    }
  }
}

/* ==========================================================================
   7. Progress-Based Theme Management
   ========================================================================== */

function updateProgress() {
  let givens = 0;
  let userFilled = 0;

  for (let r = 0; r < 16; r++) {
    for (let c = 0; c < 16; c++) {
      if (givenMask[r][c]) {
        givens++;
      } else if (boardState[r][c] !== 0) {
        userFilled++;
      }
    }
  }

  const emptyCells = 256 - givens;
  const ratio = emptyCells > 0 ? (userFilled / emptyCells) : 0;
  const percentage = Math.min(100, Math.floor(ratio * 100));

  document.getElementById('progressText').innerText = `${percentage}%`;
  document.getElementById('progressBar').style.width = `${percentage}%`;

  const body = document.body;
  if (ratio >= 0.66) {
    if (!body.classList.contains('stage-3')) {
      body.classList.add('stage-3');
      body.classList.remove('stage-2');
      showProgressAlert("Phase 3: Emerald Matrix Unlocked!");
    }
  } else if (ratio >= 0.33) {
    if (!body.classList.contains('stage-2')) {
      body.classList.add('stage-2');
      body.classList.remove('stage-3');
      showProgressAlert("Phase 2: Amethyst Purple Unlocked!");
    }
  } else {
    body.classList.remove('stage-2', 'stage-3');
  }
}

function showProgressAlert(msg) {
  writeToConsoleLog(msg);
  playChimpSound(); // Re-routed: play chimp sound
}

function toggleThemeMode() {
  const body = document.body;
  const isLight = body.classList.toggle('light-mode');
  document.getElementById('themeToggleBtn').innerText = isLight ? 'LIGHT' : 'DARK';
  saveGameState();
}

/* ==========================================================================
   8. Puzzle Generation (Async loading bar layout)
   ========================================================================== */

async function fetchPreGeneratedPuzzle(difficulty) {
  try {
    const indexResponse = await fetch(`/sudoku_puzzles/puzzle_index.json?v=${Date.now()}`);
    if (!indexResponse.ok) throw new Error("Index file not found");
    const indexData = await indexResponse.json();
    
    const matchedPuzzles = indexData.filter(item => item.difficulty.toLowerCase() === difficulty.toLowerCase());
    if (matchedPuzzles.length === 0) throw new Error("No puzzles of this difficulty");
    
    const randomPuzzle = matchedPuzzles[Math.floor(Math.random() * matchedPuzzles.length)];
    
    const puzzleResponse = await fetch(`/sudoku_puzzles/${randomPuzzle.file}?v=${Date.now()}`);
    if (!puzzleResponse.ok) throw new Error("Puzzle file not found");
    return await puzzleResponse.json();
  } catch (error) {
    console.warn("Fallback to client-side generation:", error);
    return null;
  }
}

function updateDocNumDisplay() {
  const displayEl = document.getElementById('docNumDisplay');
  if (displayEl) {
    displayEl.innerText = `Doc #: ${currentDocNum}`;
  }
}

function generateNewPuzzle(forceSpendToken = false) {
  if (isPaused) {
    isPaused = false;
    const pausedOverlay = document.getElementById('pausedOverlay');
    if (pausedOverlay) pausedOverlay.classList.remove('active');
    const pauseBtn = document.getElementById('pauseBtn');
    if (pauseBtn) pauseBtn.innerText = 'Pause ⏸️';
  }

  // Check Daily Ticket & Token validation
  const today = getTodayString();
  const ticketUsed = lastTicketDate === today;

  if (ticketUsed && !forceSpendToken) {
    // Show Token Modal
    const modal = document.getElementById('tokenModal');
    if (modal) modal.classList.add('active');
    return;
  }

  if (forceSpendToken) {
    if (tokens >= 1) {
      tokens -= 1;
      saveTokens();
      writeToConsoleLog("Spent 1 Token 🪙 to play an extra game!");
    } else {
      alert("Not enough tokens! Please watch an ad to earn tokens or buy some.");
      return;
    }
  } else {
    // Consume daily free ticket
    lastTicketDate = today;
    localStorage.setItem('supersudoku16_last_ticket_date', lastTicketDate);
    updateWalletUI();
    writeToConsoleLog("Daily free ticket used! Good luck!");
  }

  // Reset Lock/GameOver states
  isLocked = false;
  isGameOver = false;
  const lockedOverlay = document.getElementById('lockedOverlay');
  if (lockedOverlay) lockedOverlay.classList.remove('active');

  // Initialize start timestamp
  puzzleStartTimestamp = Date.now();
  currentUnlockedHours = 1;
  adsShown = { 900: false, 1800: false, 2700: false, 4500: false, 5400: false, 6300: false };

  const select = document.getElementById('difficultySelect');
  currentDifficulty = select.value;

  stopTimer();
  resetTimer();

  // Reset Last Step box
  const textEl = document.getElementById('lastStepText');
  if (textEl) textEl.innerText = '-';

  deselectCell();
  hideFloatingKeypad();
  stopConfetti();

  const overlay = document.getElementById('loadingOverlay');
  const loadingText = document.getElementById('loadingText');
  overlay.classList.add('active');
  loadingText.innerHTML = `Fetching unique puzzle...`;

  fetchPreGeneratedPuzzle(currentDifficulty).then(puzzleData => {
    if (puzzleData) {
      boardState = puzzleData.puzzle.map(row => [...row]);
      solutionState = puzzleData.solution.map(row => [...row]);
      currentDocNum = puzzleData.id;
      
      for (let r = 0; r < 16; r++) {
        for (let c = 0; c < 16; c++) {
          givenMask[r][c] = puzzleData.puzzle[r][c] !== 0;
          notesState[r][c].fill(false);
        }
      }

      historyStack = [];
      historyPointer = -1;

      renderBoard();
      updateDocNumDisplay();
      overlay.classList.remove('active');
      startTimer();
      writeToConsoleLog(`Success: Loaded logically rated ${puzzleData.difficulty} Sudoku (Doc #: ${currentDocNum}). Good Luck!`);
      
      playChimpSound();

      const startBtn = document.getElementById('generateBtn');
      if (startBtn) {
        startBtn.disabled = true;
        startBtn.classList.add('btn-progress');
        startBtn.innerText = 'In Progress';
      }

      saveGameState();
    } else {
      currentDocNum = 'Fallback';
      updateDocNumDisplay();
      writeToConsoleLog(`Warning: Failed to fetch pre-generated puzzle. Generating via DLX...`);
      
      let targetClues = 112;
      if (currentDifficulty === 'easy') targetClues = 142;
      else if (currentDifficulty === 'intermediate') targetClues = 112;
      else if (currentDifficulty === 'hard') targetClues = 90;
      else if (currentDifficulty === 'master') targetClues = 80;

      const generator = dlxEngine.generatePuzzleAsync(targetClues);
      
      function step() {
        const res = generator.next();
        if (!res.done) {
          const { progress, clues } = res.value;
          loadingText.innerHTML = `Generating Unique Grid: <strong>${Math.floor(progress * 100)}%</strong><br>` +
                                  `<span style="font-size: 0.8rem; color: var(--text-muted);">${clues} Clues Kept</span>`;
          requestAnimationFrame(step);
        } else {
          const { puzzle, solved, clues } = res.value;
          
          boardState = puzzle.map(row => [...row]);
          solutionState = solved.map(row => [...row]);
          
          for (let r = 0; r < 16; r++) {
            for (let c = 0; c < 16; c++) {
              givenMask[r][c] = puzzle[r][c] !== 0;
              notesState[r][c].fill(false);
            }
          }

          historyStack = [];
          historyPointer = -1;

          renderBoard();
          overlay.classList.remove('active');
          startTimer();
          writeToConsoleLog(`Success: Generated unique 16x16 Sudoku (${clues} Givens). Good Luck!`);
          
          playChimpSound();

          const startBtn = document.getElementById('generateBtn');
          if (startBtn) {
            startBtn.disabled = true;
            startBtn.classList.add('btn-progress');
            startBtn.innerText = 'In Progress';
          }

          saveGameState();
        }
      }
      setTimeout(step, 100);
    }
  });
}

/* ==========================================================================
   9. Gameplay Action Managers: Toggles
   ========================================================================== */

function toggleNotesMode(force = null) {
  if (isPaused) return;
  notesMode = force !== null ? force : !notesMode;
}

function pushHistoryState(action) {
  historyStack = historyStack.slice(0, historyPointer + 1);
  historyStack.push(action);
  historyPointer++;
}

function handleUndo() {
  if (isPaused) return;
  if (historyPointer < 0) return;

  const action = historyStack[historyPointer];
  historyPointer--;

  const { r, c, prevVal, prevNotes } = action;
  boardState[r][c] = prevVal;
  notesState[r][c] = [...prevNotes];

  renderCell(r, c);
  validateBoardConflicts();
  renderNotepad();
  updateProgress();
  
  // Re-routed: play chimp sound
  playChimpSound();
  saveGameState();
}

function handleRedo() {
  if (isPaused) return;
  if (historyPointer >= historyStack.length - 1) return;

  historyPointer++;
  const action = historyStack[historyPointer];

  const { r, c, newVal, newNotes } = action;
  boardState[r][c] = newVal;
  notesState[r][c] = [...newNotes];

  renderCell(r, c);
  validateBoardConflicts();
  renderNotepad();
  updateProgress();
  
  // Re-routed: play chimp sound
  playChimpSound();
  saveGameState();
}

/* ==========================================================================
   10. Animated Solving Process
   ========================================================================== */

function solvePuzzleAnimate() {
  if (isPaused || isLocked || isGameOver) return;
  
  isGameOver = true; // Mark game as permanently over
  stopTimer();
  deselectCell();
  hideFloatingKeypad();
  
  // Wipe the saved state from localStorage so refreshing doesn't restore it
  localStorage.removeItem('supersudoku16_savestate');

  const cellsToFill = [];
  for (let r = 0; r < 16; r++) {
    for (let c = 0; c < 16; c++) {
      if (!givenMask[r][c] && boardState[r][c] !== solutionState[r][c]) {
        cellsToFill.push({ r, c });
      }
    }
  }

  // Restore the Start button state immediately to allow starting a new game
  const startBtn = document.getElementById('generateBtn');
  if (startBtn) {
    startBtn.disabled = false;
    startBtn.classList.remove('btn-progress');
    startBtn.innerText = 'Start 🏁';
  }

  if (cellsToFill.length === 0) {
    writeToConsoleLog("Game Over: Solution revealed (Board was solved).");
    return;
  }

  writeToConsoleLog("Game Over (Revealed): Filling in solution...");
  
  const solveBtn = document.getElementById('solveBtn');
  if (solveBtn) solveBtn.disabled = true;

  let idx = 0;
  function fillNext() {
    if (idx >= cellsToFill.length) {
      if (solveBtn) solveBtn.disabled = false;
      writeToConsoleLog("Game Over: Solution fully revealed.");
      return;
    }

    const { r, c } = cellsToFill[idx];
    boardState[r][c] = solutionState[r][c];
    notesState[r][c].fill(false);
    renderCell(r, c);
    updateProgress();

    playChimpSound();

    idx++;
    setTimeout(fillNext, 20);
  }

  fillNext();
}

/* ==========================================================================
   11. Timer, Logs & Persistence
   ========================================================================== */

function toggleTimerVisibility() {
  timerVisible = !timerVisible;
  const timerEl = document.getElementById('statTimer');
  const btn = document.getElementById('timerToggleBtn');
  
  if (timerVisible) {
    timerEl.classList.remove('hidden');
    btn.innerText = 'HIDE';
  } else {
    timerEl.classList.add('hidden');
    btn.innerText = 'SHOW';
  }
  saveGameState();
}

function togglePauseGame() {
  if (isPaused) {
    isPaused = false;
    const pausedOverlay = document.getElementById('pausedOverlay');
    if (pausedOverlay) pausedOverlay.classList.remove('active');
    const pauseBtn = document.getElementById('pauseBtn');
    if (pauseBtn) pauseBtn.innerHTML = '<span>Pause ⏸️</span><span style="font-family: Arial, sans-serif; font-size: 8px; font-weight: normal; opacity: 0.85; margin-top: 1px; text-transform: uppercase;">[Space]</span>';
    startTimer();
    writeToConsoleLog("Game Resumed.");
  } else {
    isPaused = true;
    const pausedOverlay = document.getElementById('pausedOverlay');
    if (pausedOverlay) pausedOverlay.classList.add('active');
    const pauseBtn = document.getElementById('pauseBtn');
    if (pauseBtn) pauseBtn.innerHTML = '<span>Resume ▶️</span><span style="font-family: Arial, sans-serif; font-size: 8px; font-weight: normal; opacity: 0.85; margin-top: 1px; text-transform: uppercase;">[Space]</span>';
    stopTimer();
    writeToConsoleLog("Game Paused.");
  }
  playChimpSound();
  saveGameState();
}

function startTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (isPaused || isLocked || isAdPlaying || isGameOver) return;

    const elapsedTotal = Math.floor((Date.now() - puzzleStartTimestamp) / 1000);
    const timeLeft = (currentUnlockedHours * 3600) - elapsedTotal;

    if (timeLeft <= 0) {
      clearInterval(timerInterval);
      document.getElementById('statTimer').innerText = '00:00:00';
      lockGame();
      return;
    }

    document.getElementById('statTimer').innerText = formatTimer(timeLeft);

    // Trigger 15-minute ad breaks at 15m (900), 30m (1800), 45m (2700) for Hour 1,
    // and 75m (4500), 90m (5400), 105m (6300) for Hour 2.
    const thresholds = [900, 1800, 2700, 4500, 5400, 6300];
    for (let t of thresholds) {
      if (elapsedTotal >= t && !adsShown[t]) {
        adsShown[t] = true;
        saveGameState();
        triggerBreakAd(15);
        break; // Trigger only one ad at a time
      }
    }

    if (elapsedTotal % 10 === 0) saveGameState();
  }, 1000);
}

function stopTimer() {
  if (timerInterval) clearInterval(timerInterval);
}

function resetTimer() {
  puzzleStartTimestamp = Date.now();
  document.getElementById('statTimer').innerText = '01:00:00';
}

function formatTimer(secs) {
  if (secs < 0) secs = 0;
  const h = Math.floor(secs / 3600).toString().padStart(2, '0');
  const m = Math.floor((secs % 3600) / 60).toString().padStart(2, '0');
  const s = (secs % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function writeToConsoleLog(msg) {
  activeStatusLog = msg;
  const statusEl = document.getElementById('status');
  if (statusEl) statusEl.innerText = msg;
}

const CURRENT_SAVE_VERSION = "v2_more_clues";

// Saves board data to LocalStorage
function saveGameState() {
  const state = {
    saveVersion: CURRENT_SAVE_VERSION,
    boardState,
    solutionState,
    givenMask,
    notesState,
    secondsElapsed,
    currentDifficulty,
    currentDocNum,
    assistanceMode,
    soundEnabled,
    timerVisible,
    clueMode,
    isLightMode: document.body.classList.contains('light-mode'),
    isPaused,
    puzzleStartTimestamp,
    currentUnlockedHours,
    adsShown,
    isLocked,
    isGameOver
  };
  localStorage.setItem('supersudoku16_savestate', JSON.stringify(state));
}

// Attempts to restore board from LocalStorage
function loadGameState() {
  const json = localStorage.getItem('supersudoku16_savestate');
  if (!json) return false;

  try {
    const state = JSON.parse(json);
    if (state.saveVersion !== CURRENT_SAVE_VERSION) {
      console.log("Old save state detected. Clearing and starting fresh.");
      localStorage.removeItem('supersudoku16_savestate');
      return false;
    }
    boardState = state.boardState;
    solutionState = state.solutionState;
    givenMask = state.givenMask;
    notesState = state.notesState;
    secondsElapsed = state.secondsElapsed;
    currentDifficulty = state.currentDifficulty;
    currentDocNum = state.currentDocNum || '-';
    assistanceMode = state.assistanceMode || 'MASTER';
    soundEnabled = (state.soundEnabled !== undefined) ? state.soundEnabled : true;
    timerVisible = (state.timerVisible !== undefined) ? state.timerVisible : true;
    isPaused = state.isPaused || false;
    clueMode = state.clueMode || false;

    // Load monetization/lock states
    puzzleStartTimestamp = state.puzzleStartTimestamp || Date.now();
    currentUnlockedHours = state.currentUnlockedHours || 1;
    adsShown = state.adsShown || { 900: false, 1800: false, 2700: false, 4500: false, 5400: false, 6300: false };
    isLocked = state.isLocked || false;
    isGameOver = state.isGameOver || false;
    
    updateDocNumDisplay();

    // Check expiration on load
    const elapsedTotal = Math.floor((Date.now() - puzzleStartTimestamp) / 1000);
    const timeLeft = (currentUnlockedHours * 3600) - elapsedTotal;
    if (timeLeft <= 0) {
      isLocked = true;
    }

    // Restore Paused State UI / Overlay
    const pausedOverlay = document.getElementById('pausedOverlay');
    const pauseBtn = document.getElementById('pauseBtn');
    if (isPaused) {
      if (pausedOverlay) pausedOverlay.classList.add('active');
      if (pauseBtn) pauseBtn.innerHTML = '<span>Resume ▶️</span><span style="font-family: Arial, sans-serif; font-size: 8px; font-weight: normal; opacity: 0.85; margin-top: 1px; text-transform: uppercase;">[Space]</span>';
      stopTimer();
    } else {
      if (pausedOverlay) pausedOverlay.classList.remove('active');
      if (pauseBtn) pauseBtn.innerHTML = '<span>Pause ⏸️</span><span style="font-family: Arial, sans-serif; font-size: 8px; font-weight: normal; opacity: 0.85; margin-top: 1px; text-transform: uppercase;">[Space]</span>';
    }

    // Apply Light Theme State
    if (state.isLightMode) {
      document.body.classList.add('light-mode');
      document.getElementById('themeToggleBtn').innerText = 'LIGHT';
    } else {
      document.body.classList.remove('light-mode');
      document.getElementById('themeToggleBtn').innerText = 'DARK';
    }

    document.getElementById('difficultySelect').value = currentDifficulty;
    
    document.getElementById('alertToggleBtn').innerText = (assistanceMode === 'JUNIOR') ? 'ON' : 'OFF';
    document.getElementById('soundToggleBtn').innerText = soundEnabled ? 'ON' : 'OFF';
    document.getElementById('timerToggleBtn').innerText = timerVisible ? 'HIDE' : 'SHOW';
    
    const timerEl = document.getElementById('statTimer');
    if (timerVisible) {
      timerEl.classList.remove('hidden');
    } else {
      timerEl.classList.add('hidden');
    }

    // Lock Start button if game is in progress & not locked/gameover
    let cellsFilled = 0;
    let totalCells = 256;
    for (let r = 0; r < 16; r++) {
      for (let c = 0; c < 16; c++) {
        if (boardState[r][c] !== 0) cellsFilled++;
      }
    }
    const startBtn = document.getElementById('generateBtn');
    if (cellsFilled > 0 && cellsFilled < totalCells && !isLocked && !isGameOver) {
      startBtn.disabled = true;
      startBtn.classList.add('btn-progress');
      startBtn.innerText = 'In Progress';
    } else {
      startBtn.disabled = false;
      startBtn.classList.remove('btn-progress');
      startBtn.innerText = 'Start 🏁';
    }

    renderBoard();
    renderKeypad();

    if (isLocked) {
      lockGame();
    } else if (!isPaused) {
      startTimer();
      writeToConsoleLog("Autosave Restored: Previous game state recovered.");
    } else {
      writeToConsoleLog("Autosave Restored: Previous game state recovered (Paused).");
    }
    return true;
  } catch (err) {
    console.error("Autosave loading error, starting fresh", err);
    localStorage.removeItem('supersudoku16_savestate');
    return false;
  }
}


/* ==========================================================================
   12. Synth Sound Effects (Web Audio API)
   ========================================================================== */

function toggleSound() {
  soundEnabled = !soundEnabled;
  document.getElementById('soundToggleBtn').innerText = soundEnabled ? 'ON' : 'OFF';
  if (soundEnabled) {
    playChimpSound();
  }
  saveGameState();
}

// Chimp Sound synthesis function (oo-oo-aa-aa rapid sweep modulation)
function playChimpSound() {
  if (!soundEnabled) return;

  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    const now = audioCtx.currentTime;
    
    const times = [0, 0.09];
    times.forEach(delay => {
      const t = now + delay;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      
      osc.type = 'triangle'; 
      
      osc.frequency.setValueAtTime(750, t);
      osc.frequency.exponentialRampToValueAtTime(2100, t + 0.035);
      osc.frequency.exponentialRampToValueAtTime(1050, t + 0.07);
      
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.09, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
      
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      
      osc.start(t);
      osc.stop(t + 0.08);
    });
  } catch (err) {
    console.warn("Audio Context Chimp sound failed: ", err);
  }
}

// 1-second Gong sound synthesis (rich, deep metallic texture)
function playGongSound() {
  if (!soundEnabled) return;

  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    const now = audioCtx.currentTime;
    const duration = 1.0; // 1 second Gong

    const masterGain = audioCtx.createGain();
    masterGain.gain.setValueAtTime(0, now);
    masterGain.gain.linearRampToValueAtTime(0.3, now + 0.08); // attack
    masterGain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    masterGain.connect(audioCtx.destination);

    // Overlapping frequencies for complex metallic timbre
    const frequencies = [110, 165, 220, 310, 415];
    frequencies.forEach((freq, index) => {
      const osc = audioCtx.createOscillator();
      const oscGain = audioCtx.createGain();

      const gainVal = 0.25 / (index + 1);
      oscGain.gain.setValueAtTime(gainVal, now);
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration - 0.1 * index);

      osc.type = index % 2 === 0 ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.linearRampToValueAtTime(freq * 0.95, now + duration);

      osc.connect(oscGain);
      oscGain.connect(masterGain);

      osc.start(now);
      osc.stop(now + duration);
    });
  } catch (err) {
    console.warn("Audio Context Gong sound failed: ", err);
  }
}

// 2. Route all sound helper functions to playChimpSound()
function playCrystalDing() {
  playChimpSound();
}

function playSynthTone(freq, type = 'sine', duration = 0.1) {
  playChimpSound();
}

// Victory celebration sound: 3 rapid chimp screeches!
function playVictoryChimes() {
  if (!soundEnabled) return;
  playChimpSound();
  setTimeout(playChimpSound, 120);
  setTimeout(playChimpSound, 240);
}

/* ==========================================================================
   13. Victory Validation & Confetti Animation
   ========================================================================== */

function checkVictory() {
  for (let r = 0; r < 16; r++) {
    for (let c = 0; c < 16; c++) {
      if (boardState[r][c] === 0 || boardState[r][c] !== solutionState[r][c]) {
        return; 
      }
    }
  }

  isGameOver = true;
  stopTimer();
  playVictoryChimes();
  startConfetti();
  writeToConsoleLog("🎉 CONGRATULATIONS! You solved the Super-Sudoku-16 puzzle! 🎉");
  
  const startBtn = document.getElementById('generateBtn');
  startBtn.disabled = false;
  startBtn.classList.remove('btn-progress');
  startBtn.innerText = 'Start 🏁';

  localStorage.removeItem('supersudoku16_savestate'); 
}

// Particle confetti on canvas
function startConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  const ctx = canvas.getContext('2d');
  
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  
  window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  });

  confettiParticles = [];
  const colors = ['#3b82f6', '#10b981', '#a855f7', '#fbbf24', '#ef4444', '#ec4899'];

  for (let i = 0; i < 180; i++) {
    confettiParticles.push({
      x: canvas.width / 2,
      y: canvas.height + 20,
      vx: (Math.random() - 0.5) * 15,
      vy: -Math.random() * 20 - 10,
      size: Math.random() * 8 + 5,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * 360,
      rotationSpeed: (Math.random() - 0.5) * 10
    });
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let active = false;
    confettiParticles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.45;
      p.vx *= 0.98;
      p.rotation += p.rotationSpeed;

      if (p.y < canvas.height + 20) {
        active = true;
      }

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rotation * Math.PI) / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      ctx.restore();
    });

    if (active) {
      confettiAnimationId = requestAnimationFrame(draw);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  if (confettiAnimationId) cancelAnimationFrame(confettiAnimationId);
  draw();
}

function stopConfetti() {
  if (confettiAnimationId) {
    cancelAnimationFrame(confettiAnimationId);
    confettiAnimationId = null;
  }
  const canvas = document.getElementById('confetti-canvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

// Solution Confirmation Modal Handlers
function confirmShowSolution() {
  if (isPaused) return;
  const modal = document.getElementById('solutionModal');
  if (modal) {
    modal.classList.add('active');
    stopTimer(); // pause timer while modal is open
  }
}

function handleSolutionConfirm(confirmed) {
  const modal = document.getElementById('solutionModal');
  if (modal) {
    modal.classList.remove('active');
  }
  if (confirmed) {
    solvePuzzleAnimate();
  } else {
    startTimer(); // resume timer
  }
}

function initButtonHoverHelp() {
  const hoverTexts = {
    'difficultySelect': "Select the difficulty level: Easy, Medium, Hard, or Master.",
    'generateBtn': "Start a new game with the selected difficulty.",
    'alertToggleBtn': "Alert mode: Turn off will not alert you for any Conflicts.",
    'soundToggleBtn': "Toggle audio sound effects on or off.",
    'themeToggleBtn': "Toggle between Light and Dark interface modes.",
    'resetBtn': "Clear all your entries and reset the current puzzle.",
    'solveBtn': "Reveal the full solution for the current puzzle.",
    'newGameBtn': "Abandon the current game and start a new one.",
    'undoBtn': "Undo the last entry or pencil mark change.",
    'eraseBtn': "Clear the value or clues in the currently selected cell.",
    'pauseBtn': "Pause or resume the game timer and grid interaction.",
    'timerToggleBtn': "Show or hide the game timer."
  };

  for (const id in hoverTexts) {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('mouseenter', () => {
        const statusEl = document.getElementById('status');
        if (statusEl) statusEl.innerText = hoverTexts[id];
      });
      el.addEventListener('mouseleave', () => {
        const statusEl = document.getElementById('status');
        if (statusEl) statusEl.innerText = activeStatusLog;
      });
    }
  }
}

/* ==========================================================================
   14. Elite Wallet, Ad & Lock Systems
   ========================================================================== */

function loadTokensAndTickets() {
  const t = localStorage.getItem('supersudoku16_tokens');
  if (t !== null) tokens = parseInt(t, 10);
  else {
    tokens = 5; // Default starter tokens
    saveTokens();
  }

  const td = localStorage.getItem('supersudoku16_last_ticket_date');
  if (td !== null) lastTicketDate = td;
  
  updateWalletUI();
}

function saveTokens() {
  localStorage.setItem('supersudoku16_tokens', tokens);
  updateWalletUI();
}

function updateWalletUI() {
  const tokenEl = document.getElementById('tokenCountText');
  if (tokenEl) tokenEl.innerText = tokens;
  
  const ticketEl = document.getElementById('dailyTicketText');
  if (ticketEl) {
    const today = getTodayString();
    const ticketUsed = lastTicketDate === today;
    ticketEl.innerText = ticketUsed ? "0/1" : "1/1";
    ticketEl.style.color = ticketUsed ? "var(--text-muted)" : "#10b981";
  }
}

function getTodayString() {
  const d = new Date();
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}

function confirmSpendToken(spend) {
  const modal = document.getElementById('tokenModal');
  if (modal) modal.classList.remove('active');
  
  if (spend) {
    generateNewPuzzle(true);
  }
}

function simulateWatchAd() {
  if (isAdPlaying) return;
  playSimulatedAd(30, () => {
    tokens += 1;
    saveTokens();
    writeToConsoleLog("Ad completed! You earned 1 Token 🪙.");
  });
}

function simulateBuyTokens() {
  tokens += 5;
  saveTokens();
  writeToConsoleLog("Purchase successful! Added 5 Tokens 🪙 to your wallet.");
}

function playSimulatedAd(durationSeconds, onComplete) {
  isAdPlaying = true;
  stopTimer();
  deselectCell();
  hideFloatingKeypad();
  
  const adOverlay = document.getElementById('adPlayerOverlay');
  const adTimer = document.getElementById('adPlayerTimer');
  const adTitle = document.getElementById('adPlayerTitle');
  const adMessage = document.getElementById('adPlayerMessage');
  
  if (adOverlay) adOverlay.classList.add('active');
  
  if (durationSeconds === 15) {
    if (adTitle) adTitle.innerText = "Health Break Ad";
    if (adMessage) adMessage.innerText = "Take a quick 15-second rest for your eyes. Rest your focus!";
  } else if (durationSeconds === 30) {
    if (adTitle) adTitle.innerText = "Rewarded Ad";
    if (adMessage) adMessage.innerText = "Watch this short video to earn 1 free Token!";
  } else if (durationSeconds === 60) {
    if (adTitle) adTitle.innerText = "Extension Ad";
    if (adMessage) adMessage.innerText = "Watch this 60-second ad to unlock Hour 2 of this puzzle for free!";
  }
  
  let remaining = durationSeconds;
  if (adTimer) adTimer.innerText = remaining;
  
  const interval = setInterval(() => {
    remaining--;
    if (adTimer) adTimer.innerText = remaining;
    if (remaining <= 0) {
      clearInterval(interval);
      if (adOverlay) adOverlay.classList.remove('active');
      isAdPlaying = false;
      if (onComplete) onComplete();
      
      // Resume game timer if the game is not locked, paused, or game over
      if (!isLocked && !isPaused && !isGameOver) {
        startTimer();
      }
    }
  }, 1000);
}

function lockGame() {
  isLocked = true;
  stopTimer();
  deselectCell();
  hideFloatingKeypad();
  
  const lockedOverlay = document.getElementById('lockedOverlay');
  const messageEl = document.getElementById('lockedOverlayMessage');
  const actionsEl = document.getElementById('lockActionsArea');
  
  if (lockedOverlay) lockedOverlay.classList.add('active');
  
  const startBtn = document.getElementById('generateBtn');
  if (startBtn) {
    startBtn.disabled = false;
    startBtn.classList.remove('btn-progress');
    startBtn.innerText = 'Start 🏁';
  }
  
  if (currentUnlockedHours === 1) {
    if (messageEl) messageEl.innerText = "Hour 1 expired (1-hour limit). Spend 1 Token 🪙 or watch a 60-second ad to unlock Hour 2.";
    if (actionsEl) {
      actionsEl.innerHTML = `
        <button class="btn btn-primary" onclick="simulateWatchExtensionAd()" style="padding: 4px 16px; font-size: 0.8rem; height: 32px;">
          📺 Watch Ad (60s)
        </button>
        <button class="btn" onclick="unlockGameWithToken()" style="padding: 4px 16px; font-size: 0.8rem; height: 32px;">
          Spend 1 Token 🪙
        </button>
        <button class="btn btn-secondary" onclick="abandonLockedGame()" style="padding: 4px 16px; font-size: 0.8rem; height: 32px;">
          Abandon
        </button>
      `;
    }
  } else {
    // Hour 2+ locks require compulsory Token payment
    if (messageEl) {
      if (currentUnlockedHours === 2) {
        messageEl.innerText = "Hour 2 expired. Accessing Hour 3+ requires a compulsory Token payment.";
      } else {
        messageEl.innerText = `Hour ${currentUnlockedHours} expired. Unlock Hour ${currentUnlockedHours + 1} with 1 Token 🪙.`;
      }
    }
    if (actionsEl) {
      actionsEl.innerHTML = `
        <button class="btn" onclick="unlockGameWithToken()" style="padding: 4px 16px; font-size: 0.8rem; height: 32px;">
          Spend 1 Token 🪙
        </button>
        <button class="btn btn-secondary" onclick="abandonLockedGame()" style="padding: 4px 16px; font-size: 0.8rem; height: 32px;">
          Abandon
        </button>
      `;
    }
  }
  
  saveGameState();
}

function unlockGameWithToken() {
  if (tokens >= 1) {
    tokens -= 1;
    saveTokens();
    
    currentUnlockedHours += 1;
    isLocked = false;
    
    const lockedOverlay = document.getElementById('lockedOverlay');
    if (lockedOverlay) lockedOverlay.classList.remove('active');
    
    const startBtn = document.getElementById('generateBtn');
    if (startBtn) {
      startBtn.disabled = true;
      startBtn.classList.add('btn-progress');
      startBtn.innerText = 'In Progress';
    }
    
    writeToConsoleLog(`Spent 1 Token. Unlocked Hour ${currentUnlockedHours}!`);
    playChimpSound();
    startTimer();
    saveGameState();
  } else {
    alert("Not enough tokens! Please watch an ad to earn tokens or buy some.");
  }
}

function simulateWatchExtensionAd() {
  if (isAdPlaying) return;
  playSimulatedAd(60, () => {
    currentUnlockedHours = 2;
    isLocked = false;
    
    const lockedOverlay = document.getElementById('lockedOverlay');
    if (lockedOverlay) lockedOverlay.classList.remove('active');
    
    const startBtn = document.getElementById('generateBtn');
    if (startBtn) {
      startBtn.disabled = true;
      startBtn.classList.add('btn-progress');
      startBtn.innerText = 'In Progress';
    }
    
    writeToConsoleLog("Watched extension ad. Unlocked Hour 2!");
    playChimpSound();
    startTimer();
    saveGameState();
  });
}

function abandonLockedGame() {
  isLocked = false;
  const lockedOverlay = document.getElementById('lockedOverlay');
  if (lockedOverlay) lockedOverlay.classList.remove('active');
  
  localStorage.removeItem('supersudoku16_savestate');
  
  resetTimer();
  boardState = Array(16).fill(0).map(() => Array(16).fill(0));
  renderBoard();
  
  const startBtn = document.getElementById('generateBtn');
  if (startBtn) {
    startBtn.disabled = false;
    startBtn.innerText = 'Start 🏁';
    startBtn.classList.remove('btn-progress');
  }
  
  writeToConsoleLog("Game abandoned. Click Start to play a new game.");
}

function triggerBreakAd(duration) {
  playSimulatedAd(duration, () => {
    writeToConsoleLog("Break ad completed. Resume playing!");
    playChimpSound();
  });
}
