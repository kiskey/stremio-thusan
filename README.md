# thusan Stremio Addon

This is a self-hostable Stremio addon for watching movies from Einthusan. It is designed to be fast and efficient by fetching all information directly from the source website.

## Features

- **Fast & Efficient**: Fetches all information directly from Einthusan for maximum speed, with no external API calls.
- **Rich Metadata**: Provides posters, descriptions, year, cast, and director information by scraping the movie page.
- **Browse by Language**: Catalogs for Tamil, Hindi, Telugu, and more.
- **Browse by Category**: Recently Added, Most Watched, Staff Picks.
- **Search**: Find movies within each language catalog.
- **Resilient Scraping**: Uses the Crawlee library for robust, browser-like scraping to avoid blocking.

## How to Run

### Method 1: Using Docker (Recommended)

1.  **Build the Docker image:**
    ```sh
    docker build -t einthusan-stremio-addon .
    ```

2.  **Run the Docker container:**
    ```sh
    docker run -p 7000:7000 --name einthusan-addon -d einthusan-stremio-addon
    ```
    The addon will now be running on `http://localhost:7000`.

3.  **To customize (e.g., change the port or log level):**
    ```sh
    docker run -p 8080:7000 -e PORT=7000 -e LOG_LEVEL=debug --name einthusan-addon -d einthusan-stremio-addon
    ```

### Method 2: Running Locally with Node.js

1.  **Prerequisites:**
    -   Node.js (v18 or later)
    -   npm

2.  **Install dependencies:**
    ```sh
    npm install
    ```

3.  **Configure:**
    -   Copy `.env.example` to `.env`.
    -   (Optional) Edit the `.env` file to set your desired `PORT` or `LOG_LEVEL`.

4.  **Run the addon:**
    ```sh
    npm start
    ```

## How to Install in Stremio

1.  Ensure the addon is running (either via Docker or locally).
2.  Open Stremio.
3.  Click the puzzle piece icon (Addons) in the top right.
4.  In the "Addon repository" search bar at the top, paste the URL of your running addon (e.g., `http://localhost:7000` or the IP address of your server if running remotely).
5.  Press Enter.
6.  Click the "Install" button on the addon that appears.

The Einthusan catalogs will now be available on your Stremio Discover board, and clicking on any movie will quickly load its metadata.
