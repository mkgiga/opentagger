from PIL import Image
import msgspec
import torch
import pathlib # 1. Import pathlib
from torchvision.transforms import transforms, InterpolationMode
import torchvision.transforms.functional as TF
import timm
from timm.models import VisionTransformer # Explicit import for type hinting
import safetensors.torch
from huggingface_hub import hf_hub_download
from typing import Tuple, Union # For type hints compatible with older Python versions if needed

# --- Global Configuration & Setup ---

# Determine device (CUDA GPU if available, otherwise CPU)
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print(f"Using device: {device}")

# Model and Tag Configuration
MODEL_REPO_ID = "RedRocket/JointTaggerProject"
MODEL_SUBFOLDER = "JTP_PILOT"
MODEL_FILENAME = "JTP_PILOT-e4-vit_so400m_patch14_siglip_384.safetensors"

# --- Path Configuration ---
# 2. Get the directory of the current script to resolve paths correctly
SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
TAG_FILENAME = "tagger_tags.json"
TAG_FILE_PATH = SCRIPT_DIR / TAG_FILENAME # 3. Create the full path to the tag file

# --- Helper Classes (from original script) ---

class Fit(torch.nn.Module):
    def __init__(
        self,
        bounds: Union[Tuple[int, int], int], # Using Union for broader Python compatibility for type hint
        interpolation: InterpolationMode = InterpolationMode.LANCZOS,
        grow: bool = True,
        pad: Union[float, None] = None
    ):
        super().__init__()
        self.bounds = (bounds, bounds) if isinstance(bounds, int) else bounds
        self.interpolation = interpolation
        self.grow = grow
        self.pad = pad

    def forward(self, img: Image.Image) -> Image.Image:
        wimg, himg = img.size
        hbound, wbound = self.bounds
        hscale = hbound / himg
        wscale = wbound / wimg

        if not self.grow:
            hscale = min(hscale, 1.0)
            wscale = min(wscale, 1.0)

        scale = min(hscale, wscale)
        if abs(scale - 1.0) < 1e-6: # Comparing floats for equality
            return img

        hnew = min(round(himg * scale), hbound)
        wnew = min(round(wimg * scale), wbound)
        img = TF.resize(img, (hnew, wnew), self.interpolation, antialias=True) # Added antialias for newer torchvision

        if self.pad is None:
            return img

        hpad = hbound - hnew
        wpad = wbound - wnew
        tpad = hpad // 2
        bpad = hpad - tpad
        lpad = wpad // 2
        rpad = wpad - lpad
        return TF.pad(img, (lpad, tpad, rpad, bpad), fill=self.pad if isinstance(self.pad, (int,float)) else tuple(int(x*255) for x in self.pad) if isinstance(self.pad, tuple) else 0)


    def __repr__(self) -> str:
        return (
            f"{self.__class__.__name__}("
            f"bounds={self.bounds}, "
            f"interpolation={self.interpolation.value}, "
            f"grow={self.grow}, "
            f"pad={self.pad})"
        )

class CompositeAlpha(torch.nn.Module):
    def __init__(
        self,
        background: Union[Tuple[float, float, float], float],
    ):
        super().__init__()
        if isinstance(background, (float, int)):
            bg_values = [float(background)] * 3
        else:
            if not (isinstance(background, (list, tuple)) and len(background) == 3 and all(isinstance(x, (float, int)) for x in background)):
                raise ValueError("background must be a float or a tuple/list of 3 floats.")
            bg_values = [float(x) for x in background]
        
        self.background = torch.tensor(bg_values, dtype=torch.float32, device=device).unsqueeze(1).unsqueeze(2)

    def forward(self, img: torch.Tensor) -> torch.Tensor:
        if img.shape[-3] == 3: # RGB, no alpha processing needed
            return img
        if img.shape[-3] != 4: # Not RGB or RGBA
            raise ValueError(f"CompositeAlpha expects image tensor with 3 (RGB) or 4 (RGBA) channels, got {img.shape[-3]}")

        alpha = img[..., 3:4, :, :]       # Keep dim: (B, 1, H, W) or (1, H, W)
        rgb_channels = img[..., :3, :, :] # (B, 3, H, W) or (3, H, W)
        
        premultiplied_rgb = rgb_channels * alpha
        composited_rgb = premultiplied_rgb + (1.0 - alpha) * self.background
        return composited_rgb

    def __repr__(self) -> str:
        bg_val = self.background.squeeze().cpu().tolist()
        return (
            f"{self.__class__.__name__}("
            f"background={bg_val})"
        )

# --- Transformations ---
transform = transforms.Compose([
    Fit((384, 384), pad=0.5), # PIL Image in, PIL Image out. Pad with 0.5 (gray if normalized later)
    transforms.ToTensor(),    # PIL Image [0,255] to Tensor [0,1] (C, H, W)
    CompositeAlpha(0.5),      # Tensor RGBA [0,1] to Tensor RGB [0,1]
    transforms.Normalize(mean=[0.5, 0.5, 0.5], std=[0.5, 0.5, 0.5], inplace=True), # Normalize RGB Tensor to [-1,1]
    transforms.CenterCrop((384, 384)), # Crop/Pad to ensure size
])

# --- Model Loading ---
model: VisionTransformer = timm.create_model(
    "vit_so400m_patch14_siglip_384.webli",
    pretrained=False,
    num_classes=9083,
)

