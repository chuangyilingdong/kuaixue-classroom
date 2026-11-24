const guarded = Symbol.for('kuaixue.process-pipe-guard');

function guardProcessPipes(target = process) {
  for (const name of ['stdout', 'stderr']) {
    const stream = target?.[name];
    if (!stream || typeof stream.on !== 'function' || stream[guarded]) continue;
    Object.defineProperty(stream, guarded, {value:true, configurable:false, enumerable:false});
    stream.on('error', () => {
      // Electron may be started from a terminal or another process whose pipe
      // is closed while the app remains open. Losing diagnostics must not turn
      // an ordinary WebSocket disconnect into an uncaught main-process EPIPE.
    });
  }
}

module.exports = {guardProcessPipes};
