// CC_Directory_Kiosk.lsl
// [Control & Chaos] In-World Directory, Tiered Subscription & Automated Expiration Manager
// Enables avatars to subscribe to 3 configurable tiered packages (Monthly / Lifetime),
// pay in L$ or PayPal/Credit Card, unlock self-service directory profiles, sync live status,
// and automatically sends 3-Day Expiration IM Reminders before auto-unpublishing expired listings.

string WEB_PORTAL_URL   = "https://controlandchaos.co.uk/directory/edit/";
string CHECKOUT_URL     = "https://controlandchaos.co.uk/directory/checkout/";
string UPDATE_API_URL   = "https://controlandchaos.co.uk/.netlify/functions/update-profile";

// Security Shared Secret (Must match SECRET_KEY in netlify/functions/update-profile.js)
string SECRET_KEY       = "CC_DIRECTORY_SECRET_2026_GOLD";

// Dialog handles & tracking
list   gActiveListens   = []; // [key agent, integer channel, integer listenHandle, integer expiry, string menuState]
integer gOwnerConfiguring = 0; // 1 = T1 L$, 2 = T2 L$, 3 = T3 L$, 4 = T1 $, 5 = T2 $, 6 = T3 $, 7 = Grant 30d, 8 = Grant VIP
integer gLastAuditTime    = 0;

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
    integer dayNumber = llGetUnixTime() / 86400;
    return llGetSubString(llMD5String((string)agent + ":" + (string)dayNumber + ":" + SECRET_KEY, 0), 0, 15);
}

// Generates a unique dialog channel per avatar UUID
integer GetUserChannel(key agent) {
    return (integer)("0x" + llGetSubString((string)agent, 0, 6)) | 0x80000000;
}

// =========================================================================
// 📜 SUBSCRIPTION TRACKING & AUTOMATED EXPIRATION AUDIT ENGINE
// =========================================================================
RecordSubscriber(key agent, string name, string tier, integer durationDays) {
    integer now = llGetUnixTime();
    integer currentExpiry = now;
    
    string existing = llLinksetDataRead("sub_" + (string)agent);
    if (existing != "") {
        list parts = llParseString2List(existing, ["|"], []);
        if (llGetListLength(parts) >= 3) {
            integer oldExp = (integer)llList2String(parts, 2);
            if (oldExp > now) currentExpiry = oldExp;
        }
    }
    
    integer newExpiry = currentExpiry + (durationDays * 86400);
    if (durationDays >= 3650) {
        newExpiry = now + (36500 * 86400); // Lifetime
    }
    
    // Store: name|tier|expires_unix|reminded(0 or 1)
    string record = name + "|" + tier + "|" + (string)newExpiry + "|0";
    llLinksetDataWrite("sub_" + (string)agent, record);
    
    // Update master subscriber list
    string listStr = llLinksetDataRead("subscriber_list");
    list allSubs = llCSV2List(listStr);
    if (llListFindList(allSubs, [(string)agent]) == -1) {
        allSubs += [(string)agent];
        llLinksetDataWrite("subscriber_list", llList2CSV(allSubs));
    }
}

RunSubscriptionAudit() {
    integer now = llGetUnixTime();
    gLastAuditTime = now;
    string listStr = llLinksetDataRead("subscriber_list");
    if (listStr == "") return;
    
    list allSubs = llCSV2List(listStr);
    integer count = llGetListLength(allSubs);
    integer i;
    
    llOwnerSay("🔍 [AUDIT] Running subscription expiration audit across " + (string)count + " providers...");
    
    for (i = 0; i < count; i++) {
        string uuidStr = llList2String(allSubs, i);
        key agent = (key)uuidStr;
        string record = llLinksetDataRead("sub_" + uuidStr);
        
        if (record != "") {
            list parts = llParseString2List(record, ["|"], []);
            if (llGetListLength(parts) >= 4) {
                string name = llList2String(parts, 0);
                string tier = llList2String(parts, 1);
                integer expiry = (integer)llList2String(parts, 2);
                integer reminded = (integer)llList2String(parts, 3);
                
                integer diffSeconds = expiry - now;
                integer daysLeft = diffSeconds / 86400;
                
                // 3-Day Expiration Warning Trigger
                if (diffSeconds > 0 && daysLeft <= 3 && reminded == 0) {
                    string reminderMsg = "👑 [CONTROL & CHAOS] Greetings " + name + "!\n" +
                                         "Your Directory Listing subscription expires in " + (string)daysLeft + " days.\n" +
                                         "To prevent your listing from unpublishing automatically, please renew at the in-world Kiosk or online:\n" +
                                         CHECKOUT_URL + "?uuid=" + uuidStr + "&tier=tier2";
                    llInstantMessage(agent, reminderMsg);
                    llLinksetDataWrite("sub_" + uuidStr, name + "|" + tier + "|" + (string)expiry + "|1");
                    llOwnerSay("⚠️ Sent 3-Day Expiration Reminder IM to: " + name + " (@" + uuidStr + ")");
                }
                // Expired Notice Trigger
                else if (diffSeconds <= 0 && reminded < 2) {
                    string expiredMsg = "⏳ [CONTROL & CHAOS] Notice for " + name + ":\n" +
                                        "Your Directory Listing has reached its expiration date and is now unpublished from public search.\n" +
                                        "Your rates and profile are safely saved. Renew anytime at the in-world Kiosk or online:\n" +
                                        CHECKOUT_URL + "?uuid=" + uuidStr + "&tier=tier2";
                    llInstantMessage(agent, expiredMsg);
                    llLinksetDataWrite("sub_" + uuidStr, name + "|" + tier + "|" + (string)expiry + "|2");
                    llOwnerSay("🔴 Sent Expiration Notice to: " + name + " (Unpublished).");
                }
            }
        }
    }
}

