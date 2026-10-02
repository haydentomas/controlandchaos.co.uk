// CC_Directory_Subscriptions.lsl
// Subscriber records and expiry audit for the Control & Chaos directory kiosk.

string CHECKOUT_URL = "https://controlandchaos.co.uk/directory/checkout/";

integer IsLifetimeTier(string tier) {
    string cleanTier = llToLower(tier);
    return llSubStringIndex(cleanTier, "basic lifetime") != -1 || llSubStringIndex(cleanTier, "vip lifetime") != -1 || llSubStringIndex(cleanTier, "royal lifetime") != -1;
}

SetExactSubscriber(key agent, string name, string tier, integer exactDays) {
    integer now = llGetUnixTime();
    integer lifetime = (exactDays >= 3650) || IsLifetimeTier(tier);
    integer newExpiry = 0;
    if (!lifetime) newExpiry = now + exactDays * 86400;
    
    llLinksetDataWrite("sub_" + (string)agent, name + "|" + tier + "|" + (string)newExpiry + "|0|" + (string)lifetime);

    string subscribers = llLinksetDataRead("subscriber_list");
    list allSubscribers = llCSV2List(subscribers);
    if (llListFindList(allSubscribers, [(string)agent]) == -1) {
        allSubscribers += [(string)agent];
        llLinksetDataWrite("subscriber_list", llList2CSV(allSubscribers));
    }
}

RemoveSubscriber(key agent) {
    llLinksetDataDelete("sub_" + (string)agent);
    string subscribers = llLinksetDataRead("subscriber_list");
    list allSubscribers = llCSV2List(subscribers);
    integer idx = llListFindList(allSubscribers, [(string)agent]);
    if (idx != -1) {
        allSubscribers = llDeleteSubList(allSubscribers, idx, idx);
        llLinksetDataWrite("subscriber_list", llList2CSV(allSubscribers));
    }
    llOwnerSay("🗑️ [SUBSCRIPTIONS] Removed subscriber record for " + (string)agent);
}

RecordSubscriber(key agent, string name, string tier, integer durationDays) {
    integer now = llGetUnixTime();
    integer currentExpiry = now;
    integer lifetime = durationDays >= 3650;
    string finalTier = tier;

    string existing = llLinksetDataRead("sub_" + (string)agent);
    if (existing != "") {
        list parts = llParseString2List(existing, ["|"], []);
        if (llGetListLength(parts) >= 3) {
            string oldTier = llList2String(parts, 1);
            integer oldExpiry = (integer)llList2String(parts, 2);
            integer oldLifetime = IsLifetimeTier(oldTier);
            if (llGetListLength(parts) >= 5 && llList2Integer(parts, 4) == 1) oldLifetime = TRUE;
            if (oldLifetime) {
                lifetime = TRUE;
                finalTier = oldTier;
            } else if (oldExpiry > now) {
                currentExpiry = oldExpiry;
            }
        }
    }

    integer newExpiry = 0;
    if (!lifetime) newExpiry = currentExpiry + durationDays * 86400;
    llLinksetDataWrite("sub_" + (string)agent, name + "|" + finalTier + "|" + (string)newExpiry + "|0|" + (string)lifetime);

    string subscribers = llLinksetDataRead("subscriber_list");
    list allSubscribers = llCSV2List(subscribers);
    if (llListFindList(allSubscribers, [(string)agent]) == -1) {
        allSubscribers += [(string)agent];
        llLinksetDataWrite("subscriber_list", llList2CSV(allSubscribers));
    }
}

