# opentagger
An open-source, user-friendly tool for captioning and tagging images!

## Table of Contents
- [opentagger](#opentagger)
  - [Table of Contents](#table-of-contents)
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
  - [x] Danbooru-based tagging
  - [x] e621-based tagging
  - [ ] Captions
- [x] Click to select image entries
- [x] User-friendly bulk tag editing interface
- [x] User preferences
- [x] Autosaving
- [ ] Undo/Redo operation for actions that modify a project

## Prerequisites

## Installation

(old installation guide outdated, todo new guide)

## License

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Acknowledgements
- [SmilingWolf/wd-vit-tagger-v3](https://huggingface.co/SmilingWolf/wd-vit-tagger-v3) ViT v3 tagger model
- [wdv3_timm](https://github.com/neggles/wdv3-timm) Tagger script used by the python microservice
- [CodeMirror](https://codemirror.net/) for the text editor used in the console.
- [JSZip](https://stuk.github.io/jszip/) for the zip import/export functionality.
- [FileSaver.js](https://github.com/eligrey/FileSaver.js) used for saving files.
