# FastAPI Backend for autotagging images using third party autotagger models and their respective scripts.

import pathlib
import os
import logging
import json
import shutil
import sys
import time
import subprocess
import tempfile
import pathlib
import re
from io import BytesIO
import webbrowser
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, HTTPException, Request, File, UploadFile, Query # Added Query
from fastapi.responses import JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image

# --- Configuration ---
API_SCRIPT_DIR = pathlib.Path(__file__).resolve().parent

# Add API_SCRIPT_DIR to sys.path to allow importing from 'autotaggers'
# This assumes 'autotaggers' is a subfolder of the directory containing api.py
if str(API_SCRIPT_DIR) not in sys.path:
    sys.path.append(str(API_SCRIPT_DIR))

# --- wd-vit-tagger-v3 autotagger script path ---
AUTOTAGGER_WDV3_SCRIPT_PATH_STR = "autotaggers/wd-vit-tagger-v3/wdv3_timm.py"
AUTOTAGGER_WDV3_SCRIPT_PATH = (API_SCRIPT_DIR / AUTOTAGGER_WDV3_SCRIPT_PATH_STR).resolve()

# --- redrocket-joint-tagger (RRJ) direct import ---
# We will import the function directly, so no script path constant is strictly needed here for execution.
# Model and tags for RRJ are loaded when rrj.py is imported.
try:
    from autotaggers.rrj.rrj import autotag as rrj_autotag_func
    from autotaggers.rrj.rrj import device as rrj_device_info # For logging
    RRJ_TAGGER_AVAILABLE = True
except ImportError as e:
    logging.error(f"Failed to import RedRocket Joint Tagger module: {e}. The RRJ endpoint will not be available.")
    RRJ_TAGGER_AVAILABLE = False
    rrj_autotag_func = None # Placeholder
    rrj_device_info = "Unavailable"
except Exception as e: # Catch other potential errors during rrj.py import (e.g., model download failure)
    logging.error(f"An error occurred during RedRocket Joint Tagger module initialization: {e}", exc_info=True)
    RRJ_TAGGER_AVAILABLE = False
    rrj_autotag_func = None
    rrj_device_info = f"Error during init: {e}"

# --- Frontend HTML Path ---
FRONTEND_HTML_FILENAME = "tagger.html"
FRONTEND_HTML_PATH = (API_SCRIPT_DIR.parent / FRONTEND_HTML_FILENAME).resolve()

DEFAULT_SERVER_HOST = "127.0.0.1"
DEFAULT_SERVER_PORT = 8081

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# --- Lifespan Event Handler ---
@asynccontextmanager
async def lifespan(app_instance: FastAPI):
    host = app_instance.state.server_host
    port = app_instance.state.server_port
    url = f"http://{host}:{port}/"
    logger.info(f"Server starting up.")
    if RRJ_TAGGER_AVAILABLE:
        logger.info(f"RedRocket Joint Tagger is available. Using device: {rrj_device_info}")
    else:
        logger.warning("RedRocket Joint Tagger is NOT available due to import/init errors. Check logs.")
    
    logger.info(f"Attempting to open browser at: {url}")
    try:
        webbrowser.open_new_tab(url)
    except Exception as e:
        logger.error(f"Could not open browser automatically: {e}")
        logger.info(f"Please manually navigate to: {url}")
    
    yield
    
    logger.info("Server shutting down.")

