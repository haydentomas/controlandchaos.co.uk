// CC_Directory_Kiosk.lsl
// [Control & Chaos] In-World Directory, Tiered Subscription & Automated Expiration Manager
// Enables avatars to subscribe to Basic and VIP packages (Monthly / Lifetime),
// pay in L$ or PayPal/Credit Card, unlock self-service directory profiles, sync live status,
// and automatically sends 3-Day Expiration IM Reminders before auto-unpublishing expired listings.

string WEB_PORTAL_URL   = "https://controlandchaos.co.uk/directory/edit/";
string CHECKOUT_URL     = "https://controlandchaos.co.uk/directory/checkout/";
string UPDATE_API_URL   = "https://controlandchaos.co.uk/.netlify/functions/update-profile";

// Security Shared Secret (Must match SECRET_KEY in netlify/functions/update-profile.js)
string SECRET_KEY       = "CC_DIRECTORY_SECRET_2026_GOLD";

// Dialog handles & tracking
list   gActiveListens   = []; // [key agent, integer channel, integer listenHandle, integer expiry, string menuState]
list   gPendingRegistrationRequests = []; // [key HTTP request, key agent]
list   gPendingMenuRequests = []; // [key HTTP request, key agent]
integer gOwnerConfiguring = 0; // 1-4 = Basic/VIP monthly/lifetime L$ prices, 7 = Grant 30d, 8 = Grant VIP

// =========================================================================
// 🪙 DYNAMIC TIER PRICING GETTERS & SETTERS (Persistent via LinksetData)
// =========================================================================
integer GetTierPrice(integer tierNum) {
    string val = llLinksetDataRead("plan" + (string)tierNum + "_price");
    if (val != "") return (integer)val;
    if (tierNum == 1) return 1000;
    if (tierNum == 2) return 1750;
    if (tierNum == 3) return 7250;
    if (tierNum == 4) return 12250;
    return 1000;
}

string GetTierButtonLabel(integer tierNum) {
    integer lindenPrice = GetTierPrice(tierNum);
    if (tierNum == 1) return "Basic Month L$" + (string)lindenPrice;
    if (tierNum == 2) return "VIP Month L$" + (string)lindenPrice;
    if (tierNum == 3) return "Basic Life L$" + (string)lindenPrice;
    if (tierNum == 4) return "VIP Life L$" + (string)lindenPrice;
    return "Plan " + (string)tierNum;
}

// Generates a daily rolling cryptographic token for the avatar
string GenerateToken(key agent) {
    integer dayNumber = llGetUnixTime() / 86400;
    return llGetSubString(llMD5String((string)agent + ":" + (string)dayNumber + ":" + SECRET_KEY, 0), 0, 15);
}

string GeneratePaidToken(key agent, string tier, integer durationDays) {
    integer dayNumber = llGetUnixTime() / 86400;
    string payload = (string)agent + ":paid:" + tier + ":" + (string)durationDays + ":" + (string)dayNumber + ":" + SECRET_KEY;
    return llGetSubString(llMD5String(payload, 0), 0, 15);
}

// Generates a unique dialog channel per avatar UUID
integer GetUserChannel(key agent) {
    return (integer)("0x" + llGetSubString((string)agent, 0, 6)) | 0x80000000;
}

// =========================================================================
// 📜 SUBSCRIPTION TRACKING & AUTOMATED EXPIRATION AUDIT ENGINE
// =========================================================================
integer IsLifetimeTier(string tier) {
    string cleanTier = llToLower(tier);
    return llSubStringIndex(cleanTier, "royal lifetime") != -1 || llSubStringIndex(cleanTier, "vip lifetime") != -1;
}

integer HasActiveSubscription(key agent) {
    string remoteStatus = llLinksetDataRead("remote_sub_" + (string)agent);
    if (remoteStatus == "1") return TRUE;
    if (remoteStatus == "0") return FALSE;
    string record = llLinksetDataRead("sub_" + (string)agent);
    if (record == "") return FALSE;
    list parts = llParseString2List(record, ["|"], []);
    if (llGetListLength(parts) < 3) return FALSE;
    string tier = llList2String(parts, 1);
    if (IsLifetimeTier(tier)) return TRUE;
    if (llGetListLength(parts) >= 5 && llList2Integer(parts, 4) == 1) return TRUE;
    return (integer)llList2String(parts, 2) > llGetUnixTime();
}

