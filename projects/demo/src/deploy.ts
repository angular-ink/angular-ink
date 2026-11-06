import { Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { InkBox, InkStatic, InkText, injectApp, injectInput, renderInk } from '@angular-ink/core';
import { pathToFileURL } from 'node:url';

const ENVIRONMENTS = ['staging', 'prod'] as const;
const FAILING_STEP = 'Run migrations';
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_MS = 80;

export const DEPLOY_STEPS: readonly string[] = ['Build image', FAILING_STEP, 'Switch traffic'];

@Component({
  selector: 'demo-spinner',
  imports: [InkText],
  template: `<ink-text color="cyan">{{ glyph() }}</ink-text>`,
})
class Spinner {
  private readonly turn = signal(0);
  protected readonly glyph = computed(
    () => SPINNER_FRAMES[this.turn() % SPINNER_FRAMES.length] ?? '',
  );

  constructor() {
    const timer = setInterval(() => {
      this.turn.update((turn) => turn + 1);
    }, SPINNER_MS);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
    });
  }
}

/** Picks an environment with the arrows and Enter, then runs fake steps with a spinner. */
@Component({
  selector: 'demo-deploy',
  imports: [InkBox, InkStatic, InkText, Spinner],
  template: `
    <ink-box flexDirection="column">
      <ink-static [items]="finished()">
        <ng-template let-step>
          <ink-text color="green">✔ {{ step }}</ink-text>
        </ng-template>
      </ink-static>
      @if (target(); as environment) {
        @if (running(); as step) {
          <ink-box>
            <demo-spinner />
            <ink-text> Deploying to {{ environment }}: {{ step }}</ink-text>
          </ink-box>
        } @else {
          <ink-text color="green" bold>Deployed to {{ environment }}</ink-text>
        }
      } @else {
        <ink-text bold>Deploy to which environment?</ink-text>
        @for (environment of environments; track environment) {
          <ink-text [color]="$index === selected() ? 'cyan' : undefined">
            {{ $index === selected() ? '>' : ' ' }} {{ environment }}
          </ink-text>
        }
      }
    </ink-box>
  `,
})
export class Deploy {
  readonly stepMs = input(300);
  readonly fail = input(false);

  protected readonly environments = ENVIRONMENTS;
  protected readonly selected = signal(0);
  protected readonly target = signal<string | null>(null);
  protected readonly finished = signal<readonly string[]>([]);
  protected readonly running = computed(() => DEPLOY_STEPS[this.finished().length] ?? null);

  private readonly app = injectApp();
  private readonly failure = signal<Error | null>(null);
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    injectInput(
      (_text, key) => {
        if (key.upArrow) this.selected.update((index) => Math.max(index - 1, 0));
        if (key.downArrow) {
          this.selected.update((index) => Math.min(index + 1, ENVIRONMENTS.length - 1));
        }
        if (key.return) this.start();
      },
      { isActive: computed(() => this.target() === null) },
    );
    // Thrown during change detection, an error ends the app on the ErrorOverview.
    effect(() => {
      const error = this.failure();
      if (error !== null) throw error;
    });
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.timer);
    });
  }

  private start(): void {
    this.target.set(ENVIRONMENTS[this.selected()] ?? null);
    this.scheduleStep();
  }

  private scheduleStep(): void {
    this.timer = setTimeout(() => {
      this.finishStep();
    }, this.stepMs());
  }

  private finishStep(): void {
    const step = this.running();
    if (step === null) return;
    if (this.fail() && step === FAILING_STEP) {
      this.failure.set(new Error(`${step} failed on ${this.target() ?? ''}`));
      return;
    }
    this.finished.update((steps) => [...steps, step]);
    if (this.running() === null) this.app.exit();
    else this.scheduleStep();
  }
}

async function main(): Promise<void> {
  const app = await renderInk(Deploy, { inputs: { fail: process.argv.includes('--fail') } });
  await app.waitUntilExit().catch(() => {
    process.exitCode = 1;
  });
}

if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
