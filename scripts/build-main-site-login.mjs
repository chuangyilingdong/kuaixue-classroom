import { build } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { copyFile, mkdir } from 'node:fs/promises';

// Reuse the account team's exact captcha components and their utility classes at build time.
const siteRoot = process.argv[2];
if (!siteRoot) throw Error('用法: node scripts/build-main-site-login.mjs <主站源码目录>');
const site = path.resolve(siteRoot);
const fromSite = createRequire(path.join(site, 'package.json'));
const root = fileURLToPath(new URL('../integrations/main-site-login/', import.meta.url));
const client = path.join(site, 'src/client');
const output = path.resolve(root, '../../release/kx-class-login-site');
const tailwind = fromSite('tailwindcss');
await build({ configFile:false, root, base:'./', plugins:[react()],
  resolve:{dedupe:['react', 'react-dom'], alias:{'@':client}},
  css:{postcss:{plugins:[tailwind({content:[path.join(client,'components/{AliyunCaptcha,SliderCaptcha}.tsx').replaceAll('\\','/')], theme:{extend:{colors:{primary:'#6C46FF'}}}})]}},
  build:{outDir:path.join(output, 'sign-in'), emptyOutDir:true}
});
await mkdir(output,{recursive:true});
for (const name of ['接入说明.md','authorize.patch']) await copyFile(path.join(root,name),path.join(output,name));
