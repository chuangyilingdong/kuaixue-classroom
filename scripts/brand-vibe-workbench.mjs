import {copyFile,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

export async function brandVibeWorkbench(outputDir){
  const root=resolve(outputDir);
  const assets=fileURLToPath(new URL('../src/assets/',import.meta.url));
  await copyFile(resolve(assets,'kx-class-mark.png'),resolve(root,'kx-class-mark.png'));
  await copyFile(resolve(assets,'kx-class-lockup.png'),resolve(root,'kx-class-lockup.png'));
  const indexFile=resolve(root,'index.html');
  let html=await readFile(indexFile,'utf8');
  const before=html;
  html=html.replace(/<link\s+rel="icon"[^>]*>/,
    '<link rel="icon" type="image/png" href="/kuaixue/workbench/kx-class-mark.png">');
  html=html.replace(/<title>[\s\S]*?<\/title>/,'<title>快学课堂 · VibeCoding</title>');
  html=html.replace(/<div class="zcode-boot-loading__logo-shell">[\s\S]*?<\/div>/,
    '<div class="zcode-boot-loading__logo-shell"><img class="zcode-boot-loading__logo" src="/kuaixue/workbench/kx-class-lockup.png" alt=""></div>');
  html=html.replace('</head>',`<style>
      .zcode-boot-loading__logo-shell {
        width: 132px;
        height: 108px;
        border-radius: 0;
        background: transparent;
        box-shadow: none;
      }
      .zcode-boot-loading__logo-shell::before { display: none; }
      .zcode-boot-loading__logo { width: 132px; height: auto; object-fit: contain; }
    </style></head>`);
  if(html===before||!html.includes('kx-class-lockup.png'))throw new Error('Vibe 工作台启动页结构变化，品牌替换失败');
  await writeFile(indexFile,html);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const output=process.argv[2];
  if(!output)throw new Error('请传入 Vibe 工作台输出目录');
  await brandVibeWorkbench(output);
}
