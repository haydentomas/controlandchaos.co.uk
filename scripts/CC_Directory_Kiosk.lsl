// CC_Directory_Kiosk.lsl
// [Control & Chaos] In-World Directory & Dominant Profile Sync Kiosk
// Enables Dominants / Subscribers to manage their web profile, toggle live availability, and launch their private web editor.

string WEB_PORTAL_URL   = "https://controlandchaos.co.uk/directory/edit/";
string UPDATE_API_URL   = "https://controlandchaos.co.uk/.netlify/functions/update-profile";

// Security Shared Secret (Must match SECRET_KEY in netlify/functions/update-profile.js)
string SECRET_KEY       = "CC_DIRECTORY_SECRET_2026_GOLD";

// Dialog handles & tracking
list   gActiveListens   = []; // [key agent, integer channel, integer listenHandle, integer expiry]

// Generates a daily rolling cryptographic token for the avatar
string GenerateToken(key agent) {
    integer dayNumber = llGetUnixTime() / 86400; // Changes daily for security
    return llGetSubString(llMD5String((string)agent + ":" + (string)dayNumber + ":" + SECRET_KEY, 0), 0, 15);
}

// Generates a unique dialog channel per avatar UUID
integer GetUserChannel(key agent) {
    return (integer)("0x" + llGetSubString((string)agent, 0, 6)) | 0x80000000;
}

InitKiosk() {
    // Force touch action on root and all linked child prims
    llSetClickAction(CLICK_ACTION_TOUCH);
    if (llGetNumberOfPrims() > 1) {
        llSetLinkPrimitiveParamsFast(LINK_SET, [PRIM_CLICK_ACTION, CLICK_ACTION_TOUCH]);
    }
    
    // Set hovertext
    llSetText("👑 Control & Chaos\n✨ Dominant Directory & Rate Card Portal\n[ Touch to Edit Profile ]", <0.83, 0.69, 0.22>, 1.0);
}

LaunchWebEditor(key agent) {
    string token = GenerateToken(agent);
    string fullUrl = WEB_PORTAL_URL + "?uuid=" + (string)agent + "&token=" + token;
    
    // Primary popup via llLoadURL
    llLoadURL(agent, "✨ Control & Chaos: Open your Private Profile & Rate Card Editor", fullUrl);
    
    // Chat fallback in case the avatar's viewer blocks LoadURL popups
    llRegionSayTo(agent, 0, "👑 [DIRECTORY] Private Editor link: " + fullUrl);
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
    integer channel = GetUserChannel(agent);
    
    // Clean up any existing listen for this avatar
    integer idx = llListFindList(gActiveListens, [agent]);
    if (idx != -1) {
        integer oldHandle = llList2Integer(gActiveListens, idx + 2);
        llListenRemove(oldHandle);
        gActiveListens = llDeleteSubList(gActiveListens, idx, idx + 3);
    }
    
    integer handle = llListen(channel, "", agent, "");
    integer expiry = llGetUnixTime() + 60;
    gActiveListens += [agent, channel, handle, expiry];
    
    string name = llGetDisplayName(agent);
    if (name == "" || name == "???") name = llKey2Name(agent);
    
    string prompt = "👑 [CONTROL & CHAOS DIRECTORY PORTAL]\n" +
                    "Welcome, " + name + ".\n\n" +
                    "Select an option to update your live website profile & rate card:";
                    
    list buttons = [
        "🌐 Web Editor", "🟢 Available", "🔴 Busy",
        "🟡 By Appt",    "📋 My Profile", "❌ Cancel"
    ];
    
    llRegionSayTo(agent, 0, "👑 [DIRECTORY] Opening menu for " + name + "...");
    llDialog(agent, prompt, buttons, channel);
    llSetTimerEvent(10.0);
}

default {
    state_entry() {
        InitKiosk();
        llOwnerSay("✨ [DIRECTORY KIOSK] Initialized and ready. Touch object to test!");
    }

    on_rez(integer start_param) {
        llResetScript();
    }

    changed(integer change) {
        if (change & (CHANGED_OWNER | CHANGED_LINK)) {
            llResetScript();
        }
    }

    touch_start(integer total_number) {
        key toucher = llDetectedKey(0);
        ShowMenu(toucher);
    }

    listen(integer channel, string name, key id, string message) {
        integer idx = llListFindList(gActiveListens, [id]);
        if (idx == -1) return;
        
        integer expectedChan = llList2Integer(gActiveListens, idx + 1);
        if (channel != expectedChan) return;
        
        // Remove listener
        integer handle = llList2Integer(gActiveListens, idx + 2);
        llListenRemove(handle);
        gActiveListens = llDeleteSubList(gActiveListens, idx, idx + 3);
        
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
            string previewUrl = "https://controlandchaos.co.uk/directory/?uuid=" + (string)id;
            llLoadURL(id, "View Public Directory Profile", previewUrl);
            llRegionSayTo(id, 0, "📋 [DIRECTORY] Public profile: " + previewUrl);
        }
        else if (message == "❌ Cancel") {
            llRegionSayTo(id, 0, "❌ Menu closed.");
        }
    }

    http_response(key request_id, integer status, list metadata, string body) {
        if (status == 200 || status == 201) {
            llOwnerSay("✅ [DIRECTORY KIOSK] Status update processed successfully (Code " + (string)status + ").");
        } else {
            llOwnerSay("ℹ️ [DIRECTORY KIOSK] Status update returned response code: " + (string)status);
        }
    }

    timer() {
        integer now = llGetUnixTime();
        integer i = 0;
        while (i < llGetListLength(gActiveListens)) {
            integer expiry = llList2Integer(gActiveListens, i + 3);
            if (now >= expiry) {
                integer handle = llList2Integer(gActiveListens, i + 2);
                llListenRemove(handle);
                gActiveListens = llDeleteSubList(gActiveListens, i, i + 3);
            } else {
                i += 4;
            }
        }
        if (llGetListLength(gActiveListens) == 0) {
            llSetTimerEvent(0.0);
        }
    }
}