# --- FastAPI App Initialization ---
app = FastAPI(
    title="Autotagger API",
    description="API to autotag images using external Python scripts or direct imports and serve a frontend.",
    version="1.0.4", # Incremented version
    lifespan=lifespan,
    docs_url="/autotagger/docs"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Health Check Endpoint ---
@app.get("/health", summary="Check if the API server is running") # Added health check endpoint
async def health_check():
    """
    Simple health check endpoint that returns the status of the server and available models.
    """
    return JSONResponse(content={
        "status": "ok",
        "timestamp": time.time(),
        "models": {
            "wd-vit-tagger-v3": "available",
            "redrocket-joint-tagger": "available" if RRJ_TAGGER_AVAILABLE else "unavailable"
        }
    })

# --- Helper Function to Run WDv3 Autotagger Script ---
async def run_wdv3_autotagger_script(image_path: pathlib.Path) -> str:
    if not AUTOTAGGER_WDV3_SCRIPT_PATH.is_file():
        logger.error(f"WDv3 Autotagger script not found at: {AUTOTAGGER_WDV3_SCRIPT_PATH}")
        raise FileNotFoundError(f"WDv3 Autotagger script not found: {AUTOTAGGER_WDV3_SCRIPT_PATH}")
    command = [sys.executable, str(AUTOTAGGER_WDV3_SCRIPT_PATH), str(image_path)]
    logger.info(f"Running WDv3 command: {' '.join(command)}")
    try:
        process = subprocess.run(
            command, capture_output=True, text=True, check=True, cwd=AUTOTAGGER_WDV3_SCRIPT_PATH.parent
        )
        logger.info(f"WDv3 Autotagger script stdout:\n{process.stdout}")
        if process.stderr: logger.warning(f"WDv3 Autotagger script stderr:\n{process.stderr}")
        return process.stdout
    except subprocess.CalledProcessError as e:
        logger.error(f"WDv3 Autotagger script failed with exit code {e.returncode}. Stdout: {e.stdout}, Stderr: {e.stderr}")
        raise RuntimeError(f"WDv3 Autotagger script execution failed: {e.stderr or e.stdout}")
    except FileNotFoundError:
        logger.error(f"Error running WDv3 command '{' '.join(command)}'. File not found.")
        raise
    except Exception as e:
        logger.error(f"An unexpected error occurred while running the WDv3 autotagger script: {e}")
        raise

# --- API Endpoint for WD-VIT-TAGGER-V3 ---
@app.post("/autotag/wd-vit-tagger-v3", summary="Autotag an image using wd-vit-tagger-v3 script")
async def autotag_wdv3_endpoint(image_upload: UploadFile = File(...)):
    temp_file_path = None
    try:
        image_bytes = await image_upload.read()
        pil_image = Image.open(BytesIO(image_bytes))
        with tempfile.NamedTemporaryFile(delete=False, suffix=".png", prefix="autotag_wdv3_") as tmp_file:
            pil_image.save(tmp_file, format="PNG")
            temp_file_path = pathlib.Path(tmp_file.name)
        logger.info(f"WDv3: Temporary image saved to: {temp_file_path}")
        
        script_output = await run_wdv3_autotagger_script(temp_file_path)
        
        match = re.search(r"Tags:\s*(.*)", script_output, re.IGNORECASE)
        if match:
            tags_list = [tag.strip() for tag in match.group(1).split(',') if tag.strip()]
            logger.info(f"WDv3: Extracted tags: {tags_list}")
            return JSONResponse(content={"tags": tags_list})
        else:
            logger.warning(f"WDv3: Could not find 'Tags:' pattern in script output: {script_output}")
            raise HTTPException(status_code=500, detail="WDv3: Failed to parse tags from script output.")
    except FileNotFoundError as e:
        logger.error(f"WDv3: Server configuration error: {e}")
        raise HTTPException(status_code=500, detail=f"WDv3: Server configuration error: {e}")
    except RuntimeError as e:
        logger.error(f"WDv3: Error during autotagging process: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    except HTTPException: raise
    except Exception as e:
        logger.error(f"WDv3: An unexpected error occurred: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="WDv3: Internal Server Error")
    finally:
        if temp_file_path and temp_file_path.exists():
            try:
                temp_file_path.unlink()
                logger.info(f"WDv3: Temporary file {temp_file_path} deleted.")
            except Exception as e_del:
                logger.error(f"WDv3: Error deleting temporary file {temp_file_path}: {e_del}")

# --- API Endpoint for REDROCKET-JOINT-TAGGER (RRJ) ---
@app.post("/autotag/redrocket-joint-tagger", summary="Autotag an image using RedRocket Joint Tagger")
async def autotag_rrj_endpoint(
    image_upload: UploadFile = File(...),
    threshold: float = Query(0.2, ge=0.0, le=1.0, description="Confidence threshold for tags (0.0 to 1.0)")
):
    if not RRJ_TAGGER_AVAILABLE or rrj_autotag_func is None:
        logger.error("RRJ: Attempted to use RedRocket Joint Tagger, but it's not available.")
        raise HTTPException(status_code=503, detail="RedRocket Joint Tagger is not available due to an initialization error. Check server logs.")

    try:
        logger.info(f"RRJ: Received request with threshold: {threshold} for image '{image_upload.filename}'")
        image_bytes = await image_upload.read()
        pil_image = Image.open(BytesIO(image_bytes))

        logger.info(f"RRJ: Running RedRocket Joint Tagger...")
        start_time = time.time()
        
        tags_with_scores = rrj_autotag_func(pil_image, threshold=threshold) # Directly call the imported function
        
        processing_time = time.time() - start_time
        logger.info(f"RRJ: Tagger completed in {processing_time:.2f} seconds.")

        tags_list = list(tags_with_scores.keys()) # Extract just the tag names
        
        # Log first few tags for brevity, or all if not too many
        log_tags_preview = tags_list[:10] if len(tags_list) > 10 else tags_list
        logger.info(f"RRJ: Extracted {len(tags_list)} tags: {log_tags_preview}{'...' if len(tags_list) > 10 else ''}")
        
        return JSONResponse(content={"tags": tags_list, "details": tags_with_scores})

    except FileNotFoundError as e: 
        logger.error(f"RRJ: File not found error during tagging: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"RRJ: Server configuration or missing file: {e}")
    except RuntimeError as e: 
        logger.error(f"RRJ: Runtime error during tagging: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"RRJ: Error during tagging process: {str(e)}")
    except TypeError as e: 
        logger.error(f"RRJ: Type error during tagging (possibly bad image or parameters): {e}", exc_info=True)
        raise HTTPException(status_code=400, detail=f"RRJ: Invalid input for tagger: {str(e)}")
    except HTTPException: 
        raise
    except Exception as e:
        logger.error(f"RRJ: An unexpected error occurred: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="RRJ: Internal Server Error during tagging")

# --- Root Endpoint to Serve tagger.html ---
@app.get("/")
async def serve_tagger_html():
    if not FRONTEND_HTML_PATH.is_file():
        logger.error(f"Frontend '{FRONTEND_HTML_PATH.name}' not found at: {FRONTEND_HTML_PATH}")
        raise HTTPException(status_code=404, detail=f"'{FRONTEND_HTML_PATH.name}' not found. Expected at: {FRONTEND_HTML_PATH}")
    logger.info(f"Serving '{FRONTEND_HTML_PATH.name}' from: {FRONTEND_HTML_PATH}")
    return FileResponse(FRONTEND_HTML_PATH, media_type="text/html")

# --- Static File Serving ---
@app.get("/assets/{file_path:path}")
async def serve_static_files(file_path):
    static_dir = API_SCRIPT_DIR.parent / "assets"
    file_path = pathlib.Path(file_path)
    full_path = static_dir / file_path

    if not full_path.is_file():
        logger.error(f"Static file '{file_path}' not found in assets directory: {full_path}")
        raise HTTPException(status_code=404, detail=f"File '{file_path}' not found in assets directory.")

    logger.info(f"Serving static file: {full_path}")
    return FileResponse(full_path, media_type="application/octet-stream")

# --- Freakin' Awesome Warning Banner Function --- (Keep as is)
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
    
    # WDv3 Tagger Info
    logger.info(f"WDv3 Tagger script expected at: {AUTOTAGGER_WDV3_SCRIPT_PATH}")
    if not AUTOTAGGER_WDV3_SCRIPT_PATH.is_file():
        logger.warning(f"CRITICAL: WDv3 Autotagger script not found at {AUTOTAGGER_WDV3_SCRIPT_PATH}. The /autotag/wd-vit-tagger-v3 endpoint will fail.")
    
    # RRJ Tagger Info (already logged during import and in lifespan, but can add a note here too)
    if RRJ_TAGGER_AVAILABLE:
        logger.info(f"RedRocket Joint Tagger is configured and should be available at /autotag/redrocket-joint-tagger.")
    else:
        logger.warning("RedRocket Joint Tagger FAILED to initialize. The /autotag/redrocket-joint-tagger endpoint will NOT work.")

    if FRONTEND_HTML_PATH.is_file():
        logger.info(f"Serving frontend '{FRONTEND_HTML_PATH.name}' from {FRONTEND_HTML_PATH} at '/' path.")
    else:
        logger.warning(f"Frontend '{FRONTEND_HTML_PATH.name}' not found at {FRONTEND_HTML_PATH}. The '/' path will return a 404 error.")

    app.state.server_host = host
    app.state.server_port = port

    print_warning_banner()

    config = uvicorn.Config(app, host=host, port=port, log_level="info")
    server = uvicorn.Server(config)
    server.run()

if __name__ == "__main__":
    serve_api()