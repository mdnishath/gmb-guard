/**
 * Minimal SSH runner (password auth) for Windows machines without ssh keys.
 * Uses the pure-JS `ssh2` package installed into deploy/node_modules.
 *
 *   node deploy/remote.mjs --host 1.2.3.4 --user root --password "..." \
 *        --upload "C:\path\file.env:/tmp/gmb.env" --script deploy/remote-setup.sh \
 *        --env "DOMAIN=gmb.example.com" --env "REPO_URL=https://github.com/x/y.git"
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { Client } = require('ssh2');

const args = process.argv.slice(2);
const opt = (name, multi = false) => {
  const out = [];
  for (let i = 0; i < args.length; i++) if (args[i] === `--${name}`) out.push(args[i + 1]);
  return multi ? out : out[0];
};

const host = opt('host');
const user = opt('user') ?? 'root';
const password = opt('password') ?? process.env.VPS_PASSWORD;
const uploads = opt('upload', true); // "local:remote"
const script = opt('script');
const envs = opt('env', true);
const command = opt('command');

if (!host || !password) {
  console.error('usage: --host <ip> --password <pw> [--user root] [--upload local:remote]... [--script file.sh] [--env K=V]... [--command "..."]');
  process.exit(2);
}

const conn = new Client();

const exec = (cmd) =>
  new Promise((res, rej) => {
    conn.exec(cmd, { pty: true }, (err, stream) => {
      if (err) return rej(err);
      stream.on('data', (d) => process.stdout.write(d));
      stream.stderr.on('data', (d) => process.stderr.write(d));
      stream.on('close', (code) => res(code));
    });
  });

const sftpPut = (sftp, local, remote) =>
  new Promise((res, rej) => {
    sftp.fastPut(local, remote, (err) => (err ? rej(err) : res()));
  });

conn
  .on('ready', async () => {
    try {
      if (uploads.length || script) {
        const sftp = await new Promise((res, rej) => conn.sftp((e, s) => (e ? rej(e) : res(s))));
        for (const u of uploads) {
          const idx = u.lastIndexOf(':');
          const local = u.slice(0, idx);
          const remote = u.slice(idx + 1);
          await sftpPut(sftp, resolve(local), remote);
          console.log(`uploaded ${local} -> ${remote}`);
        }
        if (script) {
          await sftpPut(sftp, resolve(script), '/tmp/gmb-remote.sh');
          console.log(`uploaded ${script} -> /tmp/gmb-remote.sh`);
        }
      }
      let code = 0;
      if (script) {
        const envStr = envs.map((e) => `export ${e.replace(/'/g, "'\\''").replace(/^([^=]+)=(.*)$/, "$1='$2'")};`).join(' ');
        code = await exec(`${envStr} bash /tmp/gmb-remote.sh; echo; echo "[remote exit $?]"`);
      } else if (command) {
        code = await exec(command);
      }
      conn.end();
      process.exit(typeof code === 'number' ? code : 0);
    } catch (err) {
      console.error('remote error:', err?.message ?? err);
      conn.end();
      process.exit(1);
    }
  })
  .on('error', (err) => {
    console.error('ssh error:', err?.message ?? err);
    process.exit(1);
  })
  .connect({ host, port: 22, username: user, password, readyTimeout: 30000, tryKeyboard: true });

conn.on('keyboard-interactive', (_name, _instr, _lang, _prompts, finish) => finish([password]));

// keep stdin readable so the process does not exit early on some Windows terminals
void readFileSync;
