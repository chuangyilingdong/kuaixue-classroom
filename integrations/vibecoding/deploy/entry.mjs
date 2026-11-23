import WebSocket from 'ws';
import { createGateway } from '../gateway.mjs';
if (process.env.LISTEN_PID !== String(process.pid) || process.env.LISTEN_FDS !== '1') {
  throw Error('请通过 kuaixue-vibe.socket 启动网关');
}
const server = createGateway({WebSocket, courseFile:process.env.KUAIXUE_COURSE_DB,
  ticketFile:process.env.KUAIXUE_RUNTIME_TICKET_DB, hostRoot:'/var/lib/kuaixue-vibe/hosts'});
server.listen({fd:3});