RunSubscriptionAudit(key owner) {
    integer now = llGetUnixTime();
    string subscribers = llLinksetDataRead("subscriber_list");
    if (subscribers == "") return;

    list allSubscribers = llCSV2List(subscribers);
    integer count = llGetListLength(allSubscribers);
    integer i;
    llOwnerSay("🔍 [AUDIT] Running subscription expiration audit across " + (string)count + " providers...");

    for (i = 0; i < count; i++) {
        string uuid = llList2String(allSubscribers, i);
        string record = llLinksetDataRead("sub_" + uuid);
        if (record != "") {
            list fields = llParseString2List(record, ["|"], []);
            if (llGetListLength(fields) >= 4) {
                string name = llList2String(fields, 0);
                string tier = llList2String(fields, 1);
                integer expiry = (integer)llList2String(fields, 2);
                integer reminded = (integer)llList2String(fields, 3);
                integer lifetime = IsLifetimeTier(tier);
                if (llGetListLength(fields) >= 5 && llList2Integer(fields, 4) == 1) lifetime = TRUE;

                if (lifetime) {
                    llLinksetDataWrite("sub_" + uuid, name + "|" + tier + "|0|0|1");
                } else {
                    integer secondsLeft = expiry - now;
                    integer daysLeft = secondsLeft / 86400;
                    if (secondsLeft > 0 && daysLeft <= 3 && reminded == 0) {
                        llInstantMessage((key)uuid, "👑 [CONTROL & CHAOS] Greetings " + name + "!\nYour Directory Listing subscription expires in " + (string)daysLeft + " days.\nRenew at the in-world Kiosk or online:\n" + CHECKOUT_URL + "?uuid=" + uuid + "&tier=tier2");
                        llLinksetDataWrite("sub_" + uuid, name + "|" + tier + "|" + (string)expiry + "|1");
                        llOwnerSay("⚠️ Sent 3-Day Expiration Reminder IM to: " + name + " (@" + uuid + ")");
                    } else if (secondsLeft <= 0 && reminded < 2) {
                        llInstantMessage((key)uuid, "⏳ [CONTROL & CHAOS] Notice for " + name + ":\nYour Directory Listing subscription has expired and is hidden from public search.\nYour profile is saved. Renew at the in-world Kiosk or online:\n" + CHECKOUT_URL + "?uuid=" + uuid + "&tier=tier2");
                        llLinksetDataWrite("sub_" + uuid, name + "|" + tier + "|" + (string)expiry + "|2");
                        llOwnerSay("🔴 Sent Expiration Notice to: " + name + ".");
                    }
                }
            }
        }
    }
}

DumpAllSubscribers(key owner) {
    string subscribers = llLinksetDataRead("subscriber_list");
    if (subscribers == "") {
        llRegionSayTo(owner, 0, "📋 [SUBSCRIPTION LIST] No subscribers recorded yet.");
        return;
    }

    list allSubscribers = llCSV2List(subscribers);
    integer count = llGetListLength(allSubscribers);
    integer now = llGetUnixTime();
    llRegionSayTo(owner, 0, "\n📋 [CONTROL & CHAOS DIRECTORY SUBSCRIBERS (" + (string)count + " Total)]");
    integer i;
    for (i = 0; i < count; i++) {
        string uuid = llList2String(allSubscribers, i);
        string record = llLinksetDataRead("sub_" + uuid);
        if (record != "") {
            list fields = llParseString2List(record, ["|"], []);
            if (llGetListLength(fields) >= 3) {
                string name = llList2String(fields, 0);
                string tier = llList2String(fields, 1);
                integer expiry = (integer)llList2String(fields, 2);
                integer lifetime = IsLifetimeTier(tier);
                if (llGetListLength(fields) >= 5 && llList2Integer(fields, 4) == 1) lifetime = TRUE;
                integer daysLeft = (expiry - now) / 86400;
                string status = "🟢 " + (string)daysLeft + "d left";
                if (lifetime) status = "👑 VIP Lifetime";
                else if (daysLeft <= 0) status = "🔴 Expired (" + (string)llAbs(daysLeft) + "d ago)";
                else if (daysLeft <= 3) status = "🟡 Expiring (" + (string)daysLeft + "d left)";
                llRegionSayTo(owner, 0, "• " + name + " [" + tier + "] ── " + status + " (@" + uuid + ")");
            }
        }
    }
    llRegionSayTo(owner, 0, "👉 Web Admin Console: https://controlandchaos.co.uk/directory/admin/");
}

default {
    state_entry() {
        llSetTimerEvent(3600.0);
    }

    link_message(integer sender, integer number, string message, key id) {
        if (number == 1) {
            list fields = llParseStringKeepNulls(message, ["|"], []);
            if (llGetListLength(fields) >= 3) {
                RecordSubscriber(id, llList2String(fields, 2), llList2String(fields, 0), (integer)llList2String(fields, 1));
            }
        } else if (number == 2) {
            DumpAllSubscribers(id);
        } else if (number == 3) {
            RunSubscriptionAudit(id);
        } else if (number == 4) {
            list fields = llParseStringKeepNulls(message, ["|"], []);
            if (llGetListLength(fields) >= 3) {
                SetExactSubscriber(id, llList2String(fields, 2), llList2String(fields, 0), (integer)llList2String(fields, 1));
            }
        } else if (number == 5) {
            RemoveSubscriber(id);
        }
    }

    timer() {
        RunSubscriptionAudit(NULL_KEY);
    }
}