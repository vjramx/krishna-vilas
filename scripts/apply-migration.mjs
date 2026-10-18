import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TOKEN = process.env.SB_TOKEN ?? '';
const REF = 'reodbsfxkorpgzimqijn';

export function stripComments(sql) {
  let i = 0;
  let out = '';
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'") {
      // copy a string literal verbatim (handles '' escapes)
      const end = i + 1;
      let j = end;
      while (j < sql.length) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") { j += 2; continue; }
          j++;
          break;
        }
        j++;
      }
      out += sql.slice(i, j);
      i = j;
      continue;
    }
    const dq = /^\$[a-zA-Z_][a-zA-Z0-9_]*\$|\$\$/.exec(sql.slice(i));
    if (dq && dq.index === 0) {
      // copy dollar-quoted body verbatim — never strip comments inside
      const tag = dq[0];
      const end = sql.indexOf(tag, i + tag.length);
      const stop = end === -1 ? sql.length : end + tag.length;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i);
      i = nl === -1 ? sql.length : nl; // keep newline
      continue;
    }
    if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

export function splitStatements(sql) {
  const out = [];
  let cur = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    cur += ch;
    const dq = /^\$[a-zA-Z_][a-zA-Z0-9_]*\$|\$\$/.exec(sql.slice(i));
    if (dq && dq.index === 0) {
      const tag = dq[0];
      const end = sql.indexOf(tag, i + tag.length);
      const stop = end === -1 ? sql.length : end + tag.length;
      cur += sql.slice(i + 1, stop);
      i = stop;
      continue;
    }
    if (ch === ';') {
      const stmt = cur.trim();
      if (stmt.length > 1) out.push(stmt);
      cur = '';
      i++;
      continue;
    }
    i++;
  }
  const rest = cur.trim();
  if (rest.length > 1) out.push(rest);
  return out;
}

async function runQuery(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', Connection: 'close' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  const ok = res.status === 200 || res.status === 201;
  return { ok: ok && !/syntax error|42601|42P01|42704|23505[^\d]/i.test(text), status: res.status, body: text };
}

const sqlFile = process.argv[2];
const logPath = process.argv[3] ?? 'supabase/applied.txt';

if (!sqlFile) {
  // Library import: do nothing.
} else {
  const sql = readFileSync(sqlFile, 'utf8');
  const statements = splitStatements(stripComments(sql));
  const applied = [];
  for (const [idx, stmt] of statements.entries()) {
    const { ok, status, body } = await runQuery(stmt);
    const head = stmt.replace(/\s+/g, ' ').slice(0, 60);
    if (!ok) {
      if (/already exists|duplicate/i.test(body) && !/syntax error/i.test(body)) {
        applied.push(`SKIP ${idx}: ${head}`);
        console.log(`skip ${idx}: ${head}`);
      } else {
        console.error(`FAILED ${idx} (http ${status}): ${head}\n${body.slice(0, 1500)}`);
        process.exit(1);
      }
    } else {
      applied.push(`OK   ${idx}: ${head}`);
      console.log(`ok ${idx}: ${head}`);
    }
  }
  writeFileSync(join(process.cwd(), logPath), applied.join('\n') + '\n');
  console.log(`applied ${applied.length} statements`);
}
