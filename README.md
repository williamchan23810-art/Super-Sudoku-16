# Super-Sudoku-16 🧩

Welcome to **Super-Sudoku-16** — the ultimate 16x16 Sudoku (Hexadoku) web experience! Featuring dynamic, progress-based themes, assistive gameplay modes, telemetry, and a sleek modern interface.

## Features 🚀

- **16x16 Grid (Hexadoku)**: Elevate your Sudoku experience with 256 cells and 16 unique characters (`1-9` and `A-G`).
- **Dynamic Difficulty Themes**: Choose from 4 difficulty levels (**Easy**, **Intermediate**, **Hard**, **Expert**). The interface theme shifts matching the selected level.
- **Pencil Notes**: Mark cell candidates dynamically to plan your moves.
- **Interactive Control Bar**:
  - **Timer Toggle**: Hide or show your current solve time.
  - **Sound Settings**: Turn audio cues and effects on or off.
  - **Theme Switcher**: Instantly switch between **Light Mode** and **Dark Mode**.
  - **Assistance Level**: Toggle helper highlights (Junior/Senior modes).
- **Node.js Telemetry & Feedback Server**: A lightweight API for collecting game statistics, session telemetry, and feedback.
- **Victory Animation**: Interactive confetti celebrations upon completing a puzzle successfully.

---

## Getting Started Locally 💻

### Prerequisites
Make sure you have [Node.js](https://nodejs.org/) installed.

### Installation
1. Clone the repository or navigate to the project directory:
   ```bash
   cd Super-Sudoku-16
   ```

2. Start the Node.js server:
   ```bash
   node server.js
   ```

3. Open your browser and navigate to:
   ```
   http://localhost:3001/
   ```

---

## Project Structure 📁

- `index.html` - The main game interface.
- `print.html` - Print-friendly layout for solving offline.
- `server.js` - HTTP server for static files and local telemetry logging (`/api/feedback`, `/api/telemetry`).
- `css/` - Styling sheets, layouts, and dynamic themes.
- `js/` - Frontend application logic, board generation, and solver scripts.
- `sudoku_puzzles/` - Prefetched or pre-generated boards for offline play.

---

## Deployment 🌐

This project is ready to deploy! 

### Deployment to Netlify
1. Log in to your **Netlify** account and click **Add new site** > **Import an existing project**.
2. Link your GitHub repository (`williamchan23810-art/Super-Sudoku-16`).
3. Set the **Build settings**:
   - **Build command**: Leave blank (no build step required for static HTML/JS/CSS).
   - **Publish directory**: `.` (root directory).
4. Click **Deploy site**.

> [!NOTE]
> The Node.js telemetry logging features require a Node.js runtime. When deployed to Netlify as a static site, API calls to `/api/telemetry` and `/api/feedback` will fail silently or fallback gracefullly, but the core game remains fully playable.
