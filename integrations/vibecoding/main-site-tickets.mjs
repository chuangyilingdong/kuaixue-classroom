import {isAbsolute, resolve} from 'node:path';
import {createRuntimeBroker} from './runtime-broker.mjs';

// Keep the deployed course platform and its wallet extensions. The trusted runtime
// gateway opens an independent connection to the same single-host ticket store.
export function openTicketedCoursePlatform(openCoursePlatform, courseFile, provider, ticketFile) {
  if (!ticketFile) return openCoursePlatform(courseFile, provider);
  if (!isAbsolute(ticketFile) || resolve(ticketFile) === resolve(courseFile)) {
    throw new Error('请单独配置运行票据库的绝对路径');
  }
  if (provider.issueRuntimeTicket) throw new Error('课程服务已配置另一套运行票据签发器');

  let platform;
  const broker = createRuntimeBroker({
    filename: ticketFile,
    checkAccess: context => platform.hasRuntimeAccess(context),
  });
  try {
    platform = openCoursePlatform(courseFile, {...provider, issueRuntimeTicket: broker.issueRuntimeTicket});
  } catch (error) {
    broker.close();
    throw error;
  }
  return {...platform, close() {
    try { platform.close(); } finally { broker.close(); }
  }};
}
