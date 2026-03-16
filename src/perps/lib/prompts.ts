import { createInterface } from 'readline';

function rl(): ReturnType<typeof createInterface> {
  return createInterface({ input: process.stdin, output: process.stdout });
}

function ask(question: string, hide = false): Promise<string> {
  return new Promise((resolve) => {
    const r = rl();
    if (hide && process.stdout.isTTY) {
      // Mask input on TTY
      process.stdout.write(question);
      const stdin = process.stdin;
      const wasRaw = stdin.isRaw;
      stdin.setRawMode?.(true);
      let buf = '';
      const onData = (ch: Buffer) => {
        const c = ch.toString('utf8');
        if (c === '\n' || c === '\r') {
          stdin.setRawMode?.(wasRaw ?? false);
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          r.close();
          resolve(buf.trim());
        } else if (c === '\u0003') {
          // Ctrl+C
          r.close();
          process.exit(1);
        } else if (c === '\u007f' || c === '\b') {
          buf = buf.slice(0, -1);
        } else {
          buf += c;
          process.stdout.write('*');
        }
      };
      stdin.on('data', onData);
    } else {
      r.question(question, (answer) => {
        r.close();
        resolve(answer.trim());
      });
    }
  });
}

export async function prompt(question: string): Promise<string> {
  return ask(question);
}

export async function promptPassword(question: string): Promise<string> {
  return ask(question, true);
}

export async function select<T extends string>(
  question: string,
  options: { value: T; label: string; description?: string }[],
): Promise<T> {
  console.log(question);
  options.forEach((opt, i) => {
    const desc = opt.description ? ` - ${opt.description}` : '';
    console.log(`  ${i + 1}) ${opt.label}${desc}`);
  });
  const answer = await ask(`Choose [1-${options.length}]: `);
  const idx = parseInt(answer, 10) - 1;
  if (idx >= 0 && idx < options.length) {
    return options[idx].value;
  }
  // Default to first option on invalid input
  console.log(`Invalid choice, defaulting to "${options[0].label}"`);
  return options[0].value;
}

export async function confirm(
  question: string,
  defaultValue: boolean = false,
): Promise<boolean> {
  const hint = defaultValue ? '[Y/n]' : '[y/N]';
  const answer = await ask(`${question} ${hint} `);
  if (!answer) return defaultValue;
  return answer.toLowerCase().startsWith('y');
}
