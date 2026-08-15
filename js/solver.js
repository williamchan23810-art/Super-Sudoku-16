/**
 * BillDoku 16x16 Sudoku DLX Solver & Generator
 * Implements Knuth's Algorithm X using Dancing Links for ultra-fast solving and puzzle generation.
 */

class DLXNode {
  constructor(col = null, rowInfo = null) {
    this.up = this;
    this.down = this;
    this.left = this;
    this.right = this;
    this.col = col; // Pointer to ColumnHeader
    this.rowInfo = rowInfo; // { r, c, v }
  }
}

class ColumnHeader extends DLXNode {
  constructor(id) {
    super();
    this.id = id;
    this.size = 0;
    this.col = this;
  }
}

class SudokuDLX {
  constructor() {
    this.root = new ColumnHeader("root");
  }

  /**
   * Formulate the Exact Cover matrix for a 16x16 Sudoku.
   * If a board state is provided, it constrains the matrix to match the givens.
   */
  buildMatrix(board) {
    this.root = new ColumnHeader("root");
    const cols = [];

    // Create 1024 columns (4 constraints * 256 cells/groups)
    // 0..255: Cell constraints (each cell has exactly 1 number)
    // 256..511: Row constraints (each row has each number once)
    // 512..767: Col constraints (each col has each number once)
    // 768..1023: Box constraints (each 4x4 box has each number once)
    for (let i = 0; i < 1024; i++) {
      cols[i] = new ColumnHeader(i);
      cols[i].left = this.root.left;
      cols[i].right = this.root;
      this.root.left.right = cols[i];
      this.root.left = cols[i];
    }

    // Insert rows
    for (let r = 0; r < 16; r++) {
      for (let c = 0; c < 16; c++) {
        const val = board ? board[r][c] : 0;
        
        // If a cell is filled, we only create the row for that value.
        // Otherwise, we create rows for all possible values 1 to 16.
        const minVal = val !== 0 ? val : 1;
        const maxVal = val !== 0 ? val : 16;

        for (let v = minVal; v <= maxVal; v++) {
          const rowInfo = { r, c, v };
          const box = Math.floor(r / 4) * 4 + Math.floor(c / 4);

          // Indices for the 4 constraints this cell-value choice satisfies
          const idxCell = r * 16 + c;
          const idxRow  = 256 + r * 16 + (v - 1);
          const idxCol  = 512 + c * 16 + (v - 1);
          const idxBox  = 768 + box * 16 + (v - 1);

          const indices = [idxCell, idxRow, idxCol, idxBox];
          let firstNode = null;

          for (const idx of indices) {
            const colHeader = cols[idx];
            const node = new DLXNode(colHeader, rowInfo);

            // Link vertically into the column
            node.up = colHeader.up;
            node.down = colHeader;
            colHeader.up.down = node;
            colHeader.up = node;
            colHeader.size++;

            // Link horizontally in the row
            if (!firstNode) {
              firstNode = node;
            } else {
              node.left = firstNode.left;
              node.right = firstNode;
              firstNode.left.right = node;
              firstNode.left = node;
            }
          }
        }
      }
    }
  }

  // Cover a column
  cover(col) {
    col.right.left = col.left;
    col.left.right = col.right;

    for (let row = col.down; row !== col; row = row.down) {
      for (let node = row.right; node !== row; node = node.right) {
        node.down.up = node.up;
        node.up.down = node.down;
        node.col.size--;
      }
    }
  }

  // Uncover a column
  uncover(col) {
    for (let row = col.up; row !== col; row = row.up) {
      for (let node = row.left; node !== row; node = node.left) {
        node.col.size++;
        node.down.up = node;
        node.up.down = node;
      }
    }

    col.right.left = col;
    col.left.right = col;
  }

