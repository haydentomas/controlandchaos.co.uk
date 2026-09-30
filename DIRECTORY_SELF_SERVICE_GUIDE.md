# 👑 Control & Chaos — Self-Service Dominant Directory System

This system allows verified Dominants and Service Providers to **manage and update their own website profiles, live availability, and rate cards** without needing to contact you or require manual code edits.

---

## 🌟 How It Works (The 2-Step Flow)

```
[ In-World Second Life Kiosk ]
            │
 (Dominant touches Kiosk)
            │
            ▼
[ llLoadURL() One-Click Magic Link ]
            │
            ▼
[ Web Editor: controlandchaos.com/directory/edit/ ]
  • Live Availability Toggle (🟢 Available / 🔴 Busy / 🟡 By Appt)
  • Rates & Service Builder
  • Specialties & Hardware Badges
  • Bio, Tagline & SLurl
            │
 (Clicks 'Save & Publish')
            │
            ▼
[ Netlify Serverless Backend Syncs Live Profile ]
```

---

## 📦 Files Created

| File | Location | Purpose |
| :--- | :--- | :--- |
| **`CC_Directory_Kiosk.lsl`** | `Shop/Tools/DirectoryKiosk/` & `main/scripts/` | In-world LSL script for the Estate Kiosk. Generates secure, 24h rolling avatar tokens. |
| **`index.html` (Web Editor)** | `main/directory/edit/index.html` | Luxury dark & gold self-service web editor with real-time rate card preview. |
| **`update-profile.js`** | `main/netlify/functions/update-profile.js` | Serverless backend that validates avatar tokens and commits profile updates. |

---

## 🚀 Setup Instructions

### 1. In-World Setup (Second Life)
1. Rez a luxury pedestal, terminal, or kiosk object in the **Control & Chaos Estate Office** (e.g. at `Los Pengos`).
2. Drop the **`CC_Directory_Kiosk.lsl`** script into the object contents.
3. The hovertext will display:
   ```text
   👑 Control & Chaos
   ✨ Dominant Directory & Rate Card Portal
   [ Touch to Edit Profile ]
   ```

### 2. How Dominants Use It
1. When a Dominant clicks the in-world kiosk, a dialog menu appears:
   * **`[🌐 Web Editor]`**: Sends a one-click `llLoadURL()` to their private editor:
     `https://controlandchaos.com/directory/edit/?uuid=<AVATAR_UUID>&token=<DAILY_TOKEN>`
   * **`[🟢 Available]` / `[🔴 Busy]` / `[🟡 By Appt]`**: Instantly changes their status tag on the website with 1 click right from Second Life!
   * **`[📋 My Profile]`**: Opens their public rate card page.

### 3. What the Web Editor Allows Them to Change
* **Live Status:** Available / Busy / By Appointment Only / VIP Lounge Active.
* **Identity & Titles:** Display name, SL username, role subtitle, primary location/skybox.
* **Tagline & About:** Full rich text session style and rules.
* **Specialty Tags:** FinDom, Lovense, RLV, Vow Collar, VIP Escort, etc.
* **Rate Card Builder:** Add/remove custom session tiers, hourly rates, and flat fee tribute options with live instant preview.

---

## 🔒 Security & Token Verification
* **Zero Passwords Needed:** Security is tied directly to the avatar's verified UUID via an MD5 cryptographic signature that rolls daily.
* **Scoped Permissions:** A Dominant can **only** edit their own profile; they cannot touch or view any other Dominant's data.
* **Shared Secret:** Located in `CC_Directory_Kiosk.lsl` and `netlify/functions/update-profile.js`:
  ```lsl
  string SECRET_KEY = "CC_DIRECTORY_SECRET_2026_GOLD";
  ```
  *(You can change this secret key anytime in both files if you want to rotate it).*

---

## 💡 Manual Admin Access
If you ever want to open a specific profile editor manually without logging into Second Life, you can open:
```text
https://controlandchaos.com/directory/edit/?uuid=alexis-vane&token=CC_DIRECTORY_SECRET_2026_GOLD
```
*(Or click "Enter Access Key Manually" on the edit page and type your secret key).*
