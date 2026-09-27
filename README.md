# Hone

**Hone** is an AI study companion for [Fragment](https://www.usefragment.org). It lives inside your
notes and PDFs, and answers where you are working.

- **Circle it, ask it.** Draw a stroke (pen or highlighter) around a passage, or select it: a
  toolbar appears next to it. Open a **chat** about that passage, or a **tool card** to define,
  summarize, translate, explain or visualize it. Every answer leaves an icon in the margin, so you
  can reopen it later.
- **Codex does the thinking.** Hone is powered by **Codex** with your ChatGPT account: it reads
  your whole vault (notes, PDFs, handwritten pages), remembers what matters to you, and can build
  its own tools when it needs one. A **Codex panel** in the right dock lets you ask it anything,
  with approval buttons before it acts.
- **Talk to it.** A **voice conversation**, powered by **Gradium**: speak about the passage, Hone
  answers out loud.
- **reMarkable, live.** Plug your reMarkable tablet in by USB: its notebooks arrive in the vault as
  PDFs, and update as you write.
- **Scan your sheets.** Scan a QR code with your phone and photograph your paper notes: the sheet is
  detected, straightened and cleaned up, and each photo becomes a page of a PDF in the vault. Update
  any page later, or resume an existing PDF. The phone side is
  [**Hone-web_scan**](https://github.com/PhilippineBiojout/Hone-web_scan) (the website and the relay).

---

## Installation

### 1. Install Fragment

Download Fragment from **[usefragment.org](https://www.usefragment.org)** (Windows; macOS at
[usefragment.org/download/mac](https://www.usefragment.org/download/mac)), install it, and open a
folder as your vault.

**If your antivirus blocks the installer** (We haven't paid Microsoft yet...):
1. Allow the installer in your antivirus:
   - **Windows Defender**: *Windows Security → Virus & threat protection → Protection history*,
     open the entry for `Fragment Setup…`, then *Actions → Allow on device*.
   - **McAfee**: *My Protection → Quarantined items*, select `Fragment Setup…`, *Restore*; then
     *My Protection → Real-Time Scanning → Excluded files → Add file* and pick the installer.
   - **Another antivirus**: restore the file from its quarantine, then add it to its exclusions.
2. Run the installer. If SmartScreen shows *“Windows protected your PC”*, click
   *More info → Run anyway*.

### 2. Install Hone

You need **[Git](https://git-scm.com)** and **[Node.js](https://nodejs.org) 20 or later**.

```bash
cd <your-vault>/.fragment/plugins      # create this folder if it does not exist
git clone https://github.com/PhilippineBiojout/Hone.git hone
cd hone
npm install
npm run build
```

Restart Fragment, then turn Hone on: **Settings → Community plugins → turn off Restricted mode →
enable Hone**.

To update later: `git pull`, `npm install`, `npm run build`, then restart Fragment.

### 3. Connect Codex

```bash
npm install -g @openai/codex
codex login
```

`codex login` opens your browser to sign in with your ChatGPT account. Do this **before** starting
Fragment. No API key is needed.

### 4. Voice (optional)

In Fragment, press **Ctrl+P**, run **« Hone : clé Gradium… »** and paste your Gradium key.

### 5. Scan

Nothing to install: Hone uses the hosted
[Hone-web_scan](https://github.com/PhilippineBiojout/Hone-web_scan) website and relay. Click the
**QR icon** in the left ribbon, scan it with your phone, and take a photo.

- Right-click a **PDF → « Reprendre le scan »** to add pages to it, or a **folder → « Scanner dans
  ce dossier »** to start a new PDF there.
- On the phone, tap a page in the left column to update it; **« Nouveau »** starts a new PDF.

### 6. reMarkable (optional)

Plug the tablet in by USB and turn on its **USB web interface** (*Settings → Storage*). In Fragment,
click the **tablet icon** in the left ribbon and accept: your notebooks arrive in `reMarkable/`.
