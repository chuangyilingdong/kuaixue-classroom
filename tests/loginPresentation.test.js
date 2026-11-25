import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import typography from '../electron/account-typography.cjs';

async function stylesFor(url) {
  const contents = new EventEmitter();
  const styles = [];
  const scripts = [];
  contents.getURL = () => url;
  contents.insertCSS = async css => {styles.push(css);return 'fixture-style';};
  contents.executeJavaScript = async source => {scripts.push(source);};
  const ready = typography.applyAccountTypography(contents, 'https://aicyld.com.cn');
  contents.emit('dom-ready');
  await ready();
  return {styles,scripts};
}

test('the hosted desktop sign-in receives a silent looping video and the bundled brand', async () => {
  const {styles,scripts} = await stylesFor('https://aicyld.com.cn/kuaixue/sign-in/');
  assert.equal(styles.length, 2);
  assert.ok(styles[0].includes('Noto Sans SC'));
  assert.ok(styles[1].includes('46%'));
  assert.ok(styles[1].includes('object-fit: contain'));
  assert.equal(scripts.length,1);
  assert.ok(scripts[0].includes("URL.createObjectURL(new Blob"));
  assert.ok(!scripts[0].includes('data:video/mp4;base64,'));
  assert.ok(scripts[0].includes('data:image/png;base64,'));
  assert.ok(scripts[0].includes('video.muted = true'));
  assert.ok(scripts[0].includes('video.loop = true'));
  assert.ok(scripts[0].includes("visibilitychange"));
  assert.ok(styles[1].includes('kx-login-drift 24s linear'));
  assert.ok(styles[1].includes('prefers-reduced-motion'));
});

test('account typography scopes the login layout to its exact trusted page', async () => {
  assert.equal((await stylesFor('https://aicyld.com.cn/forgot-password')).styles.length, 1);
  assert.equal((await stylesFor('https://aicyld.com.cn/kuaixue/sign-in/other')).scripts.length, 0);
  assert.equal((await stylesFor('https://other.invalid/kuaixue/sign-in/')).styles.length, 0);
});
