import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import native from '../../electron/native-project.cjs';

// Run on the course workspace host. Keep files when the same learner reopens a purchased version.
export function courseWorkspaceDirectory(storageRoot,platform) {
  const root = resolve(storageRoot);
  return async function openWorkspace(context) {
    if (context.mode !== 'VIBECODING' || !platform.hasRuntimeAccess(context)) throw Error('课程工作区授权已失效');
    const {userId,courseId,versionId,runId} = context;
    const course = platform.detail(courseId,versionId,userId);
    const stableKey = parts => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
    const studentRoot = join(root,stableKey([userId]));
    const directory = await native.prepareNativeProject(studentRoot,{
      runId:stableKey([courseId,versionId,runId]),course,
      html:'<!doctype html>\n<html lang="zh-CN"><meta charset="utf-8"><title>课程作品</title><h1>我的课程作品</h1></html>\n',
    });
    return {path:directory,presets:course.classroomConfig?.vibeCoding?.presetPrompts ?? []};
  };
}
