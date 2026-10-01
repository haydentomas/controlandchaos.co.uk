// CC_Directory_Kiosk.lsl
// [Control & Chaos] In-World Directory, Tiered Subscription & Profile Sync Kiosk
// Enables avatars to subscribe to 3 configurable tiered packages (Monthly / Lifetime),
// pay in L$ or PayPal/Credit Card, unlock self-service directory profiles, and sync live status.

string WEB_PORTAL_URL   = "https://controlandchaos.co.uk/directory/edit/";
string CHECKOUT_URL     = "https://controlandchaos.co.uk/directory/checkout/";
string UPDATE_API_URL   = "https://controlandchaos.co.uk/.netlify/functions/update-profile";

// Security Shared Secret (Must match SECRET_KEY in netlify/functions/update-profile.js)
string SECRET_KEY       = "CC_DIRECTORY_SECRET_2026_GOLD";

// Dialog handles & tracking
list   gActiveListens   = []; // [key agent, integer channel, integer listenHandle, integer expiry, string menuState]
integer gOwnerConfiguring = 0; // 1 = T1 L$, 2 = T2 L$, 3 = T3 L$, 4 = T1 $, 5 = T2 $, 6 = T3 $

// =========================================================================
// 🪙 DYNAMIC TIER PRICING GETTERS & SETTERS (Persistent via LinksetData)
// =========================================================================
integer GetTierPrice(integer tierNum) {
    string val = llLinksetDataRead("tier" + (string)tierNum + "_price");
    if (val != "") return (integer)val;
    if (tierNum == 1) return 1000;
    if (tierNum == 2) return 2500;
    if (tierNum == 3) return 7500;
    return 1000;
}

string GetTierUSD(integer tierNum) {
    string val = llLinksetDataRead("tier" + (string)tierNum + "_usd");
    if (val != "") return val;
    if (tierNum == 1) return "$3.99";
    if (tierNum == 2) return "$9.99";
    if (tierNum == 3) return "$29.99";
    return "$9.99";
}

string GetTierButtonLabel(integer tierNum) {
    integer lindenPrice = GetTierPrice(tierNum);
    if (tierNum == 1) return "✨ Tier 1 (L$" + (string)lindenPrice + ")";
    if (tierNum == 2) return "👑 Tier 2 (L$" + (string)lindenPrice + ")";
    if (tierNum == 3) return "💎 Tier 3 (L$" + (string)lindenPrice + ")";
    return "Tier " + (string)tierNum;
}

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
    
    // Set Fast Pay Prices from dynamic LinksetData
    integer p1 = GetTierPrice(1);
    integer p2 = GetTierPrice(2);
    integer p3 = GetTierPrice(3);
    llSetPayPrice(PAY_HIDE, [p1, p2, p3, PAY_HIDE]);
    
    // Set hovertext
    llSetText("👑 Control & Chaos\n✨ Dominant Directory & Subscription Portal\n[ Touch to Subscribe (L$ / PayPal) or Edit Profile ]", <0.83, 0.69, 0.22>, 1.0);
}

LaunchWebEditor(key agent) {
    string token = GenerateToken(agent);
    string fullUrl = WEB_PORTAL_URL + "?uuid=" + (string)agent + "&token=" + token;
    
    llLoadURL(agent, "✨ Control & Chaos: Open your Private Profile & Rate Card Editor", fullUrl);
    llRegionSayTo(agent, 0, "👑 [DIRECTORY] Private Editor link: " + fullUrl);
}

LaunchPayPalCheckout(key agent, string tierKey) {
    string token = GenerateToken(agent);
    string name = llGetDisplayName(agent);
    if (name == "" || name == "???") name = llKey2Name(agent);
    
    string checkoutUrl = CHECKOUT_URL + "?uuid=" + (string)agent + "&name=" + llEscapeURL(name) + "&token=" + token + "&tier=" + tierKey;
    
    llLoadURL(agent, "💳 Open Secure PayPal / Card Checkout", checkoutUrl);
    llRegionSayTo(agent, 0, "💳 [PAYPAL CHECKOUT] Secure web payment link: " + checkoutUrl);
}

