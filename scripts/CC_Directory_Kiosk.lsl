// CC_Directory_Kiosk.lsl
// [Control & Chaos] In-World Directory, Tiered Subscription & Profile Sync Kiosk
// Enables avatars to subscribe to 3 tiered packages (Monthly / Lifetime), pay in L$, 
// unlock self-service directory profiles, and sync live status.

string WEB_PORTAL_URL   = "https://controlandchaos.co.uk/directory/edit/";
string UPDATE_API_URL   = "https://controlandchaos.co.uk/.netlify/functions/update-profile";

// Security Shared Secret (Must match SECRET_KEY in netlify/functions/update-profile.js)
string SECRET_KEY       = "CC_DIRECTORY_SECRET_2026_GOLD";

// =========================================================================
// 🪙 TIER PACKAGES & PRICING CONFIGURATION (Change L$ prices anytime below)
// =========================================================================
integer PRICE_TIER_1_MONTHLY = 1000;   // Tier 1: Standard Listing (30 Days)
integer PRICE_TIER_2_MONTHLY = 2500;   // Tier 2: VIP Featured Listing (30 Days)
integer PRICE_TIER_3_LIFETIME = 7500;  // Tier 3: Royal Elite / Lifetime Listing

string  NAME_TIER_1          = "✨ Tier 1 Standard (L$1k)";
string  NAME_TIER_2          = "👑 Tier 2 VIP (L$2.5k)";
string  NAME_TIER_3          = "💎 Tier 3 Royal Life (L$7.5k)";

// Dialog handles & tracking
list   gActiveListens   = []; // [key agent, integer channel, integer listenHandle, integer expiry, string menuState]
list   gSelectedTier    = []; // [key agent, integer tierPrice, string tierName]

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
    
    // Set Fast Pay Prices
    llSetPayPrice(PAY_HIDE, [PRICE_TIER_1_MONTHLY, PRICE_TIER_2_MONTHLY, PRICE_TIER_3_LIFETIME, PAY_HIDE]);
    
    // Set hovertext
    llSetText("👑 Control & Chaos\n✨ Dominant Directory & Subscription Portal\n[ Touch to Subscribe or Edit Profile ]", <0.83, 0.69, 0.22>, 1.0);
}

