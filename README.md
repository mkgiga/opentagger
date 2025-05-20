# opentagger
An open-source, user-friendly tool for captioning and tagging images!

## Table of Contents
- [Features](#features)
- [Todo](#todo)
  - [Prerequisites](#prerequisites)
- [Installing](#installation)
  - [Windows](#windows)
  - [Linux](#linux)
- [License](#license)
- [Acknowledgements](#acknowledgements)

## Features
- [x] Autotagging
- [x] Tag categories
- [x] Search with working syntax for AND, OR, NOT, etc.
- [x] Image and tag drag-and-drop
- [x] Project save and load
- [x] Dataset zip export
- [x] Highlight and order tags on search
- [x] Advanced command line and API (press F1 to open)

## Todo
- [ ] Add more tagging models
- [ ] Click to select image entries
- [ ] User-friendly tag curation
- [ ] User preferences
      
### Prerequisites
- Have installed Python 3

> [!WARNING]
> I have only tested this with Python 3.10 but it should work with 3.11, if there are any problems feel free to open an issue 😀

## Installing

### Release
You can download the the zip from [here](https://github.com/mkgiga/opentagger/releases/download/major/opentagger.zip)
Once you've extracted it, Windows users should right-click `run.ps1` and select `Run with PowerShell`. Linux users cd in and `chmod +x ./run.sh` then `./run.sh`

### Manual

#### Windows
1. Clone the repository by entering `git clone https://github.com/mkgiga/opentagger.git` in the command line.
2. Then run `explorer .` to open the file explorer
3. Open the `opentagger` folder, **right-click on `run.ps1` and select "Run with PowerShell"**

#### Linux
```bash
git clone https://github.com/mkgiga/opentagger.git
cd opentagger
chmod +x run.sh
./run.sh
```

## License


<blockquote>
Copyright 2025 mkgiga
  
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:  

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.  

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
</blockquote>

## Acknowledgements
- [SmilingWolf/wd-vit-tagger-v3](https://huggingface.co/SmilingWolf/wd-vit-tagger-v3) Thank you [SmilingWolf](https://huggingface.co/SmilingWolf) for the autotagging model!
- [wdv3_timm](https://github.com/neggles/wdv3-timm) ...and [neggles](https://github.com/neggles) too for the tagging script!
