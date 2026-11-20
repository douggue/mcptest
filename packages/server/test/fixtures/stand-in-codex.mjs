/**
 * A stand-in for the Codex CLI, for tests. It speaks the two parts of Codex
 * the engine uses: `login status`, and `exec --json ... -` reading the prompt
 * from its input and printing events. Its answer is what it was given, so a
 * test can see what crossed the process boundary. It reaches nothing.
 */
const args = process.argv.slice(2);

if (args[0] === 'login') {
  process.stdout.write('Logged in using ChatGPT\n');
  process.exit(0);
}

if (args[0] !== 'exec' || args.at(-1) !== '-') {
  process.stderr.write('error: unexpected arguments\n');
  process.exit(2);
}

const settings = Object.fromEntries(
  args.flatMap((arg, index) => {
    if (arg !== '-c') return [];
    const pair = args[index + 1] ?? '';
    return [[pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]];
  }),
);

let prompt = '';
process.stdin.on('data', (chunk) => {
  prompt += chunk;
});
process.stdin.on('end', () => {
  const print = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
  print({ type: 'thread.started', thread_id: 'stand-in' });
  print({ type: 'turn.started' });
  print({
    type: 'item.completed',
    item: { id: 'item_0', type: 'agent_message', text: JSON.stringify({ prompt, settings }) },
  });
  print({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } });
});
