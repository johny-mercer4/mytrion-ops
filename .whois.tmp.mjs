/** What migration is prod's id=142 (created_at 1785398400000)? Hash every migration blob everywhere. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const sh = (args) => execFileSync('git', args, { maxBuffer: 1 << 28 });
const revs = sh(['rev-list', '--all', '--remotes']).toString().trim().split('\n');
const TARGET = 'c1e6097ecf59';
const hits = new Set();

for (const rev of revs) {
  let paths;
  try {
    paths = sh(['ls-tree', '-r', '--name-only', rev, '--', 'src/db/migrations'])
      .toString().trim().split('\n').filter((p) => p.endsWith('.sql'));
  } catch { continue; }
  for (const p of paths) {
    const h = createHash('sha256').update(sh(['cat-file', 'blob', `${rev}:${p}`])).digest('hex');
    if (h.startsWith(TARGET)) hits.add(p);
  }
}
console.log(hits.size ? `id=142 is: ${[...hits].join(', ')}` : `no blob anywhere hashes to ${TARGET}…`);

// And: which journal entries across branches claim when=1785398400000?
for (const rev of revs) {
  try {
    const j = JSON.parse(sh(['cat-file', 'blob', `${rev}:src/db/migrations/meta/_journal.json`]).toString());
    for (const e of j.entries) {
      if (e.when === 1785398400000) console.log(`  when=1785398400000 -> ${e.tag}  (in ${rev.slice(0, 8)})`);
    }
  } catch { /* no journal at this rev */ }
}
