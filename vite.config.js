import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({mode}) => {
  const env = {...loadEnv(mode,process.cwd(),'VITE_KUAIXUE_'),...process.env};
  const integrated = env.VITE_KUAIXUE_COURSE_SERVICE === '1';
  if (integrated && !/^https:\/\//.test(env.VITE_KUAIXUE_API_BASE_URL || '')) throw Error('联网桌面构建需要 HTTPS 课程服务地址');
  return {base:'./',plugins:[react(),{name:'desktop-service-config', generateBundle() {
    this.emitFile({type:'asset',fileName:'desktop-service.json',source:JSON.stringify(integrated ? {
      integrated:true,apiOrigin:new URL(env.VITE_KUAIXUE_API_BASE_URL).origin,
      authorizeUrl:env.VITE_KUAIXUE_AUTHORIZE_URL,clientId:env.VITE_KUAIXUE_CLIENT_ID,
    } : {integrated:false})});
  }}],clearScreen:false,server:{strictPort:true,watch:{ignored:['**/release/**','**/_qa_render/**']}}};
});
