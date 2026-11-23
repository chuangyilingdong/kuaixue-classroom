import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { requireVibeOrigin } from './src/services/vibeOrigin.js';

export default defineConfig(({mode}) => {
  const env = {...loadEnv(mode,process.cwd(),'VITE_KUAIXUE_'),...process.env};
  const integrated = env.VITE_KUAIXUE_COURSE_SERVICE === '1';
  if (mode === 'official' && !integrated) throw Error('正式包必须启用课程服务');
  if (integrated && !/^https:\/\//.test(env.VITE_KUAIXUE_API_BASE_URL || '')) throw Error('联网桌面构建需要 HTTPS 课程服务地址');
  const vibeOrigin = integrated ? requireVibeOrigin(env.VITE_KUAIXUE_VIBE_ORIGIN, new URL(env.VITE_KUAIXUE_API_BASE_URL).origin) : undefined;
  if (mode === 'official' && vibeOrigin !== 'https://kuaixue-vibe.aicyld.com.cn') throw Error('VITE_KUAIXUE_VIBE_ORIGIN 与正式 VibeCoding 工作区不符');
  return {base:'./',plugins:[react(),{name:'desktop-service-config', generateBundle() {
    this.emitFile({type:'asset',fileName:'desktop-service.json',source:JSON.stringify(integrated ? {
      integrated:true,apiOrigin:new URL(env.VITE_KUAIXUE_API_BASE_URL).origin,vibeOrigin,
      authorizeUrl:env.VITE_KUAIXUE_AUTHORIZE_URL,clientId:env.VITE_KUAIXUE_CLIENT_ID,
    } : {integrated:false})});
  }}],clearScreen:false,server:{strictPort:true,watch:{ignored:['**/release/**','**/_qa_render/**']}}};
});
