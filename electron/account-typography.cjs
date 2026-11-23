const {readFileSync} = require('node:fs');
const path = require('node:path');

const typography = readFileSync(path.join(__dirname, 'classroom-font.css'), 'utf8');
function applyAccountTypography(contents, origin) {
  contents.on('dom-ready', () => {
    if (new URL(contents.getURL()).origin === origin) {
      void contents.insertCSS(typography).catch(() => {});
    }
  });
}
module.exports = {applyAccountTypography};
