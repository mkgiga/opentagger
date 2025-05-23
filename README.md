# opentagger
An open-source, user-friendly tool for captioning and tagging images!

## Table of Contents
- [Features](#features)
- [Todo](#todo)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
  - [Using the Release (Recommended)](#using-the-release-recommended)
  - [Manual Installation (via Git Clone)](#manual-installation-via-git-clone)
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
- [x] Advanced command line and commands (press F1 to open and write /help)

## Todo
- [ ] Add more tagging models
- [ ] Click to select image entries
- [ ] User-friendly bulk tag editing interface
- [ ] User preferences
- [ ] Autosaving
- [ ] Undo/Redo operation for actions that modify a project

## Prerequisites

Install Python 3 on your system 

> [!WARNING]
> I have only tested this with Python 3.10 but it should work with 3.11, if there are any problems feel free to open an issue 😀

## Installation

Here’s how to get opentagger up and running with all its features, including auto-tagging.

### Using the Release (Recommended)

This is the simplest way to get started:
1. Download the latest release zip from [here](https://github.com/mkgiga/opentagger/releases/download/major/opentagger.zip).
2. Extract the zip file to a location of your choice.
3.  - **For Windows users:** Navigate into the extracted `opentagger` folder, right-click `run.ps1`, and select `Run with PowerShell`.
    - **For Linux users:** Open your terminal, `cd` into the extracted `opentagger` folder, then execute `chmod +x ./run.sh` followed by `./run.sh`.

### Manual Installation (via Git Clone)

If you prefer to clone the repository directly:

#### Windows
1. Clone the repository by opening your command line and entering:
   `git clone https://github.com/mkgiga/opentagger.git`
2.  Navigate into the newly created `opentagger` folder (e.g., `cd opentagger`).
3.  Inside the `opentagger` folder, **right-click on `run.ps1` and select "Run with PowerShell"**.
    (You can also type `explorer .` in the command line while in the `opentagger` folder to open it in File Explorer.)

#### Linux
```bash
git clone https://github.com/mkgiga/opentagger.git
cd opentagger
chmod +x run.sh
./run.sh
```

## License

> Copyright 2025 mkgiga
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Acknowledgements
- [SmilingWolf/wd-vit-tagger-v3](https://huggingface.co/SmilingWolf/wd-vit-tagger-v3) Thank you [SmilingWolf](https://huggingface.co/SmilingWolf) for the autotagging model!
- [wdv3_timm](https://github.com/neggles/wdv3-timm) ...and [neggles](https://github.com/neggles) too for the tagging script!