SendQuickStatusUpdate(key agent, string newStatus) {
    string token = GenerateToken(agent);
    string payload = "{\"action\":\"quick_status\",\"uuid\":\"" + (string)agent + "\",\"status\":\"" + newStatus + "\",\"token\":\"" + token + "\",\"secret\":\"" + SECRET_KEY + "\"}";
    
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
                    "Choose how you would like to manage your profile or subscribe:";
                    
    list buttons;
    if (agent == llGetOwner()) {
        buttons = [
            "🌐 Web Editor", "💳 Subscribe L$", "💳 PayPal / Card",
            "🟢 Available",  "🔴 Busy",           "📋 My Profile",
            "⚙️ Config Tiers", "🎁 Owner Free",   "❌ Cancel"
        ];
    } else {
        buttons = [
            "🌐 Web Editor", "💳 Subscribe L$", "💳 PayPal / Card",
            "🟢 Available",  "🔴 Busy",           "📋 My Profile",
            "ℹ️ Tier Info",   "🟡 By Appt",       "❌ Cancel"
        ];
    }
    
    llRegionSayTo(agent, 0, "👑 [DIRECTORY] Menu opened for " + name + ".");
    llDialog(agent, prompt, buttons, channel);
    llSetTimerEvent(10.0);
}

ShowSubscribeMenu(key agent) {
    integer channel = GetUserChannel(agent);
    
    integer idx = llListFindList(gActiveListens, [agent]);
    if (idx != -1) {
        integer oldHandle = llList2Integer(gActiveListens, idx + 2);
        llListenRemove(oldHandle);
        gActiveListens = llDeleteSubList(gActiveListens, idx, idx + 4);
    }
    
    integer handle = llListen(channel, "", agent, "");
    integer expiry = llGetUnixTime() + 60;
    gActiveListens += [agent, channel, handle, expiry, "SUBSCRIBE"];
    
    string prompt = "👑 [SELECT DIRECTORY LISTING TIER]\n\n" +
                    "• Tier 1 Standard: L$" + (string)GetTierPrice(1) + " / mo (" + GetTierUSD(1) + ")\n" +
                    "• Tier 2 VIP Featured: L$" + (string)GetTierPrice(2) + " / mo (" + GetTierUSD(2) + ")\n" +
                    "• Tier 3 Royal Lifetime: L$" + (string)GetTierPrice(3) + " (" + GetTierUSD(3) + ")\n\n" +
                    "Select a package to pay in L$ or choose PayPal/Card:";
                    
    list buttons = [
        GetTierButtonLabel(1), GetTierButtonLabel(2), GetTierButtonLabel(3),
        "💳 PayPal / Card", "ℹ️ Compare Tiers", "⬅️ Main Menu"
    ];
    
    llDialog(agent, prompt, buttons, channel);
}

ShowTierInfo(key agent) {
    string info = "\n💎 [CONTROL & CHAOS DIRECTORY TIERS]\n" +
                  "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
                  "✨ TIER 1 (Standard): L$" + (string)GetTierPrice(1) + " / mo (or " + GetTierUSD(1) + " via PayPal)\n" +
                  "  • Verified Directory Profile on controlandchaos.co.uk\n" +
                  "  • Self-service Live Availability Toggle (Available/Busy)\n" +
                  "  • Full Rate Card Builder & SLurl Landmark\n\n" +
                  "👑 TIER 2 (VIP Featured): L$" + (string)GetTierPrice(2) + " / mo (or " + GetTierUSD(2) + " via PayPal)\n" +
                  "  • All Tier 1 features included\n" +
                  "  • Featured VIP Badge & Prioritized Directory Placement\n" +
                  "  • Photo Gallery Lookbook & Tech Badges (Lovense/RLV/Vow)\n" +
                  "  • Wearable Rate Card HUD with Real-Time Web Sync\n\n" +
                  "💎 TIER 3 (Royal Lifetime): L$" + (string)GetTierPrice(3) + " (or " + GetTierUSD(3) + " via PayPal)\n" +
                  "  • Permanent Lifetime Listing (No recurring fees)\n" +
                  "  • Homepage Spotlight Banner & Elite VIP Recognition\n" +
                  "  • Dedicated Skybox / Venue showcase & Custom Wishlist\n" +
                  "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
                  "👉 To pay with L$: Right-click and Pay the Kiosk!\n" +
                  "👉 To pay with PayPal/Card: Touch Kiosk and select '💳 PayPal / Card'!";
    llRegionSayTo(agent, 0, info);
}

