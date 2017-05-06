var fs = require("fs"),
SteamUser = require("steam-user"),
SteamCommunity = require("steamcommunity");

var client = new SteamUser({
  "enablePicsCache": true
}),
community = new SteamCommunity();

var config = JSON.parse(fs.readFileSync("config.json"));
var nickname = null,
vanityname = false,
oldlicenses = [],
newlicenses = [];

var log = console.log;
console.log = function() {
    var first_parameter = arguments[0];
    var other_parameters = Array.prototype.slice.call(arguments, 1);
    function formatConsoleDate(date) {
        var day = date.getDate();
        var month = date.getMonth() + 1;
        var year = date.getFullYear();
        var hour = date.getHours();
        var minutes = date.getMinutes();
        var seconds = date.getSeconds();
        var milliseconds = date.getMilliseconds();
        return "[" + ((day < 10) ? "0" + day : day) +
        "-" + ((month < 10) ? "0" + month : month) +
        "-" + ((year < 10) ? "0" + year : year) +
        " " + ((hour < 10) ? "0" + hour : hour) +
        ":" + ((minutes < 10) ? "0" + minutes : minutes) +
        ":" + ((seconds < 10) ? "0" + seconds : seconds) +
        "." + ("00" + milliseconds).slice(-3) + "] ";
    }
    log.apply(console, [formatConsoleDate(new Date()) + first_parameter].concat(other_parameters));
}
Array.prototype.diff = function(a) {
    return this.filter(function(i) {return a.indexOf(i) < 0;});
};

if (config.winauth_usage) {
    var SteamAuth = require("steamauth");
    SteamAuth.Sync(function(error) {
        var auth = new SteamAuth(config.winauth_data);
        auth.once("ready", function() {
            config.steam_credentials.authCode = config.steam_credentials.twoFactorCode = auth.calculateCode();
            steamLogin();
        });
    });
} else {
    steamLogin();
}

function steamLogin() {
    client.logOn(config.steam_credentials);
    client.on("webSession", function(sessionID, cookies) {
        console.log("Got web session");
        community.setCookies(cookies);
    });
    client.on("error", function(error) {
        console.log(error);
    });
    client.on("accountInfo", function(name) {
        nickname = name;
    });
    client.on("appOwnershipCached", function() {    
        console.log("Cached app ownership");
    });
    client.on("licenses", function(licenses) {
        console.log("Our account now owns " + licenses.length + " license" + (licenses.length === 1 ? "" : "s"));
        if (oldlicenses.length === 0) {
            oldlicenses = licenses;
        } else {
            newlicenses = licenses;
        }
    });
    client.on("loggedOn", function(response) {
        console.log("Logged into Steam as " + client.steamID.getSteamID64());
        vanityname = client.vanityURL;
        setInterval(function() {
            var subids = newlicenses.diff(oldlicenses);
            console.log(subids.length + " New license" + (subids.length === 1 ? "" : "s") + " acquired the last " + config.delay + " hours");
            if (subids.length > 0) {
                oldlicenses = newlicenses;
                getSubInfo(subids);
            }
        }, config.delay * 3600000);
    });
}

function getSubInfo(subids) {
    client.getProductInfo([], subids, function(apps, packages) {
        var total = Object.keys(packages).length;
        var games = new Object();
        for (subid in packages) {
            var appids = packages[subid].packageinfo.appids;
            //console.log(appids);
            client.getProductInfo(appids, [], function(apps) {
                var tokenlessAppids = [];
                for (appid in apps) {
                    if (apps[appid].missingToken) {
                        tokenlessAppids.push(parseInt(appid));
                    }
                }
                //console.log(tokenlessAppids.length);
                if (tokenlessAppids.length > 0) {
                    client.getProductAccessToken(tokenlessAppids, [], function(tokens) {
                        var tokenAppids = [];
                        for (appid in tokens) {
                            tokenAppids.push({appid: parseInt(appid), access_token: tokens[appid]})
                        }
                        client.getProductInfo(tokenAppids, [], function(tokenApps) {
                            for (appid in tokenApps) {
                                apps[appid] = tokenApps[appid];
                            }
                            games[subid] = apps;
                            if (Object.keys(games).length === total) {
                                console.log("Finished getting app information from your newly acquired licenses");
                                postStatus(games);
                            }
                        });
                    });
                } else {
                    games[subid] = apps;
                    //console.dir(games);
                    if (Object.keys(games).length === total) {
                        console.log("Finished getting app information from your newly acquired licenses");
                        postStatus(games);
                    }
                }
            });
        }
    });
}

function postStatus(games) {
    var profileurl = "http://steamcommunity.com/";
    if (vanityname) {
        profileurl += "id/" + vanityname;
    } else {
        profileurl += "profiles/" + client.steamID.getSteamID64();
    }
    var formdata = new Object();
    formdata.sessionid = community.getSessionID();
    formdata.appid = Object.keys(games[Object.keys(games)[0]])[0];
    var i = 0;
    var total = 0;
    for (subid in games) {
        total += Object.keys(games[subid]).length;
    }
    var msg = "[url=" + profileurl + "]" + nickname + "[/url] now owns " + total + " more game" + (total.length === 1 ? "" : "s") + "\r\n";
    for (subid in games) {
        var apps = games[subid];
        for (appid in apps) {
            i++;
            var name = apps[appid].appinfo.common ? apps[appid].appinfo.common.name : "Unknown AppID '" + appid + "'";
            if (i === total) {
                msg += "[url=http://store.steampowered.com/app/" + appid + "/]" + name + "[/url] ([url=https://www.google.com/amp/steamdb.info/sub/" + subid + "/]" + subid + "[/url])";
            } else {
                msg += "[url=http://store.steampowered.com/app/" + appid + "/]" + name + "[/url] ([url=https://www.google.com/amp/steamdb.info/sub/" + subid + "/]" + subid + "[/url]) | ";
            }
        }
    }
    formdata.status_text = msg;
    console.log("Posting new status:")
    console.log(msg);
    community.httpRequestPost(profileurl + "/ajaxpostuserstatus/", {
        formData: formdata
    }, function(error, response, data) {
        if (error) {
            console.log(error);
        }
    });
}