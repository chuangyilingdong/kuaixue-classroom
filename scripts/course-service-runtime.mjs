import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';

export const courseServiceRuntimeDependencies = [
  'buffer-crc32',
  'pend',
  'yauzl',
];

export function courseServiceRuntimePackages(root){
  const rootRequire=createRequire(join(root,'package.json'));
  const yauzlEntry=rootRequire.resolve('yauzl');
  const yauzlRequire=createRequire(yauzlEntry);
  return {
    'buffer-crc32':dirname(yauzlRequire.resolve('buffer-crc32/package.json')),
    pend:dirname(yauzlRequire.resolve('pend/package.json')),
    yauzl:dirname(yauzlEntry),
  };
}
