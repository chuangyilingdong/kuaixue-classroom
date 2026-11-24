// Use the original Lingdong binding's public provider format in the course host's private profile.
// The host creates a fresh profile per lease and disposes of it when the lease ends.
import {mkdir,rename,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
export async function provisionCourseProvider({profile,context,platform,gateway}) {
  if (context.mode !== 'VIBECODING' || !await platform.hasRuntimeAccess(context)) throw Error('课程工作区授权已失效');
  const course = await platform.detail(context.courseId,context.versionId,context.userId);
  const allowed = course.vibeModelIds || [];
  const sameLease = ['userId','runId','versionId','courseId','mode'].every(key => gateway?.[key] === context[key]);
  if (!sameLease || !Array.isArray(gateway.modelIds)) throw Error('课程模型授权尚未就绪');
  const ids = allowed.filter(id => gateway.modelIds.includes(id));
  if (!ids.length || !gateway.token || gateway.expiresAt <= Date.now() || !Number.isFinite(gateway.expiresAt)) throw Error('课程模型授权尚未就绪');
  const base = new URL(gateway.baseUrl);
  if (base.username || base.password || !(base.protocol === 'https:' || base.protocol === 'http:' && ['localhost','127.0.0.1'].includes(base.hostname))) throw Error('无效的模型网关');
  const providerId = 'lingdong-platform-gateway';
  const config = {schemaVersion:1,config:{
    providerConfigRules:{providerRules:[{providerId,providerName:'快学课程模型',config:{group:'standard-personal',personalModelIds:ids,access:{type:'api-key',apiKey:gateway.token},api:{type:'openai-chat-completions',baseUrl:base.href},visibility:'visible'}}]},
    modelConfigRules:{providerModelRules:ids.map(modelId=>({providerId,modelId,config:{enabled:true}})),manualProviderModelRules:[]},
    defaultModelSelection:{providerId,modelId:ids[0]},
  }};
  const dir=join(profile,'.zcode','v2');
  await mkdir(dir,{recursive:true,mode:0o700});
  const target=join(dir,'provider_config.json');
  const temporary=`${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary,JSON.stringify(config),{flag:'wx',mode:0o600});
  await rename(temporary,target);
}
