// electronまわり読み込み
const electron = require('electron');
const {app} = electron;
const {Menu} = electron;
const {ipcMain} = electron;
const {shell} = electron;

const electronOpenLinkInBrowser = require("electron-open-link-in-browser");
const itunes = require('playback');
const mastodon = require('mastodon-api');
const fs = require('fs');
const menubar = require('menubar');
const mb = menubar();

const Protocol = "https";
const configFileName = "auth.json";
let M;

let config = null;
let baseUrl = Protocol+"://";
let beforeMusic = null;
let mainWindow = null;
let configFilePath = "";
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

mb.on('ready', () => {
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);

    try {
        configFilePath = app.getPath('userData') + configFileName;
        config = JSON.parse(fs.readFileSync(configFilePath, 'utf8'));
    } catch (e) {
        console.log("nothing auth.json");
        config = JSON.parse(fs.readFileSync(__dirname+"/config/"+configFileName+".sample", 'utf8'));
    }

    // menubarのwindowを表示
    mb.showWindow();

    // アプリ作成設定を受け取るフック
    ipcMain.on('host', function(event, data){
        baseUrl += data.host;
        mastodon.createOAuthApp(baseUrl + '/api/v1/apps', config.app_name, config.scope)
            .catch(err => console.error(err))
            .then((res) => {
                if(res.client_id === undefined || res.client_secret === undefined ){
                    return null;
                }else{
                    config.host = data.host;
                    config.client_id = res.client_id;
                    config.client_secret = res.client_secret;
                    fs.writeFile(configFilePath, JSON.stringify(config, null, '    '));

                    //mainWindow.loadURL('file://' + __dirname + '/auth.html');
                    //mb.setOpion("index", 'file://' + __dirname + '/auth.html');
                    return mastodon.getAuthorizationUrl(res.client_id, res.client_secret, baseUrl);
                }
            }).then(url => {
                if(url === null){
                    //mainWindow.loadURL('file://' + __dirname + '/host.html');
                    //mb.setOpion("index", 'file://' + __dirname + '/host.html');
                }else{
                    //mainWindow.loadURL('file://' + __dirname + '/auth.html');
                    //mb.setOpion("index", 'file://' + __dirname + '/auth.html');
                    mastodon.getAuthorizationUrl(config.client_id, config.client_secret, baseUrl, config.scope)
                        .then(url => {
                            shell.openExternal(url);
                        });
                }
            });
    });

    // authorization_codeをもらうためのフック
    ipcMain.on('token', function( event, data ){
        //mainWindow.loadURL('file://' + __dirname + '/index.html');
        mastodon.getAccessToken(config.client_id, config.client_secret, data.authorization_code, baseUrl)
            .catch(err => console.error(err))
            .then(accessToken => {
                console.log(`This is the access token. Save it!\n${accessToken}`);
                if(accessToken === undefined){
                    //mainWindow.loadURL('file://' + __dirname + '/auth.html');
                    //mb.setOpion("index", 'file://' + __dirname + '/auth.html');
                }else{
                    config.access_token = accessToken;
                    fs.writeFile(configFilePath, JSON.stringify(config, null, '    '));

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
    ipcMain.on('init', function( event ){
        itunes.currentTrack(function(data){
            let message = "#now_play_don ";
            if(data != null){
                message += data.name+" / "+data.album+" / "+data.artist;
            }else{
                message += "music / album / artist";
            }

            let sendData = {host: config.host, existToken: Boolean(config.access_token), message: message};
            console.log(sendData);
            event.sender.send('init', sendData);
        });
    });

    if(config.client_id === null || config.client_secret === null || config.host === null){
        //mainWindow.loadURL('file://' + __dirname + '/host.html');
        //mb.setOpion("index", 'file://' + __dirname + '/host.html');
    }else if(config.access_token === null){
        baseUrl += config.host;
        //mainWindow.loadURL('file://' + __dirname + '/auth.html');
        //mb.setOpion("index", 'file://' + __dirname + '/auth.html');
        mastodon.getAuthorizationUrl(config.client_id, config.client_secret, baseUrl, config.scope)
            .then(url => {
                console.log(url);
                shell.openExternal(url);
            });
    }else{
        baseUrl += config.host;
        // Electronに表示するhtmlを絶対パスで指定（相対パスだと動かない）
        //mainWindow.loadURL('file://' + __dirname + '/index.html');

        postNowplaying(config.access_token);
    }
});

function postNowplaying(mastodonCli){
    itunes.on('playing', function(data){
        if(!(beforeMusic === data.name)){
            let message = "#now_play_don "+data.name+" / "+data.album+" / "+data.artist;

            /*M.post('statuses', {status: message}, function (err, data, res) {
                if (err){
                    console.log(err);
                }
            });*/

            mb.window.webContents.send('now_playing', { message: message });
        }
        beforeMusic = data.name;
    });
};
