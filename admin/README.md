# Control & Chaos — Decap CMS Admin Hub

This directory contains the headless, flat-file CMS admin interface for **Control & Chaos Master Portal**.

---

## 🚀 How to Run Locally (Local Editing on your PC)

Decap CMS can edit your local JSON files directly on your computer without needing a live GitHub connection or database.

### Step 1: Start the Decap local proxy server
Open PowerShell or your terminal in `J:\FinalGame\main` and run:

```bash
npx decap-server
```

### Step 2: Serve your site
In a second terminal window (or using any local web server / Live Server in VS Code):

```bash
npx serve .
# or
python -m http.server 8000
```

### Step 3: Open the Admin Panel
Go to:
`http://localhost:8000/admin/`

You will now be able to edit **Blog Posts**, **Sim Events**, and **Directory Profiles** directly with full custom field forms and instant saving to your JSON files!

---

## 🌐 Publishing to GitHub / Netlify / Cloudflare Pages

When you push this repository to GitHub or host on Netlify/Cloudflare:
1. Turn on **Netlify Identity** and **Git Gateway** (or GitHub OAuth).
2. Set `local_backend: false` in [admin/config.yml](file:///J:/FinalGame/main/admin/config.yml).
3. Access `https://your-domain.com/admin/` to edit content anywhere from your browser.