LaunchWebEditor(key agent) {
    string token = GenerateToken(agent);
    string fullUrl = WEB_PORTAL_URL + "?uuid=" + (string)agent + "&token=" + token;
    
    // Primary popup via llLoadURL
    llLoadURL(agent, "✨ Control & Chaos: Open your Private Profile & Rate Card Editor", fullUrl);
    
    // Chat fallback
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

SendSubscriptionRegistration(key agent, string tierName, integer amount, integer durationDays) {
    string token = GenerateToken(agent);
    string name = llGetDisplayName(agent);
    if (name == "" || name == "???") name = llKey2Name(agent);
    
    string payload = "{" +
        "\"action\":\"register_paid\"," +
        "\"uuid\":\"" + (string)agent + "\"," +
        "\"name\":\"" + name + "\"," +
        "\"username\":\"" + llKey2Name(agent) + "\"," +
        "\"tier\":\"" + tierName + "\"," +
        "\"amount\":" + (string)amount + "," +
        "\"duration_days\":" + (string)durationDays + "," +
        "\"token\":\"" + token + "\"" +
    "}";
    
    llRegionSayTo(agent, 0, "⏳ Registering your '" + tierName + "' directory subscription on controlandchaos.co.uk...");
    llHTTPRequest(UPDATE_API_URL, [
        HTTP_METHOD, "POST",
        HTTP_MIMETYPE, "application/json"
    ], payload);
}

ShowMainMenu(key agent) {
    integer channel = GetUserChannel(agent);
    
    // Clean up any existing listen
    integer idx = llListFindList(gActiveListens, [agent]);
    if (idx != -1) {
        integer oldHandle = llList2Integer(gActiveListens, idx + 2);
        llListenRemove(oldHandle);
        gActiveListens = llDeleteSubList(gActiveListens, idx, idx + 4);
    }
    
    integer handle = llListen(channel, "", agent, "");
    integer expiry = llGetUnixTime() + 60;
    gActiveListens += [agent, channel, handle, expiry, "MAIN"];
    
    string name = llGetDisplayName(agent);
    if (name == "" || name == "???") name = llKey2Name(agent);
    
    string prompt = "👑 [CONTROL & CHAOS DIRECTORY PORTAL]\n" +
                    "Welcome, " + name + ".\n\n" +
                    "Select an option below to manage your website profile or subscribe to an official listing:";
                    
    list buttons;
    if (agent == llGetOwner()) {
        buttons = [
            "🌐 Web Editor", "🟢 Available", "🔴 Busy",
            "💳 Subscribe",  "📋 My Profile", "🎁 Owner Free",
            "🟡 By Appt",    "ℹ️ Tier Info", "❌ Cancel"
        ];
    } else {
        buttons = [
            "🌐 Web Editor", "🟢 Available", "🔴 Busy",
            "💳 Subscribe",  "📋 My Profile", "🟡 By Appt",
            "ℹ️ Tier Info", "❌ Cancel"
        ];
    }
    
    llRegionSayTo(agent, 0, "👑 [DIRECTORY] Menu opened for " + name + ".");
    llDialog(agent, prompt, buttons, channel);
    llSetTimerEvent(10.0);
}

ShowSubscribeMenu(key agent) {
    integer channel = GetUserChannel(agent);
    
    // Clean up listen
    integer idx = llListFindList(gActiveListens, [agent]);
    if (idx != -1) {
        integer oldHandle = llList2Integer(gActiveListens, idx + 2);
        llListenRemove(oldHandle);
        gActiveListens = llDeleteSubList(gActiveListens, idx, idx + 4);
    }
    
    integer handle = llListen(channel, "", agent, "");
    integer expiry = llGetUnixTime() + 60;
    gActiveListens += [agent, channel, handle, expiry, "SUBSCRIBE"];
    
    string prompt = "👑 [SELECT YOUR DIRECTORY LISTING TIER]\n\n" +
                    "• Tier 1: Standard Verified Listing (L$" + (string)PRICE_TIER_1_MONTHLY + " / mo)\n" +
                    "• Tier 2: VIP Featured Placement & Lookbook (L$" + (string)PRICE_TIER_2_MONTHLY + " / mo)\n" +
                    "• Tier 3: Royal Lifetime Listing & Spotlight (L$" + (string)PRICE_TIER_3_LIFETIME + ")\n\n" +
                    "Choose a tier to pay or renew:";
                    
    list buttons = [
        NAME_TIER_1, NAME_TIER_2, NAME_TIER_3,
        "ℹ️ Compare Tiers", "⬅️ Main Menu", "❌ Cancel"
    ];
    
    llDialog(agent, prompt, buttons, channel);
}

ShowTierInfo(key agent) {
    string info = "\n💎 [CONTROL & CHAOS DIRECTORY TIERS]\n" +
                  "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
                  "✨ TIER 1 (Standard): L$" + (string)PRICE_TIER_1_MONTHLY + " / Month\n" +
                  "  • Verified Directory Profile on controlandchaos.co.uk\n" +
                  "  • Self-service Live Availability Toggle (Available/Busy)\n" +
                  "  • Full Rate Card Builder & SLurl Landmark\n\n" +
                  "👑 TIER 2 (VIP Featured): L$" + (string)PRICE_TIER_2_MONTHLY + " / Month\n" +
                  "  • All Tier 1 features included\n" +
                  "  • Featured VIP Badge & Prioritized Directory Placement\n" +
                  "  • Photo Gallery Lookbook & Tech Badges (Lovense/RLV/Vow)\n\n" +
                  "💎 TIER 3 (Royal Lifetime): L$" + (string)PRICE_TIER_3_LIFETIME + " One-Time\n" +
                  "  • Permanent Lifetime Listing (No recurring fees)\n" +
                  "  • Homepage Spotlight Banner & Elite VIP Recognition\n" +
                  "  • Dedicated Skybox / Venue showcase & Custom Wishlist\n" +
                  "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
                  "👉 To subscribe: Touch the Kiosk and choose '💳 Subscribe' or Pay the object directly!";
    llRegionSayTo(agent, 0, info);
}

// Helper: Deliver Package / Rate Card items stored in Kiosk inventory
DeliverSubscriberPackage(key buyer) {
    integer invCount = llGetInventoryNumber(INVENTORY_OBJECT);
    integer i;
    for (i = 0; i < invCount; i++) {
        string objName = llGetInventoryName(INVENTORY_OBJECT, i);
        llGiveInventory(buyer, objName);
        llRegionSayTo(buyer, 0, "🎁 [DELIVERY] Delivered '" + objName + "' to your inventory.");
    }
}

default {
    state_entry() {
        InitKiosk();
        llOwnerSay("✨ [DIRECTORY KIOSK] Initialized with 3 Subscription Tiers (Monthly / Lifetime). Ready for payments & touch!");
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
        ShowMainMenu(toucher);
    }

    money(key giver, integer amount) {
        string tierName;
        integer durationDays;
        
        if (amount == PRICE_TIER_1_MONTHLY) {
            tierName = "Tier 1 Standard (Monthly)";
            durationDays = 30;
        }
        else if (amount == PRICE_TIER_2_MONTHLY) {
            tierName = "Tier 2 VIP Featured (Monthly)";
            durationDays = 30;
        }
        else if (amount >= PRICE_TIER_3_LIFETIME) {
            tierName = "Tier 3 Royal Lifetime";
            durationDays = 36500; // 100 years / Lifetime
        }
        else {
            tierName = "Custom Subscriber (L$" + (string)amount + ")";
            durationDays = 30;
        }
        
        string name = llGetDisplayName(giver);
        if (name == "" || name == "???") name = llKey2Name(giver);
        
        llRegionSayTo(giver, 0, "💎 [DIRECTORY] Payment of L$" + (string)amount + " received from " + name + "! Unlocking " + tierName + "...");
        DeliverSubscriberPackage(giver);
        SendSubscriptionRegistration(giver, tierName, amount, durationDays);
        LaunchWebEditor(giver);
    }

    listen(integer channel, string name, key id, string message) {
        integer idx = llListFindList(gActiveListens, [id]);
        if (idx == -1) return;
        
        integer expectedChan = llList2Integer(gActiveListens, idx + 1);
        if (channel != expectedChan) return;
        
        string menuState = llList2String(gActiveListens, idx + 4);
        
        // Remove listener
        integer handle = llList2Integer(gActiveListens, idx + 2);
        llListenRemove(handle);
        gActiveListens = llDeleteSubList(gActiveListens, idx, idx + 4);
        
        if (menuState == "MAIN") {
            if (message == "🌐 Web Editor") {
                LaunchWebEditor(id);
            }
            else if (message == "💳 Subscribe") {
                ShowSubscribeMenu(id);
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
            else if (message == "ℹ️ Tier Info") {
                ShowTierInfo(id);
            }
            else if (message == "🎁 Owner Free" && id == llGetOwner()) {
                llRegionSayTo(id, 0, "👑 [OWNER GRANT] Unlocking lifetime access for your avatar...");
                DeliverSubscriberPackage(id);
                SendSubscriptionRegistration(id, "Tier 3 Royal Lifetime (Owner Grant)", 0, 36500);
                LaunchWebEditor(id);
            }
            else if (message == "❌ Cancel") {
                llRegionSayTo(id, 0, "❌ Menu closed.");
            }
        }
        else if (menuState == "SUBSCRIBE") {
            if (message == NAME_TIER_1) {
                llRegionSayTo(id, 0, "👉 Right-click and Pay the Kiosk L$" + (string)PRICE_TIER_1_MONTHLY + " to activate Tier 1 Standard (Monthly).");
            }
            else if (message == NAME_TIER_2) {
                llRegionSayTo(id, 0, "👉 Right-click and Pay the Kiosk L$" + (string)PRICE_TIER_2_MONTHLY + " to activate Tier 2 VIP Featured (Monthly).");
            }
            else if (message == NAME_TIER_3) {
                llRegionSayTo(id, 0, "👉 Right-click and Pay the Kiosk L$" + (string)PRICE_TIER_3_LIFETIME + " to activate Tier 3 Royal Lifetime.");
            }
            else if (message == "ℹ️ Compare Tiers") {
                ShowTierInfo(id);
                ShowSubscribeMenu(id);
            }
            else if (message == "⬅️ Main Menu") {
                ShowMainMenu(id);
            }
        }
    }

    http_response(key request_id, integer status, list metadata, string body) {
        if (status == 200 || status == 201) {
            llOwnerSay("✅ [DIRECTORY KIOSK] Server response: Success (Code " + (string)status + ").");
        } else {
            llOwnerSay("ℹ️ [DIRECTORY KIOSK] Server returned response code: " + (string)status);
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
                gActiveListens = llDeleteSubList(gActiveListens, i, i + 4);
            } else {
                i += 5;
            }
        }
        if (llGetListLength(gActiveListens) == 0) {
            llSetTimerEvent(0.0);
        }
    }
}
