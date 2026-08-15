import copy
import random
import hashlib
import json
import os
import csv

GRID_SIZE = 16
BOX_SIZE = 4
ALL_CANDIDATES = (1 << 16) - 1  # 16-bit mask representing numbers 1 through 16

# Mapping for 256-character string serialization
# 0 -> '.', 1-9 -> '1'-'9', 10-16 -> 'A'-'G'
TO_CHAR = {i: str(i) for i in range(1, 10)}
for i, c in enumerate("ABCDEFG", start=10):
    TO_CHAR[i] = c
TO_CHAR[0] = "."

# ==========================================
# 1. RATING ENGINE (Pure 1-16 Numbers)
# ==========================================
class HexadokuRatingEngine:
    def __init__(self, board):
        """
        board: 16x16 2D list of ints (0 for empty, 1-16 for given clues).
        """
        self.grid = copy.deepcopy(board)
        self.candidates = [[ALL_CANDIDATES for _ in range(GRID_SIZE)] for _ in range(GRID_SIZE)]
        self.techniques_log = []
        self._init_candidates()

    def _init_candidates(self):
        for r in range(GRID_SIZE):
            for c in range(GRID_SIZE):
                val = self.grid[r][c]
                if val != 0:
                    self.candidates[r][c] = 1 << (val - 1)
                    self._eliminate_peers(r, c, val)

    def _eliminate_peers(self, row, col, val):
        mask = ~(1 << (val - 1))
        box_r, box_c = (row // BOX_SIZE) * BOX_SIZE, (col // BOX_SIZE) * BOX_SIZE
        
        for i in range(GRID_SIZE):
            if i != col:
                self.candidates[row][i] &= mask
            if i != row:
                self.candidates[i][col] &= mask

        for r in range(box_r, box_r + BOX_SIZE):
            for c in range(box_c, box_c + BOX_SIZE):
                if r != row or c != col:
                    self.candidates[r][c] &= mask

    def is_solved(self):
        return all(self.grid[r][c] != 0 for r in range(GRID_SIZE) for c in range(GRID_SIZE))

    def find_naked_singles(self):
        for r in range(GRID_SIZE):
            for c in range(GRID_SIZE):
                if self.grid[r][c] == 0:
                    cands = self.candidates[r][c]
                    if cands > 0 and (cands & (cands - 1)) == 0:
                        val = cands.bit_length()
                        self.grid[r][c] = val
                        self._eliminate_peers(r, c, val)
                        self.techniques_log.append(('Naked Single', 1))
                        return True
        return False

    def find_hidden_singles(self):
        for num in range(1, 17):
            bit = 1 << (num - 1)
            # Check Rows
            for r in range(GRID_SIZE):
                possible_cols = [c for c in range(GRID_SIZE) if (self.candidates[r][c] & bit)]
                if len(possible_cols) == 1 and self.grid[r][possible_cols[0]] == 0:
                    c = possible_cols[0]
                    self.grid[r][c] = num
                    self.candidates[r][c] = bit
                    self._eliminate_peers(r, c, num)
                    self.techniques_log.append(('Hidden Single', 2))
                    return True

            # Check Columns
            for c in range(GRID_SIZE):
                possible_rows = [r for r in range(GRID_SIZE) if (self.candidates[r][c] & bit)]
                if len(possible_rows) == 1 and self.grid[possible_rows[0]][c] == 0:
                    r = possible_rows[0]
                    self.grid[r][c] = num
                    self.candidates[r][c] = bit
                    self._eliminate_peers(r, c, num)
                    self.techniques_log.append(('Hidden Single', 2))
                    return True

            # Check 4x4 Boxes
            for br in range(0, GRID_SIZE, BOX_SIZE):
                for bc in range(0, GRID_SIZE, BOX_SIZE):
                    cells = [(r, c) for r in range(br, br + BOX_SIZE) 
                             for c in range(bc, bc + BOX_SIZE) if (self.candidates[r][c] & bit)]
                    if len(cells) == 1 and self.grid[cells[0][0]][cells[0][1]] == 0:
                        r, c = cells[0]
                        self.grid[r][c] = num
                        self.candidates[r][c] = bit
                        self._eliminate_peers(r, c, num)
                        self.techniques_log.append(('Hidden Single', 2))
                        return True
        return False

    def find_pointing_intersections(self):
        for num in range(1, 17):
            bit = 1 << (num - 1)
            mask = ~bit
            for br in range(0, GRID_SIZE, BOX_SIZE):
                for bc in range(0, GRID_SIZE, BOX_SIZE):
                    cells = [(r, c) for r in range(br, br + BOX_SIZE) 
                             for c in range(bc, bc + BOX_SIZE) if (self.candidates[r][c] & bit)]
                    if not cells:
                        continue
                    
                    rows = {r for r, _ in cells}
                    cols = {c for _, c in cells}

                    if len(rows) == 1:
                        target_r = list(rows)[0]
                        eliminated = False
                        for c in range(GRID_SIZE):
                            if (c < bc or c >= bc + BOX_SIZE) and (self.candidates[target_r][c] & bit):
                                self.candidates[target_r][c] &= mask
                                eliminated = True
                        if eliminated:
                            self.techniques_log.append(('Pointing Group', 10))
                            return True

                    if len(cols) == 1:
                        target_c = list(cols)[0]
                        eliminated = False
                        for r in range(GRID_SIZE):
                            if (r < br or r >= br + BOX_SIZE) and (self.candidates[r][target_c] & bit):
                                self.candidates[r][target_c] &= mask
                                eliminated = True
                        if eliminated:
                            self.techniques_log.append(('Pointing Group', 10))
                            return True
        return False

    def analyze_and_rate(self):
        """Rates difficulty into: Easy, Intermediate, Hard, or Master."""
        clues_count = sum(1 for r in range(GRID_SIZE) for c in range(GRID_SIZE) if self.grid[r][c] != 0)
        
        while not self.is_solved():
            if self.find_naked_singles():
                continue
            if self.find_hidden_singles():
                continue
            if self.find_pointing_intersections():
                continue

            if clues_count <= 85:
                return "Master"
            else:
                return "Hard"

        max_weight = max([w for _, w in self.techniques_log], default=0)
        if max_weight <= 2:
            return "Easy"
        elif max_weight <= 10:
            return "Intermediate"
        else:
            return "Hard"


# ==========================================
# 2. PUZZLE GENERATOR
# ==========================================
SEED_GRID = [
    [1, 2, 3, 4,  5, 6, 7, 8,  9, 10, 11, 12, 13, 14, 15, 16],
    [5, 6, 7, 8,  9, 10, 11, 12, 13, 14, 15, 16, 1, 2, 3, 4],
    [9, 10, 11, 12, 13, 14, 15, 16, 1, 2, 3, 4, 5, 6, 7, 8],
    [13, 14, 15, 16, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    
    [2, 3, 4, 1,  6, 7, 8, 5,  10, 11, 12, 9,  14, 15, 16, 13],
    [6, 7, 8, 5,  10, 11, 12, 9,  14, 15, 16, 13, 2, 3, 4, 1],
    [10, 11, 12, 9,  14, 15, 16, 13, 2, 3, 4, 1,  6, 7, 8, 5],
    [14, 15, 16, 13, 2, 3, 4, 1,  6, 7, 8, 5,  10, 11, 12, 9],
    
    [3, 4, 1, 2,  7, 8, 5, 6,  11, 12, 9, 10,  15, 16, 13, 14],
    [7, 8, 5, 6,  11, 12, 9, 10,  15, 16, 13, 14, 3, 4, 1, 2],
    [11, 12, 9, 10,  15, 16, 13, 14, 3, 4, 1, 2,  7, 8, 5, 6],
    [15, 16, 13, 14, 3, 4, 1, 2,  7, 8, 5, 6,  11, 12, 9, 10],
    
    [4, 1, 2, 3,  8, 5, 6, 7,  12, 9, 10, 11,  16, 13, 14, 15],
    [8, 5, 6, 7,  12, 9, 10, 11,  16, 13, 14, 15, 4, 1, 2, 3],
    [12, 9, 10, 11,  16, 13, 14, 15, 4, 1, 2, 3,  8, 5, 6, 7],
    [16, 13, 14, 15, 4, 1, 2, 3,  8, 5, 6, 7,  12, 9, 10, 11]
]

class HexadokuGenerator:
    def __init__(self):
        pass

    def generate_full_board(self):
        grid = copy.deepcopy(SEED_GRID)
        
        # 1. Permute numbers (rename 1..16 randomly)
        nums = list(range(1, 17))
        random.shuffle(nums)
        num_map = {i+1: nums[i] for i in range(16)}
        for r in range(16):
            for c in range(16):
                grid[r][c] = num_map[grid[r][c]]
                
        # 2. Permute rows within blocks
        for block in range(4):
            indices = list(range(block * 4, block * 4 + 4))
            random.shuffle(indices)
            temp_rows = [grid[idx] for idx in indices]
            for i, idx in enumerate(range(block * 4, block * 4 + 4)):
                grid[idx] = temp_rows[i]
                
        # 3. Permute columns within blocks
        for block in range(4):
            indices = list(range(block * 4, block * 4 + 4))
            random.shuffle(indices)
            for r in range(16):
                temp_row = [grid[r][idx] for idx in indices]
                for i, idx in enumerate(range(block * 4, block * 4 + 4)):
                    grid[r][idx] = temp_row[i]
                    
        # 4. Permute block rows
        block_rows = list(range(4))
        random.shuffle(block_rows)
        temp_grid = []
        for br in block_rows:
            temp_grid.extend(grid[br*4 : br*4 + 4])
        grid = temp_grid
        
        # 5. Permute block columns
        block_cols = list(range(4))
        random.shuffle(block_cols)
        temp_grid = [[0]*16 for _ in range(16)]
        for r in range(16):
            for bc_idx, bc in enumerate(block_cols):
                for c_offset in range(4):
                    temp_grid[r][bc_idx*4 + c_offset] = grid[r][bc*4 + c_offset]
        grid = temp_grid
        
        return grid

    def generate_puzzle(self, target_difficulty="Easy"):
        min_clues_map = {
            "Easy": 9,
            "Intermediate": 8,
            "Hard": 7,
            "Master": 6
        }
        min_clues_per_box = min_clues_map.get(target_difficulty, 6)

        attempts = 0
        while attempts < 30:
            attempts += 1
            full_board = self.generate_full_board()
            puzzle = copy.deepcopy(full_board)

            positions = [(r, c) for r in range(GRID_SIZE) for c in range(GRID_SIZE)]
            random.shuffle(positions)

            clues_count = 256
            box_clues = [16] * 16
            
            for r, c in positions:
                box_idx = (r // 4) * 4 + (c // 4)
                if box_clues[box_idx] <= min_clues_per_box:
                    continue

                backup = puzzle[r][c]
                puzzle[r][c] = 0

                rater = HexadokuRatingEngine(puzzle)
                difficulty = rater.analyze_and_rate()

                keep_removed = False
                if target_difficulty == "Easy":
                    keep_removed = (difficulty == "Easy")
                elif target_difficulty == "Intermediate":
                    keep_removed = (difficulty in ["Easy", "Intermediate"])
                elif target_difficulty == "Hard":
                    keep_removed = (difficulty in ["Easy", "Intermediate", "Hard"])
                elif target_difficulty == "Master":
                    keep_removed = True
                    if clues_count <= 96:
                        keep_removed = False

                if keep_removed:
                    clues_count -= 1
                    box_clues[box_idx] -= 1
                else:
                    puzzle[r][c] = backup

            # Double check final difficulty matches target, or if it's easier due to clue count limits
            rater = HexadokuRatingEngine(puzzle)
            final_diff = rater.analyze_and_rate()
            if target_difficulty == "Easy" and final_diff == "Easy":
                return puzzle, full_board, target_difficulty
            elif target_difficulty == "Intermediate" and final_diff in ["Easy", "Intermediate"]:
                return puzzle, full_board, target_difficulty
            elif target_difficulty == "Hard" and final_diff in ["Easy", "Intermediate", "Hard"]:
                return puzzle, full_board, target_difficulty
            elif target_difficulty == "Master":
                return puzzle, full_board, target_difficulty

        raise RuntimeError(f"Could not constructively generate {target_difficulty} puzzle.")


# ==========================================
# 3. FILING & DUPLICATE PREVENTER (1-16 System)
# ==========================================
class HexadokuFilingSystem:
    def __init__(self, storage_dir="sudoku_puzzles"):
        self.storage_dir = storage_dir
        os.makedirs(self.storage_dir, exist_ok=True)
        self.index_file = os.path.join(self.storage_dir, "puzzle_index.json")
        self.csv_file = os.path.join(self.storage_dir, "puzzles_database.csv")
        self.index_data = self._load_index()

    def _load_index(self):
        if os.path.exists(self.index_file):
            with open(self.index_file, "r") as f:
                return json.load(f)
        return []

    def _save_index(self):
        with open(self.index_file, "w") as f:
            json.dump(self.index_data, f, indent=2)

    def compute_fingerprint(self, grid):
        flat_str = "".join([f"{val:02d}" for row in grid for val in row])
        return hashlib.sha256(flat_str.encode('utf-8')).hexdigest()

    def is_duplicate(self, grid):
        grid_hash = self.compute_fingerprint(grid)
        return any(item["hash"] == grid_hash for item in self.index_data)

    def serialize_board(self, grid):
        """Converts grid array to 256-character string."""
        return "".join([TO_CHAR[val] for row in grid for val in row])

    def get_next_doc_number(self, difficulty):
        prefix_map = {
            "Easy": "E",
            "Intermediate": "I",
            "Hard": "H",
            "Master": "M"
        }
        prefix = prefix_map.get(difficulty, "X")
        
        count = sum(1 for item in self.index_data if item["difficulty"] == difficulty)
        return f"{prefix}{count + 1:04d}"

    def save_puzzle(self, puzzle, solution, difficulty):
        grid_hash = self.compute_fingerprint(puzzle)

        if self.is_duplicate(puzzle):
            print(f"Warning: Duplicate detected! Hash {grid_hash[:8]}... skipped.")
            return False

        doc_num = self.get_next_doc_number(difficulty)
        
        file_name = f"{difficulty.lower()}_{doc_num}.json"
        file_path = os.path.join(self.storage_dir, file_name)
        
        payload = {
            "id": doc_num,
            "hash": grid_hash,
            "difficulty": difficulty,
            "puzzle": puzzle,
            "solution": solution
        }

        with open(file_path, "w") as f:
            json.dump(payload, f, indent=2)

        self.index_data.append({
            "id": doc_num,
            "hash": grid_hash,
            "difficulty": difficulty,
            "file": file_name
        })
        self._save_index()

        write_header = not os.path.exists(self.csv_file)
        with open(self.csv_file, "a", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            if write_header:
                writer.writerow(["Doc Num", "Difficulty", "Fingerprint", "Start Board", "Solution Board"])
            writer.writerow([
                doc_num,
                difficulty,
                grid_hash,
                self.serialize_board(puzzle),
                self.serialize_board(solution)
            ])

        print(f"Saved [{difficulty}] Puzzle -> Doc Num: {doc_num} (ID: {grid_hash[:12]}, File: {file_name})")
        return True


# ==========================================
# 4. RUNNER / TEST ENTRY
# ==========================================
if __name__ == "__main__":
    generator = HexadokuGenerator()
    filing_system = HexadokuFilingSystem()

    difficulties = ["Easy"]
    batch_size = 3  # Generates 3 puzzles of Easy difficulty by default for testing

    print(f"Generating unique batches of logical 1-16 Super Sudokus...")
    for diff in difficulties:
        print(f"\n--- Generating {diff} Puzzles ---")
        for i in range(batch_size):
            puzzle, solution, rated_diff = generator.generate_puzzle(target_difficulty=diff)
            filing_system.save_puzzle(puzzle, solution, rated_diff)

    print("\nGeneration Complete! Files saved to 'sudoku_puzzles' directory.")