ShowOwnerConfigMenu(key agent) {
    integer channel = GetUserChannel(agent);
    
    integer idx = llListFindList(gActiveListens, [agent]);
    if (idx != -1) {
        integer oldHandle = llList2Integer(gActiveListens, idx + 2);
        llListenRemove(oldHandle);
        gActiveListens = llDeleteSubList(gActiveListens, idx, idx + 4);
    }
    
    integer handle = llListen(channel, "", agent, "");
    integer expiry = llGetUnixTime() + 60;
    gActiveListens += [agent, channel, handle, expiry, "CONFIG"];
    
    string prompt = "⚙️ [OWNER TIER CONFIGURATION CONSOLE]\n\n" +
                    "Current Pricing:\n" +
                    "• Tier 1: L$" + (string)GetTierPrice(1) + " | USD: " + GetTierUSD(1) + "\n" +
                    "• Tier 2: L$" + (string)GetTierPrice(2) + " | USD: " + GetTierUSD(2) + "\n" +
                    "• Tier 3: L$" + (string)GetTierPrice(3) + " | USD: " + GetTierUSD(3) + "\n\n" +
                    "Select a setting to modify:";
                    
    list buttons = [
        "Set T1 L$", "Set T2 L$", "Set T3 L$",
        "Set T1 USD", "Set T2 USD", "Set T3 USD",
        "Reset Defaults", "⬅️ Main Menu", "❌ Close"
    ];
    
    llDialog(agent, prompt, buttons, channel);
}