InitKiosk() {
    llSetClickAction(CLICK_ACTION_TOUCH);
    if (llGetNumberOfPrims() > 1) {
        llSetLinkPrimitiveParamsFast(LINK_SET, [PRIM_CLICK_ACTION, CLICK_ACTION_TOUCH]);
    }
    
    integer p1 = GetTierPrice(1);
    integer p2 = GetTierPrice(2);
    integer p3 = GetTierPrice(3);
    integer p4 = GetTierPrice(4);
    llSetPayPrice(PAY_HIDE, [p1, p2, p3, p4]);
    
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

key SendSubscriptionRegistration(key agent, string tierName, integer amount, integer durationDays) {
    string token = GenerateToken(agent);
    string name = llGetDisplayName(agent);
    if (name == "" || name == "???") name = llKey2Name(agent);
    
    // 1. Record locally in LinksetData for automated reminder IMs
    llMessageLinked(LINK_SET, 1, tierName + "|" + (string)durationDays + "|" + name, agent);
    
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
        "\"payment_token\":\"" + GeneratePaidToken(agent, tierName, durationDays) + "\"" +
    "}";
    
    llRegionSayTo(agent, 0, "⏳ Registering your '" + tierName + "' directory subscription on controlandchaos.co.uk...");
    return llHTTPRequest(UPDATE_API_URL, [
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

RequestMainMenu(key agent) {
    if (agent == llGetOwner()) {
        ShowMainMenu(agent, TRUE);
        return;
    }
    string token = GenerateToken(agent);
    string url = UPDATE_API_URL + "?action=subscription_status&id=" + (string)agent + "&token=" + token;
    key request = llHTTPRequest(url, [HTTP_METHOD, "GET"], "");
    gPendingMenuRequests += [request, agent];
}

ShowMainMenu(key agent, integer hasActiveSubscription) {
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
                    "Welcome, " + name + ".\n\n";
    if (hasActiveSubscription) prompt += "Manage your directory profile:";
    else prompt += "Subscribe to unlock your directory profile:";
                    
    list buttons;
    if (!hasActiveSubscription) {
        buttons = ["💳 Subscribe", "❌ Cancel"];
    } else if (agent == llGetOwner()) {
        buttons = [
            "📋 My Profile", "👑 Admin Panel", "❌ Cancel"
        ];
    } else {
        buttons = ["📋 My Profile", "❌ Cancel"];
    }
    
    llRegionSayTo(agent, 0, "👑 [DIRECTORY] Menu opened for " + name + ".");
    llDialog(agent, prompt, buttons, channel);
}

ShowMyProfileMenu(key agent) {
    integer channel = GetUserChannel(agent);
    integer idx = llListFindList(gActiveListens, [agent]);
    if (idx != -1) {
        integer oldHandle = llList2Integer(gActiveListens, idx + 2);
        llListenRemove(oldHandle);
        gActiveListens = llDeleteSubList(gActiveListens, idx, idx + 4);
    }
    integer handle = llListen(channel, "", agent, "");
    gActiveListens += [agent, channel, handle, llGetUnixTime() + 60, "PROFILE"];
    string subscriptionSummary = "Subscription status is being refreshed.";
    string remoteVip = llLinksetDataRead("remote_sub_vip_" + (string)agent);
    if (remoteVip == "1") {
        subscriptionSummary = "Your subscription: VIP Lifetime.";
    } else {
        string daysLeft = llLinksetDataRead("remote_sub_days_" + (string)agent);
        if (daysLeft != "") subscriptionSummary = "You have " + daysLeft + " days remaining on your subscription.";
    }
    llDialog(agent, "📋 [MY DIRECTORY PROFILE]\n\n" + subscriptionSummary + "\n\nManage your live listing and profile tools:", [
        "🌐 Web Editor", "💳 Subscribe / Renew", "📄 View Public Profile",
        "🟢 Available", "🔴 Busy", "🟡 By Appt",
        "ℹ️ Tier Info", "⬅️ Back"
    ], channel);
}

ShowSubscribeMenu(key agent, string returnState) {
    integer channel = GetUserChannel(agent);
    
    integer idx = llListFindList(gActiveListens, [agent]);
    if (idx != -1) {
        integer oldHandle = llList2Integer(gActiveListens, idx + 2);
        llListenRemove(oldHandle);
        gActiveListens = llDeleteSubList(gActiveListens, idx, idx + 4);
    }
    
    integer handle = llListen(channel, "", agent, "");
    integer expiry = llGetUnixTime() + 60;
    string menuState = "SUBSCRIBE";
    if (returnState == "PROFILE") menuState = "SUBSCRIBE_PROFILE";
    gActiveListens += [agent, channel, handle, expiry, menuState];
    
    string prompt = "👑 [CHOOSE YOUR DIRECTORY PACKAGE]\n\n" +
                    "Basic monthly $3.99 / L$" + (string)GetTierPrice(1) + "\n" +
                    "VIP monthly $6.99 / L$" + (string)GetTierPrice(2) + "\n" +
                    "Basic lifetime $29 / L$" + (string)GetTierPrice(3) + "\n" +
                    "VIP lifetime $49 / L$" + (string)GetTierPrice(4) + "\n\n" +
                    "Choose a Linden price or PayPal/Card:";
                    
    list buttons = [
        GetTierButtonLabel(1), GetTierButtonLabel(2), GetTierButtonLabel(3),
        GetTierButtonLabel(4), "Pay Basic M $3.99", "Pay VIP M $6.99",
        "Pay Basic Life $29", "Pay VIP Life $49", "ℹ️ Tier Info", "⬅️ Back"
    ];
    
    llDialog(agent, prompt, buttons, channel);
}

ShowTierInfo(key agent) {
    string info = "\n💎 [CONTROL & CHAOS DIRECTORY PACKAGES]\n" +
                  "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
                  "✨ BASIC: profile, bio, status, rate card, and photo gallery.\n" +
                  "No booking form, payment links, or tribute features.\n\n" +
                  "👑 VIP: everything in Basic plus booking, payments/tributes,\n" +
                  "wishlists, socials, reviews, and hardware badges.\n\n" +
                  "Monthly: Basic $3.99 | VIP $6.99\n" +
                  "Lifetime: Basic $29 | VIP $49\n" +
                  "Choose an exact L$ amount above or use PayPal/Card.";
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
    
    string prompt = "⚙️ [OWNER PACKAGE PRICE SETTINGS]\n\n" +
                    "Current Pricing:\n" +
                    "• Basic Monthly: L$" + (string)GetTierPrice(1) + "\n" +
                    "• VIP Monthly: L$" + (string)GetTierPrice(2) + "\n" +
                    "• Basic Lifetime: L$" + (string)GetTierPrice(3) + "\n" +
                    "• VIP Lifetime: L$" + (string)GetTierPrice(4) + "\n\n" +
                    "Select a setting to modify:";
                    
    list buttons = [
        "Basic Monthly", "VIP Monthly", "Basic Lifetime", "VIP Lifetime",
        "Reset Defaults", "⬅️ Admin Panel", "❌ Close"
    ];
    
    llDialog(agent, prompt, buttons, channel);
}

default {
    state_entry() {
        InitKiosk();
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
        RequestMainMenu(toucher);
    }

    money(key giver, integer amount) {
        integer p1 = GetTierPrice(1);
        integer p2 = GetTierPrice(2);
        integer p3 = GetTierPrice(3);
        integer p4 = GetTierPrice(4);
        
        string tierName;
        integer durationDays;
        
        if (amount == p1) {
            tierName = "Basic Monthly";
            durationDays = 30;
        } else if (amount == p2) {
            tierName = "VIP Monthly";
            durationDays = 30;
        } else if (amount == p3) {
            tierName = "Basic Lifetime";
            durationDays = 36500;
        } else if (amount == p4) {
            tierName = "VIP Lifetime";
            durationDays = 36500;
        } else {
            llRegionSayTo(giver, 0, "⚠️ Please pay one of the four exact package amounts shown by the kiosk. No listing was activated.");
            llOwnerSay("⚠️ Rejected unsupported directory payment amount L$" + (string)amount + " from " + llKey2Name(giver) + ".");
            return;
        }
        
        string name = llGetDisplayName(giver);
        if (name == "" || name == "???") name = llKey2Name(giver);
        
        llRegionSayTo(giver, 0, "💎 [DIRECTORY] Payment of L$" + (string)amount + " received from " + name + "! Unlocking " + tierName + "...");
        DeliverSubscriberPackage(giver);
        key registrationRequest = SendSubscriptionRegistration(giver, tierName, amount, durationDays);
        gPendingRegistrationRequests += [registrationRequest, giver];
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
                llLinksetDataWrite("plan1_price", (string)((integer)cleanVal));
                llOwnerSay("✓ Basic Monthly price updated to: L$" + (string)((integer)cleanVal));
            }
            else if (gOwnerConfiguring == 2) {
                llLinksetDataWrite("plan2_price", (string)((integer)cleanVal));
                llOwnerSay("✓ VIP Monthly price updated to: L$" + (string)((integer)cleanVal));
            }
            else if (gOwnerConfiguring == 3) {
                llLinksetDataWrite("plan3_price", (string)((integer)cleanVal));
                llOwnerSay("✓ Basic Lifetime price updated to: L$" + (string)((integer)cleanVal));
            }
            else if (gOwnerConfiguring == 4) {
                llLinksetDataWrite("plan4_price", (string)((integer)cleanVal));
                llOwnerSay("✓ VIP Lifetime price updated to: L$" + (string)((integer)cleanVal));
            }
            else if (gOwnerConfiguring == 7) { // Grant 30d to entered UUID
                key targetKey = (key)cleanVal;
                string targetName = llKey2Name(targetKey);
                if (targetName == "") targetName = cleanVal;
                key registrationRequest = SendSubscriptionRegistration(targetKey, "VIP Monthly", 0, 30);
                gPendingRegistrationRequests += [registrationRequest, targetKey];
                llOwnerSay("🎁 Granted +30 Days to " + targetName + " (" + cleanVal + ").");
            }
            else if (gOwnerConfiguring == 8) { // Grant VIP Lifetime
                key targetKey = (key)cleanVal;
                string targetName = llKey2Name(targetKey);
                if (targetName == "") targetName = cleanVal;
                key registrationRequest = SendSubscriptionRegistration(targetKey, "VIP Lifetime", 0, 36500);
                gPendingRegistrationRequests += [registrationRequest, targetKey];
                llOwnerSay("👑 Granted VIP Lifetime to " + targetName + " (" + cleanVal + ").");
            }
            gOwnerConfiguring = 0;
            InitKiosk();
            ShowAdminPanel(id);
            return;
        }

        if (menuState == "MAIN") {
            if (message == "💳 Subscribe") ShowSubscribeMenu(id, "MAIN");
            else if (message == "📋 My Profile" && HasActiveSubscription(id)) ShowMyProfileMenu(id);
            else if (message == "👑 Admin Panel" && id == llGetOwner()) {
                ShowAdminPanel(id);
            }
            else if (message == "❌ Cancel") {
                llRegionSayTo(id, 0, "❌ Menu closed.");
            }
        }
        else if (menuState == "PROFILE" && HasActiveSubscription(id)) {
            if (message == "🌐 Web Editor") LaunchWebEditor(id);
            else if (message == "💳 Subscribe / Renew") ShowSubscribeMenu(id, "PROFILE");
            else if (message == "📄 View Public Profile") {
                string previewUrl = "https://controlandchaos.co.uk/directory/?uuid=" + (string)id;
                llLoadURL(id, "View Public Directory Profile", previewUrl);
            }
            else if (message == "🟢 Available") SendQuickStatusUpdate(id, "Available / In-World");
            else if (message == "🔴 Busy") SendQuickStatusUpdate(id, "Busy / In Session");
            else if (message == "🟡 By Appt") SendQuickStatusUpdate(id, "By Appointment Only");
            else if (message == "ℹ️ Tier Info") {
                ShowTierInfo(id);
                ShowMyProfileMenu(id);
            }
            else if (message == "⬅️ Back") ShowMainMenu(id, TRUE);
        }
        else if (menuState == "ADMIN" && id == llGetOwner()) {
            integer chan = GetUserChannel(id);
            if (message == "📋 List Subs") {
                llMessageLinked(LINK_SET, 2, "", id);
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
                llMessageLinked(LINK_SET, 3, "", id);
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
                ShowMainMenu(id, HasActiveSubscription(id));
            }
        }
        else if (menuState == "SUBSCRIBE" || menuState == "SUBSCRIBE_PROFILE") {
            if (message == GetTierButtonLabel(1)) {
                llRegionSayTo(id, 0, "Right-click and pay exactly L$" + (string)GetTierPrice(1) + " for Basic Monthly.");
            } else if (message == GetTierButtonLabel(2)) {
                llRegionSayTo(id, 0, "Right-click and pay exactly L$" + (string)GetTierPrice(2) + " for VIP Monthly.");
            } else if (message == GetTierButtonLabel(3)) {
                llRegionSayTo(id, 0, "Right-click and pay exactly L$" + (string)GetTierPrice(3) + " for Basic Lifetime.");
            } else if (message == GetTierButtonLabel(4)) {
                llRegionSayTo(id, 0, "Right-click and pay exactly L$" + (string)GetTierPrice(4) + " for VIP Lifetime.");
            } else if (message == "Pay Basic M $3.99") {
                LaunchPayPalCheckout(id, "basic-monthly");
            } else if (message == "Pay VIP M $6.99") {
                LaunchPayPalCheckout(id, "vip-monthly");
            } else if (message == "Pay Basic Life $29") {
                LaunchPayPalCheckout(id, "basic-lifetime");
            } else if (message == "Pay VIP Life $49") {
                LaunchPayPalCheckout(id, "vip-lifetime");
            }
            else if (message == "ℹ️ Tier Info") {
                ShowTierInfo(id);
                if (menuState == "SUBSCRIBE_PROFILE") ShowSubscribeMenu(id, "PROFILE");
                else ShowSubscribeMenu(id, "MAIN");
            }
            else if (message == "⬅️ Back") {
                if (menuState == "SUBSCRIBE_PROFILE") ShowMyProfileMenu(id);
                else ShowMainMenu(id, FALSE);
            }
        }
        else if (menuState == "CONFIG" && id == llGetOwner()) {
            integer chan = GetUserChannel(id);

            if (message == "Basic Monthly") {
                gOwnerConfiguring = 1;
                integer h = llListen(chan, "", id, "");
                gActiveListens += [id, chan, h, llGetUnixTime() + 60, "TEXTBOX_CONFIG"];
                llTextBox(id, "Set Basic Monthly L$ price.\nCurrent: L$" + (string)GetTierPrice(1), chan);
            } else if (message == "VIP Monthly") {
                gOwnerConfiguring = 2;
                integer h = llListen(chan, "", id, "");
                gActiveListens += [id, chan, h, llGetUnixTime() + 60, "TEXTBOX_CONFIG"];
                llTextBox(id, "Set VIP Monthly L$ price.\nCurrent: L$" + (string)GetTierPrice(2), chan);
            } else if (message == "Basic Lifetime") {
                gOwnerConfiguring = 3;
                integer h = llListen(chan, "", id, "");
                gActiveListens += [id, chan, h, llGetUnixTime() + 60, "TEXTBOX_CONFIG"];
                llTextBox(id, "Set Basic Lifetime L$ price.\nCurrent: L$" + (string)GetTierPrice(3), chan);
            } else if (message == "VIP Lifetime") {
                gOwnerConfiguring = 4;
                integer h = llListen(chan, "", id, "");
                gActiveListens += [id, chan, h, llGetUnixTime() + 60, "TEXTBOX_CONFIG"];
                llTextBox(id, "Set VIP Lifetime L$ price.\nCurrent: L$" + (string)GetTierPrice(4), chan);
            } else if (message == "Reset Defaults") {
                llLinksetDataDelete("plan1_price");
                llLinksetDataDelete("plan2_price");
                llLinksetDataDelete("plan3_price");
                llLinksetDataDelete("plan4_price");
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
        integer menuIndex = llListFindList(gPendingMenuRequests, [request_id]);
        if (menuIndex != -1) {
            key menuAgent = llList2Key(gPendingMenuRequests, menuIndex + 1);
            gPendingMenuRequests = llDeleteSubList(gPendingMenuRequests, menuIndex, menuIndex + 1);
            integer isActive = FALSE;
            if (status == 200 && llSubStringIndex(body, "\"active\":true") != -1) isActive = TRUE;
            if (menuAgent == llGetOwner()) isActive = TRUE;
            string daysMarker = "\"days_left\":";
            integer daysStart = llSubStringIndex(body, daysMarker);
            if (daysStart != -1) {
                daysStart += llStringLength(daysMarker);
                integer daysEnd = llSubStringIndex(llGetSubString(body, daysStart, -1), ",");
                if (daysEnd != -1) llLinksetDataWrite("remote_sub_days_" + (string)menuAgent, llGetSubString(body, daysStart, daysStart + daysEnd - 1));
            }
            if (llSubStringIndex(body, "\"is_vip\":true") != -1) llLinksetDataWrite("remote_sub_vip_" + (string)menuAgent, "1");
            else llLinksetDataWrite("remote_sub_vip_" + (string)menuAgent, "0");
            llLinksetDataWrite("remote_sub_" + (string)menuAgent, (string)isActive);
            ShowMainMenu(menuAgent, isActive);
        }
        integer pendingIndex = llListFindList(gPendingRegistrationRequests, [request_id]);
        if (pendingIndex != -1) {
            key subscriber = llList2Key(gPendingRegistrationRequests, pendingIndex + 1);
            gPendingRegistrationRequests = llDeleteSubList(gPendingRegistrationRequests, pendingIndex, pendingIndex + 1);
            if (status == 200 || status == 201) {
                LaunchWebEditor(subscriber);
            } else {
                llOwnerSay("⚠️ [DIRECTORY] Subscription registration failed for " + (string)subscriber + "; HTTP " + (string)status + ": " + llGetSubString(body, 0, 255));
                llRegionSayTo(subscriber, 0, "⚠️ [DIRECTORY] Payment was received, but access could not be activated (server error " + (string)status + "). Please contact the estate manager with your payment time.");
            }
        }
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
        
    }
}