try:
    cached_model_path = hf_hub_download(
        repo_id=MODEL_REPO_ID,
        subfolder=MODEL_SUBFOLDER,
        filename=MODEL_FILENAME
    )
except Exception as e:
    print(f"Error downloading model '{MODEL_FILENAME}' from Hugging Face Hub: {e}")
    raise

safetensors.torch.load_model(model, cached_model_path)
model.to(device)
model.eval()

# --- Tag Loading & Processing ---
try:
    # 4. Use the full, absolute path to open the file
    with open(TAG_FILE_PATH, "rb") as file:
        tags_data = msgspec.json.decode(file.read(), type=dict[str, int])
except FileNotFoundError:
    # Also update the error message to be more informative
    print(f"Error: Tag file '{TAG_FILE_PATH}' not found. This file is required.")
    raise
except Exception as e:
    print(f"Error loading or decoding '{TAG_FILENAME}': {e}")
    raise

# Process tags: replace underscores and create a reliable index-to-name list
processed_tags_map = {name.replace("_", " "): index for name, index in tags_data.items()}

allowed_tags = [""] * model.num_classes # type: ignore
for name, index in processed_tags_map.items():
    if 0 <= index < model.num_classes: # type: ignore
        if allowed_tags[index]: # Check for duplicate indices
             print(f"Warning: Index {index} collision. Tag '{allowed_tags[index]}' vs '{name}'. Keeping first assigned.")
        else:
            allowed_tags[index] = name
    else:
        print(f"Warning: Tag '{name}' has index {index}, which is out of bounds for model (0-{model.num_classes-1}). Skipping.") # type: ignore

# Verify all tag indices were filled (optional check)
# for i, tag_name in enumerate(allowed_tags):
#    if not tag_name:
#        print(f"Warning: No tag name found for class index {i}")


# --- Core Autotag Function ---
def autotag(image: Image.Image, threshold: float = 0.2) -> dict[str, float]:
    """
    Generates tags for a given PIL Image.

    Args:
        image: A PIL.Image.Image object.
        threshold: The minimum confidence score (0.0 to 1.0) for a tag to be included.
                   Defaults to 0.2.

    Returns:
        A dictionary where keys are tag strings and values are their confidence scores.
        The dictionary is sorted by score in descending order.
    
    Raises:
        TypeError: If the input image is not a PIL.Image.Image object.
        FileNotFoundError: If 'tagger_tags.json' is not found (raised at module load).
        Other exceptions from model loading or inference if they occur.
    """
    if not isinstance(image, Image.Image):
        raise TypeError("Input 'image' must be a PIL.Image.Image object.")

    img_converted = image.convert('RGBA') # Ensure RGBA for CompositeAlpha compatibility
    
    tensor_transformed = transform(img_converted)
    tensor_batch = tensor_transformed.unsqueeze(0).to(device)

    with torch.no_grad():
        logits = model(tensor_batch)
        probits = torch.sigmoid(logits[0]) 
        
        num_top_k = min(250, model.num_classes) # type: ignore
        top_values, top_indices = probits.topk(num_top_k)

        top_values = top_values.cpu()
        top_indices = top_indices.cpu()

    filtered_tags: dict[str, float] = {}
    for value_tensor, index_tensor in zip(top_values, top_indices):
        score = value_tensor.item()
        if score >= threshold:
            class_index = index_tensor.item()
            tag_name = allowed_tags[class_index]
            if not tag_name: # Should be caught by warnings at load time
                # print(f"Warning: No tag name for predicted class index {class_index} with score {score:.4f}")
                continue
            filtered_tags[tag_name] = score
        else:
            break # Values are sorted, so further tags will also be below threshold
            
    return filtered_tags

# --- Example Usage (for testing) ---
if __name__ == '__main__':
    print("\n--- Autotag Example Usage ---")
    
    sample_image_path = "sample_image.png" # Replace with your image path
    try:
        img = Image.open(sample_image_path)
        print(f"Successfully loaded image: {sample_image_path}")
    except FileNotFoundError:
        print(f"Sample image '{sample_image_path}' not found.")
        print("Creating a dummy 100x100 red image for testing purposes.")
        img = Image.new('RGB', (100, 100), color='red')
    except Exception as e:
        print(f"Error loading sample image: {e}")
        img = None

    if img:
        try:
            print(f"\nRunning autotag with default threshold (0.2)...")
            tags_with_scores = autotag(img) # Use default threshold
            
            if tags_with_scores:
                print("\nTags found:")
                for tag, score in tags_with_scores.items():
                    print(f"- Tag: {tag:<30} Score: {score:.4f}")
            else:
                print("\nNo tags found meeting the threshold.")
            
            # Example with a different threshold
            print(f"\nRunning autotag with threshold 0.5...")
            tags_with_scores_high_thresh = autotag(img, threshold=0.5)
            if tags_with_scores_high_thresh:
                print("\nTags found (threshold 0.5):")
                for tag, score in tags_with_scores_high_thresh.items():
                    print(f"- Tag: {tag:<30} Score: {score:.4f}")
            else:
                print("\nNo tags found meeting the 0.5 threshold.")

        except Exception as e:
            import traceback
            print(f"\nAn unexpected error occurred during autotag execution: {e}")
            traceback.print_exc()