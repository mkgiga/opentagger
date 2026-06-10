# Export the RedRocket Joint Tagger (JTP PILOT) to ONNX.
#
# The built-in (onnxruntime-node) autotagger in the desktop app can only
# run ONNX models, and RedRocket only publishes PyTorch safetensors.
# Run this once inside the autotag venv (created by run.ps1 / run.sh):
#
#   python export_jtp_onnx.py
#
# It produces jtp_pilot.onnx next to this script. Upload the file
# somewhere downloadable (e.g. your own Hugging Face repo) together with
# autotaggers/rrj/tagger_tags.json, then fill in the model's entry in
# electron/tagger.cjs (MODELS["it_so400m_patch14_siglip_384"]).
#
# Note: the exported graph expects the RRJ preprocessing (384x384
# padded square, RGB, normalized mean/std 0.5) — the renderer-side
# preprocessing in src/io/tagger.js must be extended to match before
# enabling the model.

import pathlib
import sys

import torch

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
sys.path.append(str(SCRIPT_DIR))

# Importing rrj builds the model and loads the safetensors weights
# (downloading them from Hugging Face on first run).
from autotaggers.rrj import rrj

OUTPUT_PATH = SCRIPT_DIR / "jtp_pilot.onnx"


def main() -> None:
    model = rrj.model.eval().to("cpu").float()
    dummy = torch.zeros(1, 3, 384, 384, dtype=torch.float32)

    torch.onnx.export(
        model,
        dummy,
        str(OUTPUT_PATH),
        input_names=["input"],
        output_names=["logits"],
        dynamic_axes={"input": {0: "batch"}, "logits": {0: "batch"}},
        opset_version=17,
    )
    print(f"Exported to {OUTPUT_PATH}")
    print(
        "Remember: outputs are raw logits — apply sigmoid before "
        "thresholding (the JS side must do this)."
    )


if __name__ == "__main__":
    main()
