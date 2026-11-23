const fs=require('node:fs');
const path=require('node:path');

function findBrowser(){
  const candidates=process.platform==='win32'?[
    path.join(process.env.PROGRAMFILES||'C:\\Program Files','Google','Chrome','Application','chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)']||'C:\\Program Files (x86)','Microsoft','Edge','Application','msedge.exe'),
    path.join(process.env.PROGRAMFILES||'C:\\Program Files','Microsoft','Edge','Application','msedge.exe'),
  ]:process.platform==='darwin'?[
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ]:[
    '/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/microsoft-edge',
  ];
  return candidates.find(candidate=>{try{return fs.statSync(candidate).isFile();}catch{return false;}})||null;
}

module.exports={findBrowser};
