import pathlib
import os
import logging
import json
import shutil
import sys
import time
import subprocess
import tempfile
import random
import re
from io import BytesIO
import webbrowser
from contextlib import asynccontextmanager # <--- ADDED FOR LIFESPAN

import uvicorn
from fastapi import FastAPI, HTTPException, Request, File, UploadFile
from fastapi.responses import JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image

# --- Configuration ---
API_SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
AUTOTAGGER_SCRIPT_PATH_STR = "wdv3_timm.py"
AUTOTAGGER_SCRIPT_PATH = (API_SCRIPT_DIR / AUTOTAGGER_SCRIPT_PATH_STR).resolve()

TAGGER_HTML_FILENAME = "tagger.html"
TAGGER_HTML_PATH = (API_SCRIPT_DIR.parent / TAGGER_HTML_FILENAME).resolve()

DEFAULT_SERVER_HOST = "127.0.0.1"
DEFAULT_SERVER_PORT = 8081

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# --- Lifespan Event Handler ---
@asynccontextmanager
async def lifespan(app_instance: FastAPI): # app_instance will be the FastAPI app
    # Startup logic
    # Access host and port from app.state (set in serve_api before server runs)
    # Note: This relies on app.state being populated before uvicorn.run()
    # which is the current setup.
    host = app_instance.state.server_host
    port = app_instance.state.server_port
    url = f"http://{host}:{port}/"
    logger.info(f"Server starting up. Attempting to open browser at: {url}")
    try:
        webbrowser.open_new_tab(url)
    except Exception as e:
        logger.error(f"Could not open browser automatically: {e}")
        logger.info(f"Please manually navigate to: {url}")
    
    yield # Application runs after this point
    
    # Shutdown logic (if any)
    logger.info("Server shutting down.")


