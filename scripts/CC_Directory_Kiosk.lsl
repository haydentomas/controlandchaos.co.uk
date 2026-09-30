// CC_Directory_Kiosk.lsl
// [Control & Chaos] In-World Directory & Dominant Profile Sync Kiosk
// Enables Dominants to manage their web profile, toggle live availability, and launch their private web editor.

string WEB_PORTAL_URL   = "https://controlandchaos.com/directory/edit/";
string UPDATE_API_URL   = "https://controlandchaos.com/.netlify/functions/update-profile";

// Security Shared Secret (Must match SECRET_KEY in netlify/functions/update-profile.js)
string SECRET_KEY       = "CC_DIRECTORY_SECRET_2026_GOLD";

integer DIALOG_CHAN     = -882910;
integer gDialogListen   = 0;
key gActiveUser         = NULL_KEY;

// Generates a daily rolling cryptographic token for the avatar
string GenerateToken(key agent) {
    integer dayNumber = llGetUnixTime() / 86400; // Changes daily for security
    return llGetSubString(llMD5String((string)agent + ":" + (string)dayNumber + ":" + SECRET_KEY, 0), 0, 15);
}

LaunchWebEditor(key agent) {
    string token = GenerateToken(agent);
    string fullUrl = WEB_PORTAL_URL + "?uuid=" + (string)agent + "&token=" + token;
    llLoadURL(agent, "✨ Control & Chaos: Open your Private Profile & Rate Card Editor", fullUrl);
    llRegionSayTo(agent, 0, "👑 [DIRECTORY] Private Editor link dispatched. Check your viewer prompt or browser!");
}

SendQuickStatusUpdate(key agent, string newStatus) {
    string token = GenerateToken(agent);
    string payload = "{\"action\":\"quick_status\",\"uuid\":\"" + (string)agent + "\",\"status\":\"" + newStatus + "\",\"token\":\"" + token + "\"}";
    
    llRegionSayTo(agent, 0, "⏳ Updating your live directory status to: '" + newStatus + "'...");
    llHTTPRequest(UPDATE_API_URL, [
        HTTP_METHOD, "POST",
        HTTP_MIMETYPE, "application/json"
    ], payload);
}

ShowMenu(key agent) {
    gActiveUser = agent;
    if (gDialogListen != 0) llListenRemove(gDialogListen);
    gDialogListen = llListen(DIALOG_CHAN, "", agent, "");
    
    string name = llGetDisplayName(agent);
    if (name == "" || name == "???") name = llKey2Name(agent);
    
    string prompt = "👑 [CONTROL & CHAOS DIRECTORY PORTAL]\n" +
                    "Welcome, " + name + ".\n\n" +
                    "Select an option to update your live website profile & rate card:";
                    
    list buttons = [
        "🌐 Web Editor", "🟢 Available", "🔴 Busy",
        "🟡 By Appt",    "📋 My Profile", "❌ Cancel"
    ];
    
    llDialog(agent, prompt, buttons, DIALOG_CHAN);
    llSetTimerEvent(60.0);
}

default {
    state_entry() {
        llSetClickAction(CLICK_ACTION_TOUCH);
        llSetText("👑 Control & Chaos\n✨ Dominant Directory & Rate Card Portal\n[ Touch to Edit Profile ]", <0.83, 0.69, 0.22>, 1.0);
        llOwnerSay("✨ [DIRECTORY KIOSK] Initialized and active. Click / touch object to open menu!");
    }

    touch_start(integer total_number) {
        key toucher = llDetectedKey(0);
        ShowMenu(toucher);
    }

    listen(integer channel, string name, key id, string message) {
        if (channel != DIALOG_CHAN || id != gActiveUser) return;
        
        if (gDialogListen != 0) llListenRemove(gDialogListen);
        gDialogListen = 0;
        llSetTimerEvent(0.0);
        
        if (message == "🌐 Web Editor") {
            LaunchWebEditor(id);
        }
        else if (message == "🟢 Available") {
            SendQuickStatusUpdate(id, "Available / In-World");
        }
        else if (message == "🔴 Busy") {
            SendQuickStatusUpdate(id, "Busy / In Session");
        }
        else if (message == "🟡 By Appt") {
            SendQuickStatusUpdate(id, "By Appointment Only");
        }
        else if (message == "📋 My Profile") {
            string token = GenerateToken(id);
            string previewUrl = "https://controlandchaos.com/directory/?uuid=" + (string)id;
            llLoadURL(id, "View Public Directory Profile", previewUrl);
        }
    }

    http_response(key request_id, integer status, list metadata, string body) {
        if (status == 200 || status == 201) {
            llRegionSayTo(gActiveUser, 0, "✅ [DIRECTORY] Status updated successfully on controlandchaos.com!");
        } else {
            llRegionSayTo(gActiveUser, 0, "ℹ️ Status recorded (Code " + (string)status + "). Use '🌐 Web Editor' for full profile updates.");
        }
    }

    timer() {
        if (gDialogListen != 0) llListenRemove(gDialogListen);
        gDialogListen = 0;
        llSetTimerEvent(0.0);
    }
}
