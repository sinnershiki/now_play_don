// electronまわり読み込み
const electron = require('electron');
const {app} = electron;
const {Menu} = electron;
const {ipcMain} = electron;
const {shell} = electron;
const {dialog} = electron;
const {BrowserWindow} = electron;

const electronOpenLinkInBrowser = require("electron-open-link-in-browser");
const itunes = require('playback');
const mastodon = require('mastodon-api');
const fs = require('fs');
const isOnline = require('is-online');

const Protocol = "https";
const configFilePath = __dirname +"/config/auth.json";
let M;

let authJson = null;
let baseUrl = Protocol+"://";
let beforeMusic = null;
let mainWindow = null;

app.on('ready', () => {
    // Create the Application's main menu
    const template = [
        {
            label: "Application",
            submenu: [
                { label: "About Application", selector: "orderFrontStandardAboutPanel:" },
                { type: "separator" },
                { label: "Quit", accelerator: "Command+Q", click: function() { app.quit(); }}
            ]
        },
        {
            label: "Edit",
            submenu: [
                { label: "Undo", accelerator: "CmdOrCtrl+Z", selector: "undo:" },
                { label: "Redo", accelerator: "Shift+CmdOrCtrl+Z", selector: "redo:" },
                { type: "separator" },
                { label: "Cut", accelerator: "CmdOrCtrl+X", selector: "cut:" },
                { label: "Copy", accelerator: "CmdOrCtrl+C", selector: "copy:" },
                { label: "Paste", accelerator: "CmdOrCtrl+V", selector: "paste:" },
                { label: "Select All", accelerator: "CmdOrCtrl+A", selector: "selectAll:" },
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);

    try {
        authJson = JSON.parse(fs.readFileSync(configFilePath, 'utf8'));
    } catch (e) {
        //console.log(e);
        console.log("nothing auth.json");
        authJson = JSON.parse(fs.readFileSync(configFilePath+".sample", 'utf8'));
    }

    // mainWindowを作成（windowの大きさや、Kioskモードにするかどうかなどもここで定義できる）
    mainWindow = new BrowserWindow({width: 600, height: 600});
    // ChromiumのDevツールを開く
    mainWindow.webContents.openDevTools();

    // アプリ作成設定を受け取るフック
    ipcMain.on('host', function(event, data){
        console.log(data);
        baseUrl += data.host;
        mastodon.createOAuthApp(baseUrl + '/api/v1/apps', authJson.app_name, authJson.scope)
            .catch(err => console.error(err))
            .then((res) => {
                console.log("host");
                console.log(res);
                if(res.client_id === undefined || res.client_secret === undefined ){
                    return null;
                }else{
                    authJson.host = data.host;
                    authJson.client_id = res.client_id;
                    authJson.client_secret = res.client_secret;
                    fs.writeFile(configFilePath, JSON.stringify(authJson, null, '    '));

                    mainWindow.loadURL('file://' + __dirname + '/auth.html');
                    return mastodon.getAuthorizationUrl(res.client_id, res.client_secret, baseUrl);
                }
            }).then(url => {
                if(url === null){
                    mainWindow.loadURL('file://' + __dirname + '/host.html');
                }else{
                    mainWindow.loadURL('file://' + __dirname + '/auth.html');
                    mastodon.getAuthorizationUrl(authJson.client_id, authJson.client_secret, baseUrl, authJson.scope)
                        .then(url => {
                            console.log(url);
                            shell.openExternal(url);
                        });
                }
            });
    });

    // authorization_codeをもらうためのフック
    ipcMain.on('token', function( event, data ){
        mainWindow.loadURL('file://' + __dirname + '/index.html');
        mastodon.getAccessToken(authJson.client_id, authJson.client_secret, data.authorization_code, baseUrl)
            .catch(err => console.error(err))
            .then(accessToken => {
                console.log(`This is the access token. Save it!\n${accessToken}`);
                if(accessToken === undefined){
                    mainWindow.loadURL('file://' + __dirname + '/auth.html');
                }else{
                    authJson.access_token = accessToken;
                    fs.writeFile(configFilePath, JSON.stringify(authJson, null, '    '));

                    M = new mastodon({
                        access_token: authJson.access_token,
                        timeout_ms: 60 * 1000,
                        api_url: baseUrl+"/api/v1/"
                    });

                    postNowplaying(M);
                }
            });
    });

    // now playing情報を初期化するフック
    ipcMain.on('init_now_playing', function( event ){
        itunes.currentTrack(function(data){
            let message = "#now_play_don ";
            if(data != null){
                message += data.name+" / "+data.album+" / "+data.artist;
            }else{
                message += "music / album / artist";
            }
            event.sender.send('now_playing', {message: message});
        });
    });

    if(authJson.client_id === null || authJson.client_secret === null || authJson.host === null){
        mainWindow.loadURL('file://' + __dirname + '/host.html');
    }else if(authJson.access_token === null){
        baseUrl += authJson.host;
        mainWindow.loadURL('file://' + __dirname + '/auth.html');
        mastodon.getAuthorizationUrl(authJson.client_id, authJson.client_secret, baseUrl, authJson.scope)
            .then(url => {
                console.log(url);
                shell.openExternal(url);
            });
    }else{
        baseUrl += authJson.host;
        // Electronに表示するhtmlを絶対パスで指定（相対パスだと動かない）
        mainWindow.loadURL('file://' + __dirname + '/index.html');

        M = new mastodon({
            access_token: authJson.access_token,
            timeout_ms: 60 * 1000,
            api_url: baseUrl+"/api/v1/"
        });
        postNowplaying(M);
    }

    mainWindow.on('closed', function() {
        mainWindow = null;
        app.quit();
    });
});

function postNowplaying(mastodonCli){
    itunes.on('playing', function(data){
        if(!(beforeMusic === data.name)){
            let message = "#now_play_don "+data.name+" / "+data.album+" / "+data.artist;

            isOnline().then(online => {
                if(online){
                    mastodonCli.post('statuses', {status: message}, function (err, data, res) {
                        if (err){
                            console.log(err);
                        }
                    });
                }
            });
            mainWindow.webContents.send('now_playing', { message: message });
        }
        beforeMusic = data.name;
    });
};