# --- FastAPI App Initialization ---
app = FastAPI(
    title="Autotagger API",
    description="API to autotag images using an external Python script and serve a frontend. Browser opens on startup.",
    version="1.0.3",
    lifespan=lifespan # <--- USE THE NEW LIFESPAN MANAGER
)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Startup Event to Open Browser (REMOVED as it's now in lifespan) ---
# @app.on_event("startup")
# async def open_browser_on_startup():
#     # ... (This logic is now in the lifespan manager)


# --- Helper Function to Run Autotagger ---
async def run_autotagger_script(image_path: pathlib.Path) -> str:
    if not AUTOTAGGER_SCRIPT_PATH.is_file():
        logger.error(f"Autotagger script not found at: {AUTOTAGGER_SCRIPT_PATH}")
        raise FileNotFoundError(f"Autotagger script not found: {AUTOTAGGER_SCRIPT_PATH}")
    command = [sys.executable, str(AUTOTAGGER_SCRIPT_PATH), str(image_path)]
    logger.info(f"Running command: {' '.join(command)}")
    try:
        process = subprocess.run(
            command, capture_output=True, text=True, check=True, cwd=AUTOTAGGER_SCRIPT_PATH.parent
        )
        logger.info(f"Autotagger script stdout:\n{process.stdout}")
        if process.stderr: logger.warning(f"Autotagger script stderr:\n{process.stderr}")
        return process.stdout
    except subprocess.CalledProcessError as e:
        logger.error(f"Autotagger script failed with exit code {e.returncode}. Stdout: {e.stdout}, Stderr: {e.stderr}")
        raise RuntimeError(f"Autotagger script execution failed: {e.stderr or e.stdout}")
    except FileNotFoundError:
        logger.error(f"Error running command '{' '.join(command)}'. File not found.")
        raise
    except Exception as e:
        logger.error(f"An unexpected error occurred while running the autotagger script: {e}")
        raise

# --- API Endpoint for Autotagging ---
@app.post("/autotag/")
async def autotag_endpoint(image_upload: UploadFile = File(...)):
    temp_file_path = None
    try:
        image_bytes = await image_upload.read()
        pil_image = Image.open(BytesIO(image_bytes))
        with tempfile.NamedTemporaryFile(delete=False, suffix=".png", prefix="autotag_") as tmp_file:
            pil_image.save(tmp_file, format="PNG")
            temp_file_path = pathlib.Path(tmp_file.name)
        logger.info(f"Temporary image saved to: {temp_file_path}")
        script_output = await run_autotagger_script(temp_file_path)
        match = re.search(r"Tags:\s*(.*)", script_output, re.IGNORECASE)
        if match:
            tags_list = [tag.strip() for tag in match.group(1).split(',') if tag.strip()]
            logger.info(f"Extracted tags: {tags_list}")
            return JSONResponse(content={"tags": tags_list})
        else:
            logger.warning(f"Could not find 'Tags:' pattern in script output: {script_output}")
            raise HTTPException(status_code=500, detail="Failed to parse tags from script output.")
    except FileNotFoundError as e:
        logger.error(f"Server configuration error: {e}")
        raise HTTPException(status_code=500, detail=f"Server configuration error: {e}")
    except RuntimeError as e:
        logger.error(f"Error during autotagging process: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    except HTTPException: raise
    except Exception as e:
        logger.error(f"An unexpected error occurred in /autotag endpoint: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal Server Error")
    finally:
        if temp_file_path and temp_file_path.exists():
            try:
                temp_file_path.unlink()
                logger.info(f"Temporary file {temp_file_path} deleted.")
            except Exception as e_del:
                logger.error(f"Error deleting temporary file {temp_file_path}: {e_del}")

# --- Root Endpoint to Serve tagger.html ---
@app.get("/")
async def serve_tagger_html():
    if not TAGGER_HTML_PATH.is_file():
        logger.error(f"Frontend '{TAGGER_HTML_PATH.name}' not found at: {TAGGER_HTML_PATH}")
        raise HTTPException(status_code=404, detail=f"'{TAGGER_HTML_PATH.name}' not found. Expected at: {TAGGER_HTML_PATH}")
    logger.info(f"Serving '{TAGGER_HTML_PATH.name}' from: {TAGGER_HTML_PATH}")
    return FileResponse(TAGGER_HTML_PATH, media_type="text/html")

# --- Freakin' Awesome Warning Banner Function ---
def print_warning_banner():
    warning_message = "DO NOT CLOSE THIS WINDOW! The API server is running."
    padding = 3
    text_len = len(warning_message)
    inner_width = text_len + 2 * padding
    h_border_char = "*"
    v_border_char = "*"

    if not sys.stdout.isatty():
        top_bottom_border_plain = h_border_char * (inner_width + 2)
        empty_line_plain = f"{v_border_char}{' ' * inner_width}{v_border_char}"
        message_line_plain = f"{v_border_char}{' ' * padding}{warning_message}{' ' * padding}{v_border_char}"
        print("\n")
        print(top_bottom_border_plain)
        print(empty_line_plain)
        print(message_line_plain)
        print(empty_line_plain)
        print(top_bottom_border_plain)
        print("\n")
        return

    BOLD = "\033[1m"
    YELLOW = "\033[93m"
    RESET = "\033[0m"
    formatted_message = f"{BOLD}{YELLOW}{warning_message}{RESET}"
    top_bottom_border_color = f"{YELLOW}{h_border_char * (inner_width + 2)}{RESET}"
    colored_v_border = f"{YELLOW}{v_border_char}{RESET}"
    empty_line_content_spaces = ' ' * inner_width
    empty_line_color = f"{colored_v_border}{empty_line_content_spaces}{colored_v_border}"
    message_line_spaces_padding = ' ' * padding
    message_line_color = f"{colored_v_border}{message_line_spaces_padding}{formatted_message}{message_line_spaces_padding}{colored_v_border}"

    print("\n")
    print(top_bottom_border_color)
    print(empty_line_color)
    print(message_line_color)
    print(empty_line_color)
    print(top_bottom_border_color)
    print("\n")

# --- Function to Start Server ---
def serve_api(host=DEFAULT_SERVER_HOST, port=DEFAULT_SERVER_PORT):
    logger.info(f"Starting Autotagger API server on http://{host}:{port}")
    logger.info(f"Autotagger script expected at: {AUTOTAGGER_SCRIPT_PATH}")
    if not AUTOTAGGER_SCRIPT_PATH.is_file():
        logger.warning(f"CRITICAL: Autotagger script not found at {AUTOTAGGER_SCRIPT_PATH}. The /autotag endpoint will fail.")
    if TAGGER_HTML_PATH.is_file():
        logger.info(f"Serving frontend '{TAGGER_HTML_PATH.name}' from {TAGGER_HTML_PATH} at '/' path.")
    else:
        logger.warning(f"Frontend '{TAGGER_HTML_PATH.name}' not found at {TAGGER_HTML_PATH}. The '/' path will return a 404 error.")

    # Store host and port in app.state so the lifespan event can access them
    # This MUST be done BEFORE app is passed to uvicorn
    app.state.server_host = host
    app.state.server_port = port

    print_warning_banner()

    config = uvicorn.Config(app, host=host, port=port, log_level="info")
    server = uvicorn.Server(config)
    server.run()

if __name__ == "__main__":
    serve_api()