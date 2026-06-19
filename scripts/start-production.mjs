import { execFileSync, spawn } from 'node:child_process';

execFileSync(process.execPath, ['packages/db/dist/migrate.js'], {
  stdio: 'inherit',
  env: process.env
});
execFileSync(process.execPath, ['packages/db/dist/seed-cli.js'], {
  stdio: 'inherit',
  env: process.env
});

const children = [
  spawn(process.execPath, ['apps/api/dist/server.js'], { stdio: 'inherit', env: process.env }),
  spawn(process.execPath, ['apps/worker/dist/main.js'], { stdio: 'inherit', env: process.env })
];

let stopping = false;
function stop(signal) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill(signal);
}

process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));

for (const child of children) {
  child.on('exit', (code, signal) => {
    if (!stopping) {
      console.error(`A production process exited unexpectedly (code=${code}, signal=${signal}).`);
      stop('SIGTERM');
      process.exitCode = code ?? 1;
    }
  });
}