DumpAllSubscribers(key ownerKey) {
    string listStr = llLinksetDataRead("subscriber_list");
    if (listStr == "") {
        llRegionSayTo(ownerKey, 0, "📋 [SUBSCRIPTION LIST] No subscribers recorded yet.");
        return;
    }
    
    list allSubs = llCSV2List(listStr);
    integer count = llGetListLength(allSubs);
    integer now = llGetUnixTime();
    
    llRegionSayTo(ownerKey, 0, "\n📋 [CONTROL & CHAOS DIRECTORY SUBSCRIBERS (" + (string)count + " Total)]\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    
    integer i;
    for (i = 0; i < count; i++) {
        string uuidStr = llList2String(allSubs, i);
        string record = llLinksetDataRead("sub_" + uuidStr);
        if (record != "") {
            list parts = llParseString2List(record, ["|"], []);
            if (llGetListLength(parts) >= 3) {
                string name = llList2String(parts, 0);
                string tier = llList2String(parts, 1);
                integer expiry = (integer)llList2String(parts, 2);
                integer diffDays = (expiry - now) / 86400;
                
                string statusIcon = "🟢 Active";
                if (diffDays <= 0) statusIcon = "🔴 Expired (" + (string)llAbs(diffDays) + "d ago)";
                else if (diffDays <= 3) statusIcon = "🟡 Expiring (" + (string)diffDays + "d left)";
                else if (diffDays > 3000) statusIcon = "👑 VIP Lifetime";
                else statusIcon = "🟢 " + (string)diffDays + "d left";
                
                llRegionSayTo(ownerKey, 0, "• " + name + " [" + tier + "] ── " + statusIcon + " (@" + uuidStr + ")");
            }
        }
    }
    llRegionSayTo(ownerKey, 0, "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n👉 Web Admin Console: https://controlandchaos.co.uk/directory/admin/");
}

InitKiosk() {
    llSetClickAction(CLICK_ACTION_TOUCH);
    if (llGetNumberOfPrims() > 1) {
        llSetLinkPrimitiveParamsFast(LINK_SET, [PRIM_CLICK_ACTION, CLICK_ACTION_TOUCH]);
    }
    
    integer p1 = GetTierPrice(1);
    integer p2 = GetTierPrice(2);
    integer p3 = GetTierPrice(3);
    llSetPayPrice(PAY_HIDE, [p1, p2, p3, PAY_HIDE]);
    
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
    string username = llKey2Name(agent);
    string name = llGetDisplayName(agent);
    if (name == "" || name == "???") name = username;
    
    string payload = "{\"action\":\"quick_status\",\"uuid\":\"" + (string)agent + "\",\"username\":\"" + username + "\",\"name\":\"" + name + "\",\"status\":\"" + newStatus + "\",\"token\":\"" + token + "\",\"secret\":\"" + SECRET_KEY + "\"}";
    
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
    
    // 1. Record locally in LinksetData for automated reminder IMs
    RecordSubscriber(agent, name, tierName, durationDays);
    
    // 2. Sync to Web Netlify backend
    string payload = "{" +
        "\"action\":\"register_paid\"," +
        "\"uuid\":\"" + (string)agent + "\"," +
        "\"name\":\"" + name + "\"," +
        "\"username\":\"" + llKey2Name(agent) + "\"," +
        "\"tier\":\"" + tierName + "\"," +
        "\"amount\":" + (string)amount + "," +
        "\"duration_days\":" + (string)durationDays + "," +
        "\"token\":\"" + token + "\"," +
        "\"secret\":\"" + SECRET_KEY + "\"" +
    "}";
    
    llRegionSayTo(agent, 0, "⏳ Registering your '" + tierName + "' directory subscription on controlandchaos.co.uk...");
    llHTTPRequest(UPDATE_API_URL, [
        HTTP_METHOD, "POST",
        HTTP_MIMETYPE, "application/json"
    ], payload);
}

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
                    "Choose an option to manage your listing or subscribe:";
                    
    list buttons;
    if (agent == llGetOwner()) {
        buttons = [
            "🌐 Web Editor", "💳 Subscribe L$", "💳 PayPal / Card",
            "🟢 Available",  "🔴 Busy",           "📋 My Profile",
            "👑 Admin Panel", "🎁 Owner Free",   "❌ Cancel"
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

ShowAdminPanel(key agent) {
    integer channel = GetUserChannel(agent);
    
    integer idx = llListFindList(gActiveListens, [agent]);
    if (idx != -1) {
        integer oldHandle = llList2Integer(gActiveListens, idx + 2);
        llListenRemove(oldHandle);
        gActiveListens = llDeleteSubList(gActiveListens, idx, idx + 4);
    }
    
    integer handle = llListen(channel, "", agent, "");
    integer expiry = llGetUnixTime() + 60;
    gActiveListens += [agent, channel, handle, expiry, "ADMIN"];
    
    string prompt = "👑 [OWNER / ADMIN MANAGEMENT CONSOLE]\n\n" +
                    "Manage active listings, grant complimentary time, trigger reminder audits, or configure pricing:";
                    
    list buttons = [
        "📋 List Subs",    "🎁 Grant +30d",  "👑 Grant VIP",
        "🔔 Run Audit",    "⚙️ Config Tiers", "🌐 Web Admin",
        "⬅️ Main Menu",   "❌ Close"
    ];
    
    llDialog(agent, prompt, buttons, channel);
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
        "Reset Defaults", "⬅️ Admin Panel", "❌ Close"
    ];
    
    llDialog(agent, prompt, buttons, channel);
}

default {
    state_entry() {
        InitKiosk();
        gLastAuditTime = llGetUnixTime();
        llSetTimerEvent(30.0);
        llOwnerSay("✨ [DIRECTORY KIOSK] Ready! Dynamic pricing, PayPal checkout, and 3-Day Expiration Reminders active.");
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
            durationDays = 36500;
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
            else if (gOwnerConfiguring == 7) { // Grant 30d to entered UUID
                key targetKey = (key)cleanVal;
                string targetName = llKey2Name(targetKey);
                if (targetName == "") targetName = cleanVal;
                RecordSubscriber(targetKey, targetName, "Tier 2 VIP (Owner Grant)", 30);
                SendSubscriptionRegistration(targetKey, "Tier 2 VIP (Owner Grant)", 0, 30);
                llOwnerSay("🎁 Granted +30 Days to " + targetName + " (" + cleanVal + ").");
            }
            else if (gOwnerConfiguring == 8) { // Grant VIP Lifetime
                key targetKey = (key)cleanVal;
                string targetName = llKey2Name(targetKey);
                if (targetName == "") targetName = cleanVal;
                RecordSubscriber(targetKey, targetName, "Tier 3 Royal Lifetime (VIP Grant)", 36500);
                SendSubscriptionRegistration(targetKey, "Tier 3 Royal Lifetime (VIP Grant)", 0, 36500);
                llOwnerSay("👑 Granted VIP Lifetime to " + targetName + " (" + cleanVal + ").");
            }
            gOwnerConfiguring = 0;
            InitKiosk();
            ShowAdminPanel(id);
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
            else if (message == "👑 Admin Panel" && id == llGetOwner()) {
                ShowAdminPanel(id);
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
        else if (menuState == "ADMIN" && id == llGetOwner()) {
            integer chan = GetUserChannel(id);
            if (message == "📋 List Subs") {
                DumpAllSubscribers(id);
                ShowAdminPanel(id);
            }
            else if (message == "🎁 Grant +30d") {
                gOwnerConfiguring = 7;
                integer h = llListen(chan, "", id, "");
                gActiveListens += [id, chan, h, llGetUnixTime() + 60, "TEXTBOX_CONFIG"];
                llTextBox(id, "Enter Avatar UUID to grant +30 Days active subscription:", chan);
            }
            else if (message == "👑 Grant VIP") {
                gOwnerConfiguring = 8;
                integer h = llListen(chan, "", id, "");
                gActiveListens += [id, chan, h, llGetUnixTime() + 60, "TEXTBOX_CONFIG"];
                llTextBox(id, "Enter Avatar UUID to grant VIP Lifetime permanent status:", chan);
            }
            else if (message == "🔔 Run Audit") {
                RunSubscriptionAudit();
                llRegionSayTo(id, 0, "✓ Subscription expiration check and reminder sweep completed.");
                ShowAdminPanel(id);
            }
            else if (message == "⚙️ Config Tiers") {
                ShowOwnerConfigMenu(id);
            }
            else if (message == "🌐 Web Admin") {
                llLoadURL(id, "Open Web Admin Dashboard", "https://controlandchaos.co.uk/directory/admin/");
            }
            else if (message == "⬅️ Main Menu") {
                ShowMainMenu(id);
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
            else if (message == "⬅️ Admin Panel") {
                ShowAdminPanel(id);
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
        
        // 1. Clean expired listeners
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
        
        // 2. Periodic Subscription Expiration Audit Sweep (Every 3600 seconds / 1 hour)
        if (now - gLastAuditTime >= 3600) {
            RunSubscriptionAudit();
        }
    }
}