  /**
   * Search for solutions.
   * @param {number} maxSolutions - Max solutions to find before stopping.
   * @param {Array} currentSolution - Accumulated solution nodes.
   * @param {Array} solutions - Array storing all solutions found.
   */
  search(maxSolutions, currentSolution, solutions) {
    if (solutions.length >= maxSolutions) return;

    // If root.right is root, we have covered all constraints (found a solution)
    if (this.root.right === this.root) {
      // Decode solution
      const boardSol = Array(16).fill(0).map(() => Array(16).fill(0));
      for (const node of currentSolution) {
        const { r, c, v } = node.rowInfo;
        boardSol[r][c] = v;
      }
      solutions.push(boardSol);
      return;
    }

    // Select column with minimum size (MRV heuristic)
    let col = this.root.right;
    for (let curr = col.right; curr !== this.root; curr = curr.right) {
      if (curr.size < col.size) {
        col = curr;
      }
    }

    // If a column is empty, we reached a dead end
    if (col.size === 0) return;

    this.cover(col);

    // Randomize row choices to generate varied boards
    const rowNodes = [];
    for (let row = col.down; row !== col; row = row.down) {
      rowNodes.push(row);
    }

    // Shuffling choices is key for random board generation
    this.shuffle(rowNodes);

    for (const rowNode of rowNodes) {
      currentSolution.push(rowNode);
      for (let node = rowNode.right; node !== rowNode; node = node.right) {
        this.cover(node.col);
      }

      this.search(maxSolutions, currentSolution, solutions);

      for (let node = rowNode.left; node !== rowNode; node = node.left) {
        this.uncover(node.col);
      }
      currentSolution.pop();

      if (solutions.length >= maxSolutions) break;
    }

    this.uncover(col);
  }

  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  /**
   * Solves the given 16x16 grid.
   * Returns an array of solutions.
   */
  solveBoard(board, maxSolutions = 1) {
    this.buildMatrix(board);
    const solutions = [];
    this.search(maxSolutions, [], solutions);
    return solutions;
  }

  /**
   * Checks if the board has a unique solution.
   */
  hasUniqueSolution(board) {
    const sols = this.solveBoard(board, 2);
    return sols.length === 1;
  }

  /**
   * Generates a fully solved random 16x16 board.
   */
  generateFullSolvedBoard() {
    const emptyBoard = Array(16).fill(0).map(() => Array(16).fill(0));
    const sols = this.solveBoard(emptyBoard, 1);
    return sols[0];
  }

  /**
   * Generates a 16x16 puzzle with a unique solution.
   * @param {number} targetClues - The target number of clues (e.g. 50-100).
   */
  generatePuzzle(targetClues = 64) {
    const generator = this.generatePuzzleAsync(targetClues);
    let result = generator.next();
    while (!result.done) {
      result = generator.next();
    }
    return result.value;
  }

  /**
   * Generator function that yields progress information for async UI rendering.
   */
  *generatePuzzleAsync(targetClues = 64) {
    const solved = this.generateFullSolvedBoard();
    const puzzle = solved.map(row => [...row]);

    // Create a list of all cells
    const cells = [];
    for (let r = 0; r < 16; r++) {
      for (let c = 0; c < 16; c++) {
        cells.push({ r, c });
      }
    }
    this.shuffle(cells);

    let clues = 256;
    const totalToRemove = 256 - targetClues;
    let checkedCount = 0;

    for (const cell of cells) {
      if (clues <= targetClues) {
        break;
      }

      const backup = puzzle[cell.r][cell.c];
      puzzle[cell.r][cell.c] = 0;

      if (this.hasUniqueSolution(puzzle)) {
        clues--;
      } else {
        puzzle[cell.r][cell.c] = backup;
      }
      checkedCount++;

      // Yield progress update
      yield {
        progress: Math.min(1, checkedCount / 256),
        puzzle: puzzle.map(row => [...row]),
        solved,
        clues
      };
    }

    return { puzzle, solved, clues };
  }
}

// Support browser and node contexts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SudokuDLX };
} else {
  window.SudokuDLX = SudokuDLX;
}