default {
    state_entry() {
        InitKiosk();
        llOwnerSay("✨ [DIRECTORY KIOSK] Ready! Dynamic pricing & PayPal checkout enabled.");
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
        integer p1 = GetTierPrice(1);
        integer p2 = GetTierPrice(2);
        integer p3 = GetTierPrice(3);
        
        string tierName;
        integer durationDays;
        
        if (amount == p1) {
            tierName = "Tier 1 Standard (Monthly)";
            durationDays = 30;
        }
        else if (amount == p2) {
            tierName = "Tier 2 VIP Featured (Monthly)";
            durationDays = 30;
        }
        else if (amount >= p3) {
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
        
        if (menuState == "TEXTBOX_CONFIG" && id == llGetOwner()) {
            string cleanVal = llStringTrim(message, STRING_TRIM);
            if (gOwnerConfiguring == 1) {
                llLinksetDataWrite("tier1_price", (string)((integer)cleanVal));
                llOwnerSay("✓ Tier 1 Linden price updated to: L$" + (string)((integer)cleanVal));
            }
            else if (gOwnerConfiguring == 2) {
                llLinksetDataWrite("tier2_price", (string)((integer)cleanVal));
                llOwnerSay("✓ Tier 2 Linden price updated to: L$" + (string)((integer)cleanVal));
            }
            else if (gOwnerConfiguring == 3) {
                llLinksetDataWrite("tier3_price", (string)((integer)cleanVal));
                llOwnerSay("✓ Tier 3 Linden price updated to: L$" + (string)((integer)cleanVal));
            }
            else if (gOwnerConfiguring == 4) {
                llLinksetDataWrite("tier1_usd", cleanVal);
                llOwnerSay("✓ Tier 1 USD price label updated to: " + cleanVal);
            }
            else if (gOwnerConfiguring == 5) {
                llLinksetDataWrite("tier2_usd", cleanVal);
                llOwnerSay("✓ Tier 2 USD price label updated to: " + cleanVal);
            }
            else if (gOwnerConfiguring == 6) {
                llLinksetDataWrite("tier3_usd", cleanVal);
                llOwnerSay("✓ Tier 3 USD price label updated to: " + cleanVal);
            }
            gOwnerConfiguring = 0;
            InitKiosk();
            ShowOwnerConfigMenu(id);
            return;
        }

        if (menuState == "MAIN") {
            if (message == "🌐 Web Editor") {
                LaunchWebEditor(id);
            }
            else if (message == "💳 Subscribe L$") {
                ShowSubscribeMenu(id);
            }
            else if (message == "💳 PayPal / Card") {
                LaunchPayPalCheckout(id, "tier2");
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
            else if (message == "⚙️ Config Tiers" && id == llGetOwner()) {
                ShowOwnerConfigMenu(id);
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
            if (message == GetTierButtonLabel(1)) {
                llRegionSayTo(id, 0, "👉 Right-click and Pay the Kiosk L$" + (string)GetTierPrice(1) + " to activate Tier 1 Standard (Monthly).");
            }
            else if (message == GetTierButtonLabel(2)) {
                llRegionSayTo(id, 0, "👉 Right-click and Pay the Kiosk L$" + (string)GetTierPrice(2) + " to activate Tier 2 VIP Featured (Monthly).");
            }
            else if (message == GetTierButtonLabel(3)) {
                llRegionSayTo(id, 0, "👉 Right-click and Pay the Kiosk L$" + (string)GetTierPrice(3) + " to activate Tier 3 Royal Lifetime.");
            }
            else if (message == "💳 PayPal / Card") {
                LaunchPayPalCheckout(id, "tier2");
            }
            else if (message == "ℹ️ Compare Tiers") {
                ShowTierInfo(id);
                ShowSubscribeMenu(id);
            }
            else if (message == "⬅️ Main Menu") {
                ShowMainMenu(id);
            }
        }
        else if (menuState == "CONFIG" && id == llGetOwner()) {
            integer chan = GetUserChannel(id);
            integer h = llListen(chan, "", id, "");
            gActiveListens += [id, chan, h, llGetUnixTime() + 60, "TEXTBOX_CONFIG"];

            if (message == "Set T1 L$") {
                gOwnerConfiguring = 1;
                llTextBox(id, "Enter new Tier 1 price in L$ (e.g. 1000):\nCurrent: L$" + (string)GetTierPrice(1), chan);
            }
            else if (message == "Set T2 L$") {
                gOwnerConfiguring = 2;
                llTextBox(id, "Enter new Tier 2 price in L$ (e.g. 2500):\nCurrent: L$" + (string)GetTierPrice(2), chan);
            }
            else if (message == "Set T3 L$") {
                gOwnerConfiguring = 3;
                llTextBox(id, "Enter new Tier 3 price in L$ (e.g. 7500):\nCurrent: L$" + (string)GetTierPrice(3), chan);
            }
            else if (message == "Set T1 USD") {
                gOwnerConfiguring = 4;
                llTextBox(id, "Enter new Tier 1 USD label (e.g. $3.99):\nCurrent: " + GetTierUSD(1), chan);
            }
            else if (message == "Set T2 USD") {
                gOwnerConfiguring = 5;
                llTextBox(id, "Enter new Tier 2 USD label (e.g. $9.99):\nCurrent: " + GetTierUSD(2), chan);
            }
            else if (message == "Set T3 USD") {
                gOwnerConfiguring = 6;
                llTextBox(id, "Enter new Tier 3 USD label (e.g. $29.99):\nCurrent: " + GetTierUSD(3), chan);
            }
            else if (message == "Reset Defaults") {
                llLinksetDataDelete("tier1_price");
                llLinksetDataDelete("tier2_price");
                llLinksetDataDelete("tier3_price");
                llLinksetDataDelete("tier1_usd");
                llLinksetDataDelete("tier2_usd");
                llLinksetDataDelete("tier3_usd");
                llOwnerSay("✓ Tier prices reset to factory defaults.");
                InitKiosk();
                ShowOwnerConfigMenu(id);
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
